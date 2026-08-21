import pc from 'picocolors';
import type { Finding, Severity } from '../types.js';

export interface TextOptions {
  /** Apply ANSI colour. The CLI passes `false` for non-TTY sinks and `--no-color`. */
  color: boolean;
  /** Drop the closing per-severity summary line. */
  quiet?: boolean;
}

type Colorize = (input: string) => string;

interface Palette {
  error: Colorize;
  warning: Colorize;
  info: Colorize;
  bold: Colorize;
  dim: Colorize;
}

const identity: Colorize = (input) => input;

function palette(color: boolean): Palette {
  if (!color) {
    return { error: identity, warning: identity, info: identity, bold: identity, dim: identity };
  }
  return { error: pc.red, warning: pc.yellow, info: pc.blue, bold: pc.bold, dim: pc.dim };
}

/**
 * Human-readable report. Findings are grouped by workflow; each is shown as
 * `severity  rule-id  node — message` with its suggestion indented beneath, and
 * (unless `quiet`) a closing line counting each severity. An empty run says so
 * explicitly rather than printing nothing, so a clean exit is never ambiguous.
 */
export function renderText(findings: Finding[], opts: TextOptions): string {
  const { color, quiet = false } = opts;
  const c = palette(color);

  if (findings.length === 0) {
    return `${c.info('✔')} No findings\n`;
  }

  const byWorkflow = new Map<string, Finding[]>();
  for (const f of findings) {
    const group = byWorkflow.get(f.workflowName);
    if (group) group.push(f);
    else byWorkflow.set(f.workflowName, [f]);
  }

  const lines: string[] = [];
  for (const [workflow, group] of byWorkflow) {
    lines.push(c.bold(workflow));
    for (const f of group) {
      const sev = c[f.severity](f.severity.padEnd(7));
      const where = f.nodeName ? `${f.nodeName} — ` : '';
      lines.push(`  ${sev} ${c.dim(f.ruleId)}  ${where}${f.message}`);
      lines.push(`          ${c.dim('↳')} ${f.suggestion}`);
    }
    lines.push('');
  }

  if (!quiet) {
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const f of findings) counts[f.severity]++;
    lines.push(`Summary: ${counts.error} error, ${counts.warning} warning, ${counts.info} info`);
  }

  return `${lines.join('\n')}\n`;
}
