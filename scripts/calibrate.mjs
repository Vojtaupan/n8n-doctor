#!/usr/bin/env node
/**
 * Run every rule over the validation corpus and judge each one against the
 * severity-weighted calibration gate in src/calibrate.ts.
 *
 * The corpus is REAL CLIENT WORK. This script's output is meant to be pasted
 * into a public README, so it prints AGGREGATES ONLY: counts, rates and rule
 * ids. It must never print a workflow name, node name, URL, webhook path or
 * credential id. Anything added below has to keep that true.
 *
 *   npm run calibrate                      # builds first, then scans ./corpus
 *   node scripts/calibrate.mjs --corpus X  # scan a different directory
 *
 * Exit codes: 0 gate passed, 1 gate failed, 2 bad usage or unreadable corpus.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { parseWorkflowFileContents, buildGraph, buildContext, runRules, rules } from '../dist/index.js';
import { DEFAULT_THRESHOLDS, aggregateStats, evaluateGate } from '../dist/calibrate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const USAGE = `Usage: node scripts/calibrate.mjs [--corpus <dir>]

  Runs the full rule registry over a corpus of real workflows and checks each
  rule against the calibration gate. Prints aggregates only - never a workflow
  name, node name, URL or credential id.

Options:
  --corpus <dir>   directory of workflow JSON to scan (default: ./corpus)
  -h, --help       show this help
`;

function parseArgs(argv) {
  const opts = { corpus: path.join(ROOT, 'corpus'), help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--corpus' || arg.startsWith('--corpus=')) {
      const val = arg.includes('=') ? arg.slice('--corpus='.length) : argv[++i];
      if (!val) return { opts, error: '--corpus requires a directory' };
      opts.corpus = path.resolve(process.cwd(), val);
    } else {
      return { opts, error: `unknown option "${arg}"` };
    }
  }
  return { opts };
}

/** Load every workflow JSON under `dir`. Returns graphs plus a skipped-file count. */
async function loadCorpus(dir) {
  const pattern = `${dir.replace(/\\/g, '/').replace(/\/+$/, '')}/**/*.json`;
  const files = await fg(pattern, { onlyFiles: true, unique: true });

  const graphs = [];
  let skipped = 0;
  for (const file of files) {
    try {
      const raws = parseWorkflowFileContents(fs.readFileSync(file, 'utf8'), file);
      for (const raw of raws) graphs.push(buildGraph(raw));
    } catch {
      // A malformed file is counted, never named - the name is client data.
      skipped++;
    }
  }
  return { graphs, files: files.length, skipped };
}

const RANK = { FAIL: 0, OK: 1, 'never fired': 2 };

function label(verdict) {
  if (verdict.reason === 'zero-firing') return 'never fired';
  return verdict.pass ? 'OK' : 'FAIL';
}

function pct(rate) {
  return `${(rate * 100).toFixed(3)}%`;
}

function renderTable(verdicts, statsById) {
  const rows = [...verdicts].sort((a, b) => {
    const byLabel = RANK[label(a)] - RANK[label(b)];
    if (byLabel !== 0) return byLabel;
    if (b.rate !== a.rate) return b.rate - a.rate;
    return a.ruleId.localeCompare(b.ruleId);
  });

  const idWidth = Math.max(4, ...rows.map((r) => r.ruleId.length));
  const head =
    `${'rule'.padEnd(idWidth)}  ${'severity'.padEnd(8)}  ${'findings'.padStart(8)}  ` +
    `${'rate'.padStart(8)}  ${'wfs'.padStart(4)}  verdict`;
  const bar = '-'.repeat(head.length);

  const lines = rows.map((v) => {
    const stats = statsById.get(v.ruleId);
    const verdict = v.pass ? 'OK' : v.reason === 'zero-firing' ? 'never fired' : `FAIL ${v.reason}`;
    return (
      `${v.ruleId.padEnd(idWidth)}  ${v.severity.padEnd(8)}  ${String(v.findings).padStart(8)}  ` +
      `${pct(v.rate).padStart(8)}  ${String(stats.workflowsAffected).padStart(4)}  ${verdict}`
    );
  });

  return [head, bar, ...lines].join('\n');
}

async function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (error) {
    process.stderr.write(`calibrate: ${error}\n\n${USAGE}`);
    return 2;
  }
  if (!fs.existsSync(opts.corpus)) {
    process.stderr.write(`calibrate: corpus directory not found\n`);
    return 2;
  }

  const { graphs, files, skipped } = await loadCorpus(opts.corpus);
  if (graphs.length === 0) {
    process.stderr.write(`calibrate: no readable workflows in the corpus directory\n`);
    return 2;
  }

  const totalNodes = graphs.reduce((sum, g) => sum + g.nodes.length, 0);
  const ctx = buildContext(graphs);
  const findings = runRules(ctx);

  // aggregateStats lives in src/calibrate.ts so this counting is unit-tested;
  // it also excludes synthesized rule crashes from the finding counts.
  const stats = aggregateStats(findings, rules, totalNodes);
  const statsById = new Map(stats.map((s) => [s.ruleId, s]));
  const { pass, verdicts } = evaluateGate(stats, DEFAULT_THRESHOLDS);

  const counted = { error: 0, warning: 0, info: 0 };
  for (const s of stats) counted[s.severity] += s.findings;
  const totalFindings = counted.error + counted.warning + counted.info;
  const crashes = stats.reduce((sum, s) => sum + s.crashes, 0);

  const failing = verdicts.filter((v) => !v.pass && v.reason !== 'zero-firing');
  const zeroFiring = verdicts.filter((v) => v.reason === 'zero-firing');

  const out = [
    'n8n-lint calibration',
    '====================',
    '',
    `files scanned:     ${files}${skipped > 0 ? ` (${skipped} unreadable, skipped)` : ''}`,
    `workflows scanned: ${graphs.length}`,
    `nodes scanned:     ${totalNodes}`,
    `rules run:         ${rules.length}`,
    '',
    `findings: ${totalFindings} total - ${counted.error} error, ${counted.warning} warning, ${counted.info} info`,
    crashes > 0 ? `rule crashes: ${crashes} (excluded from the counts above)` : null,
    '',
    `thresholds: error <= ${pct(DEFAULT_THRESHOLDS.error.maxRate)} of nodes and <= ${DEFAULT_THRESHOLDS.error.maxAbsolute} findings; ` +
      `warning <= ${pct(DEFAULT_THRESHOLDS.warning.maxRate)}; info exempt`,
    `rate denominator: total nodes scanned (${totalNodes}), the same for every rule`,
    '',
    renderTable(verdicts, statsById),
    '',
    `GATE: ${pass ? 'PASS' : 'FAIL'} - ${failing.length} rule(s) over bound, ${zeroFiring.length} rule(s) never fired`,
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');

  process.stdout.write(out);
  return pass ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`calibrate: ${err.message}\n`);
    process.exit(2);
  },
);
