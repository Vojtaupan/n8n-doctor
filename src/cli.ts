#!/usr/bin/env node
import fg from 'fast-glob';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGraph } from './graph.js';
import { buildContext } from './context.js';
import { runRules } from './engine.js';
import { rules as allRules } from './rules/index.js';
import { parseWorkflowFileContents } from './load.js';
import { renderText } from './report/text.js';
import { renderJson } from './report/json.js';
import type { RawWorkflow } from './load.js';
import type { Severity } from './types.js';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface Options {
  paths: string[];
  json: boolean;
  severity: Severity;
  ruleIds: string[];
  /** False once `--no-color` is seen; the effective decision also needs a TTY. */
  color: boolean;
  quiet: boolean;
  help: boolean;
}

const USAGE = `Usage: n8n-lint <path...> [options]

  Lint exported n8n workflow JSON for production-readiness defects that
  schema validators cannot see.

Arguments:
  <path...>            files, directories, or globs to lint; '-' reads stdin

Options:
  --json               machine-readable JSON output
  --severity <level>   minimum severity to report: error | warning | info (default: info)
  --rule <id>          run only this rule (repeatable)
  --no-color           disable ANSI colour
  --quiet              suppress the summary line
  -h, --help           show this help

Exit codes:
  0  clean, or only findings below error
  1  at least one error-severity finding
  2  bad usage or unreadable input
`;

/** Rank severities so a `--severity` threshold can keep everything at or above it. */
const RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

function parseArgs(argv: string[]): { opts: Options; error?: string } {
  const opts: Options = {
    paths: [],
    json: false,
    severity: 'info',
    ruleIds: [],
    color: true,
    quiet: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--no-color') {
      opts.color = false;
    } else if (arg === '--quiet') {
      opts.quiet = true;
    } else if (arg === '--severity' || arg.startsWith('--severity=')) {
      const val = arg.includes('=') ? arg.slice('--severity='.length) : argv[++i];
      if (val !== 'error' && val !== 'warning' && val !== 'info') {
        return {
          opts,
          error: `invalid --severity "${val ?? ''}" (expected error, warning, or info)`,
        };
      }
      opts.severity = val;
    } else if (arg === '--rule' || arg.startsWith('--rule=')) {
      const val = arg.includes('=') ? arg.slice('--rule='.length) : argv[++i];
      if (!val) return { opts, error: '--rule requires a rule id' };
      opts.ruleIds.push(val);
    } else if (arg === '-') {
      opts.paths.push('-');
    } else if (arg.startsWith('-')) {
      return { opts, error: `unknown option "${arg}"` };
    } else {
      opts.paths.push(arg);
    }
  }

  return { opts };
}

function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => (data += chunk));
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

/** Expand paths (files, directories, globs) into concrete file paths. */
async function expand(paths: string[]): Promise<string[]> {
  const patterns: string[] = [];
  for (const p of paths) {
    let pattern = p.replace(/\\/g, '/');
    try {
      if (statSync(p).isDirectory()) pattern = `${pattern.replace(/\/+$/, '')}/**/*.json`;
    } catch {
      // Not an existing directory (a glob, or a missing path); leave it for fast-glob,
      // which yields nothing for a path that does not resolve.
    }
    patterns.push(pattern);
  }
  if (patterns.length === 0) return [];
  return fg(patterns, { onlyFiles: true, unique: true });
}

/**
 * Lint the given paths and produce the report as strings plus an exit code,
 * without touching real stdout/stderr or calling `process.exit`. The binary
 * entry point below writes the strings and exits; tests call it directly.
 */
export async function run(argv: string[]): Promise<CliResult> {
  const { opts, error } = parseArgs(argv);

  if (opts.help) return { code: 0, stdout: USAGE, stderr: '' };
  if (error) return { code: 2, stdout: '', stderr: `n8n-lint: ${error}\n\n${USAGE}` };
  if (opts.paths.length === 0) {
    return { code: 2, stdout: '', stderr: `n8n-lint: no input paths given\n\n${USAGE}` };
  }

  const wantStdin = opts.paths.includes('-');
  const fileArgs = opts.paths.filter((p) => p !== '-');
  const files = await expand(fileArgs);

  if (!wantStdin && files.length === 0) {
    return { code: 2, stdout: '', stderr: `n8n-lint: no workflow files matched the given paths\n` };
  }

  const raws: RawWorkflow[] = [];
  const errors: string[] = [];

  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch (err) {
      errors.push(`${file}: ${(err as Error).message}`);
      continue;
    }
    try {
      raws.push(...parseWorkflowFileContents(contents, file));
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  if (wantStdin) {
    try {
      const text = await readStream(process.stdin);
      raws.push(...parseWorkflowFileContents(text, '<stdin>'));
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  // Nothing parsed at all: the input was unreadable, not clean. Exit 2.
  if (raws.length === 0) {
    const detail =
      errors.length > 0 ? errors.join('\n') : 'no readable workflows in the given paths';
    return { code: 2, stdout: '', stderr: `n8n-lint: ${detail}\n` };
  }

  const ctx = buildContext(raws.map(buildGraph));
  const selected =
    opts.ruleIds.length > 0 ? allRules.filter((r) => opts.ruleIds.includes(r.id)) : allRules;
  const threshold = RANK[opts.severity];
  const findings = runRules(ctx, selected).filter((f) => RANK[f.severity] >= threshold);

  const stdout = opts.json
    ? `${renderJson(findings)}\n`
    : renderText(findings, {
        color: opts.color && process.stdout.isTTY === true,
        quiet: opts.quiet,
      });

  // Report but do not fail on individual bad files — one unreadable file in a
  // glob of hundreds should not mask the findings from the rest.
  const stderr = errors.length > 0 ? `${errors.map((e) => `n8n-lint: ${e}`).join('\n')}\n` : '';
  const code = findings.some((f) => f.severity === 'error') ? 1 : 0;

  return { code, stdout, stderr };
}

/** True when this module is the process entry point (the installed binary), not an import. */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  run(process.argv.slice(2)).then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.code);
  });
}
