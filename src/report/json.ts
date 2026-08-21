import type { Finding } from '../types.js';

export interface JsonSummary {
  error: number;
  warning: number;
  info: number;
  total: number;
}

export interface JsonReport {
  findings: Finding[];
  summary: JsonSummary;
}

/**
 * Machine-readable report: the findings verbatim plus a per-severity summary.
 * Emitted under `--json` for CI and downstream tooling, so it is the whole of
 * stdout in that mode — no colour, no prose.
 */
export function renderJson(findings: Finding[]): string {
  const summary: JsonSummary = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const f of findings) summary[f.severity]++;
  const report: JsonReport = { findings, summary };
  return JSON.stringify(report, null, 2);
}
