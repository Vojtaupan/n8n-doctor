import type { Rule, Finding } from '../types.js';

/**
 * Detects a Google Sheets write that stores values as if a person had typed
 * them, rather than verbatim.
 *
 * The Google Sheets API offers two input modes when you write cells. `RAW`
 * stores each value exactly as sent. `USER_ENTERED` runs every value through the
 * same parser Sheets uses when a person types into a cell - and that parser is
 * lossy for data:
 *
 * - A string beginning with `=` becomes a formula.
 * - A string beginning with `+` or `-` (phone numbers like `+1-617-555-0142`) is
 *   read as an arithmetic expression and evaluates to a number.
 * - ISO timestamps and dates coerce to Sheets' own serial date type, and read
 *   back as a locale-formatted display string that no longer round-trips.
 * - Leading-zero codes (zip codes, SKUs like `007`) lose their zeros.
 *
 * The write succeeds, the workflow reports success, and the stored data quietly
 * differs from what the workflow produced.
 *
 * ## Why this looks for three key names in two places
 *
 * The same setting has three different names depending on how the write is made,
 * and only one of them is ever a parameter *key*:
 *
 * - `cellFormat` - the n8n Google Sheets node at v4.
 * - `valueInputMode` - the same option on other Google Sheets node versions.
 * - `valueInputOption` - the Google Sheets REST API's own field name, which is
 *   what you write when you call the API from an HTTP Request node.
 *
 * An earlier version of this rule matched only `valueInputOption`, and only as a
 * parameter key. That combination cannot occur: the n8n node never uses the API's
 * field name, and an HTTP Request node carries it inside a **string** - the URL
 * query (`...values:append?valueInputOption=USER_ENTERED`) or a `jsonBody` - where
 * it is part of a value and never a key. The rule was therefore structurally
 * unable to fire, which is exactly what a full corpus run showed. So this scans
 * for the key both as a parameter key and as an assignment inside any parameter
 * string.
 *
 * Both forms require the key and the value **together**. A node that merely
 * mentions `USER_ENTERED` somewhere - a comment, a doc string, a branch that
 * chooses between modes - is not evidence of a write configured that way, and
 * matching the value alone would flag it.
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
          `A Google Sheets write asks for USER_ENTERED input (at ${paths.join(
            ', ',
          )}). Sheets then evaluates every written value as if a person typed it: strings ` +
          `beginning "=" become formulas, phone numbers beginning "+" or "-" become arithmetic, ISO ` +
          `timestamps coerce to Sheets dates that no longer round-trip, and leading-zero codes lose ` +
          `their zeros. The write succeeds and the workflow reports success, but the stored data no ` +
          `longer matches what you sent.`,
        suggestion: suggestionFor(graph.shortType(node), node.typeVersion, paths),
      });
    }

    return findings;
  },
};

/**
 * The three names this setting goes by. `cellFormat` and `valueInputMode` are
 * the n8n Google Sheets node's own option names; `valueInputOption` is the
 * Google Sheets REST API field, used when calling the API directly.
 */
const OPTION_KEYS = ['valueInputOption', 'cellFormat', 'valueInputMode'] as const;

/**
 * One of the option names assigned `USER_ENTERED` inside a string. Covers the URL
 * query form (`valueInputOption=USER_ENTERED`), the JSON form
 * (`"valueInputOption": "USER_ENTERED"`) and the expression form
 * (`{ valueInputOption: 'USER_ENTERED' }`), with any spacing.
 *
 * Both quote characters are allowed on purpose. An n8n expression body is
 * JavaScript, so the option is written single-quoted far more often than
 * double-quoted; an earlier version of this pattern permitted only `"` and
 * silently missed every expression-built request, which is the dominant form in
 * practice.
 *
 * Requiring the assignment is what keeps a passing mention of `USER_ENTERED` from
 * counting as a configured write.
 */
const ASSIGNED_IN_STRING = new RegExp(
  `(?:${OPTION_KEYS.join('|')})["']?\\s*[=:]\\s*["']?USER_ENTERED`,
);

/**
 * Recursively collect the parameter paths at which this write is configured
 * `USER_ENTERED`, in either form: as a parameter key whose value is exactly
 * `USER_ENTERED`, or as a string that assigns one of the option names that value.
 */
function collectUserEnteredPaths(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    if (ASSIGNED_IN_STRING.test(value)) out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectUserEnteredPaths(v, `${path}[${i}]`, out));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (isOptionKey(key) && v === 'USER_ENTERED') {
        out.push(childPath);
        continue; // already recorded; recursing into a string value would double-count
      }
      collectUserEnteredPaths(v, childPath, out);
    }
  }
}

/**
 * Name the option that actually changes the behaviour, which depends on which
 * node is making the write.
 *
 * This is not cosmetic. The n8n Google Sheets node has two generations and they
 * read different keys: the v1 node uses `valueInputMode`, the v2 node
 * (`typeVersion >= 4.1`) reads only `cellFormat`. A `valueInputMode` left on a v2
 * node is **inert** - n8n ignores it and falls back to the version default, which
 * from 4.1 onward is `USER_ENTERED`. Telling that author to set `valueInputMode`
 * to RAW would have them change a key that does nothing, watch the data corrupt
 * anyway, and conclude the linter was wrong.
 */
function suggestionFor(shortType: string, typeVersion: number, paths: string[]): string {
  const tail =
    ' Use USER_ENTERED only when you deliberately want Sheets to parse formulas or reformat input.';

  if (shortType === 'googleSheets') {
    if (typeVersion >= 4.1) {
      const inert = paths.some((p) => p.endsWith('.valueInputMode'))
        ? ` Note that "valueInputMode" is the v1 node's option name and is ignored at this ` +
          `typeVersion, so setting it to RAW would change nothing - the version default, ` +
          `USER_ENTERED from 4.1 onward, would still apply.`
        : '';
      return (
        `Set options.cellFormat to "RAW" so values are stored verbatim, exactly as the workflow ` +
        `produced them.${inert}${tail}`
      );
    }
    return (
      `Set options.valueInputMode to "RAW" so values are stored verbatim, exactly as the workflow ` +
      `produced them.${tail}`
    );
  }

  return (
    `Send valueInputOption=RAW instead, so values are stored verbatim exactly as the workflow ` +
    `produced them.${tail}`
  );
}

function isOptionKey(key: string): boolean {
  return (OPTION_KEYS as readonly string[]).includes(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
