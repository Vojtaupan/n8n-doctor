import type { Rule, Finding } from '../types.js';

/**
 * Detects a Google Sheets API URL whose A1 range carries a literal space in the
 * tab name, e.g. `.../values/Tab Name!A:Z` instead of `.../values/Tab%20Name!A:Z`.
 *
 * The Sheets `values` endpoint takes the A1 range as a path segment:
 * `/v4/spreadsheets/{id}/values/{range}`. When the tab name contains a space it
 * MUST be percent-encoded as `%20`. A literal space is not a valid URL character
 * there, and the Google API does not treat it as the sheet you meant — the GET
 * comes back empty or 404s. There is no error surfaced to the workflow: the HTTP
 * node sees a 2xx (or a 404 that a downstream node ignores) and the run reports
 * success while returning no rows.
 *
 * Because this is a raw Sheets REST URL, it turns up in HTTP Request nodes (and
 * anywhere else a URL string is stored), not in the Google Sheets node — so the
 * rule scans every parameter string rather than restricting to a node type.
 *
 * Detection: the string must reference `sheets.googleapis.com`, and after
 * `/values/` the tab-name segment (everything up to the first `!`, which
 * separates the tab from the cell range) must contain a literal space. An
 * already-encoded `%20` contains no space and does not fire.
 */
export const rule: Rule = {
  id: 'sheets-url-literal-space',
  severity: 'warning',
  title: 'Google Sheets: literal space in an A1 range tab name makes the API request silently 404',
  docs: 'docs/rules/sheets-url-literal-space.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      const offending: string[] = [];
      collectOffendingStrings(node.parameters, 'parameters', offending);
      if (offending.length === 0) continue;

      findings.push({
        nodeName: node.name,
        message:
          `A Google Sheets API URL has a literal space in the tab name of its A1 range (at ${offending.join(
            ', ',
          )}). The space is not valid in a URL path, so the Sheets API does not resolve the tab ` +
          `you meant: the request comes back empty or 404s. Nothing errors — the node sees a ` +
          `response and the run reports success while returning no rows.`,
        suggestion:
          `Percent-encode the space as %20 in the range — write ".../values/Tab%20Name!A:Z" not ` +
          `".../values/Tab Name!A:Z". If you build the URL from an expression, wrap the range in ` +
          `encodeURIComponent() so tab names with spaces are always encoded.`,
      });
    }

    return findings;
  },
};

/**
 * Recursively collect the parameter paths of every string leaf that contains a
 * Sheets API URL with a literal space in its A1 range tab name.
 */
function collectOffendingStrings(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    if (hasLiteralSpaceInSheetsRange(value)) out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectOffendingStrings(v, `${path}[${i}]`, out));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      collectOffendingStrings(v, `${path}.${key}`, out);
    }
  }
}

/**
 * True if the string references the Sheets API and its `/values/<tab>!` segment
 * carries a literal space in the tab name. The tab name runs from `/values/` to
 * the first `!` (the A1 separator between tab and cell range); `/`, `?` and `#`
 * end the segment early and mean there was no A1 range to check.
 */
function hasLiteralSpaceInSheetsRange(text: string): boolean {
  if (!text.includes('sheets.googleapis.com')) return false;

  const range = /\/values\/([^/?#!]*)!/g;
  let match: RegExpExecArray | null;
  while ((match = range.exec(text)) !== null) {
    if (match[1]!.includes(' ')) return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
