import type { Rule, Finding } from '../types.js';

/**
 * Detects a Google Sheets write configured with `valueInputOption: 'USER_ENTERED'`.
 *
 * The Google Sheets API offers two input modes when you write cells. `RAW`
 * stores each value exactly as sent. `USER_ENTERED` runs every value through the
 * same parser Sheets uses when a person types into a cell — and that parser is
 * lossy for data:
 *
 * - A string beginning with `=` becomes a formula.
 * - A string beginning with `+` (phone numbers like `+14155550123`) is read as
 *   an arithmetic expression and errors or turns into a number.
 * - ISO timestamps and dates coerce to Sheets' own serial date type.
 * - Leading-zero codes (zip codes, SKUs like `007`) lose their zeros.
 *
 * The write succeeds, the workflow reports success, and the stored data quietly
 * differs from what the workflow produced. Because `valueInputOption` is the
 * Google Sheets API's own field name, this rule scans for it on any node — the
 * Google Sheets node itself, or an HTTP Request node calling the Sheets API
 * directly — rather than restricting to a single node type.
 */
export const rule: Rule = {
  id: 'sheets-user-entered-for-data',
  severity: 'warning',
  title: 'Google Sheets: USER_ENTERED reinterprets written values as if typed; use RAW for data',
  docs: 'docs/rules/sheets-user-entered-for-data.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      const paths: string[] = [];
      collectUserEnteredPaths(node.parameters, 'parameters', paths);
      if (paths.length === 0) continue;

      findings.push({
        nodeName: node.name,
        message:
          `A Google Sheets write sets valueInputOption to "USER_ENTERED" (at ${paths.join(
            ', ',
          )}). Sheets then evaluates every written value as if a person typed it: strings ` +
          `beginning "=" become formulas, phone numbers beginning "+" become arithmetic, ISO ` +
          `timestamps coerce to Sheets dates, and leading-zero codes lose their zeros. The write ` +
          `succeeds and the workflow reports success, but the stored data no longer matches what ` +
          `you sent.`,
        suggestion:
          `Set valueInputOption to "RAW" so values are stored verbatim, exactly as the workflow ` +
          `produced them. Use "USER_ENTERED" only when you deliberately want Sheets to parse ` +
          `formulas or reformat input.`,
      });
    }

    return findings;
  },
};

/**
 * Recursively collect the parameter paths of every `valueInputOption` key whose
 * value is exactly `USER_ENTERED`, wherever it is nested inside the parameters.
 */
function collectUserEnteredPaths(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectUserEnteredPaths(v, `${path}[${i}]`, out));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (key === 'valueInputOption' && v === 'USER_ENTERED') out.push(childPath);
      collectUserEnteredPaths(v, childPath, out);
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
