import type { Rule, Finding } from '../types.js';

/**
 * Detects an HTTP Request node whose `parameters.jsonBody` splices an expression
 * directly into the JSON as a *value*, outside any string literal:
 *
 *   ={ "userId": {{ $json.id }} }        <- flagged
 *   ={ "name": "{{ $json.name }}" }      <- fine, and extremely common
 *
 * A parameter value starting with `=` is an expression TEMPLATE: literal text
 * with `{{ }}` holes interpolated into it. Interpolating inside a JSON string is
 * the idiomatic, working shape — n8n substitutes the value and the surrounding
 * quotes keep the result valid JSON.
 *
 * Splicing a hole in as a bare value is the dangerous shape. Whatever the
 * expression returns is pasted in unquoted, so the body is valid JSON only while
 * the result happens to be a number, boolean, or null. The moment it resolves to
 * a string — an id that arrives as "42", a name, anything containing a quote,
 * comma, or newline — the request body is malformed and the node fails at
 * runtime. Nothing catches it in the editor, and it usually survives testing
 * because the sample data happens to be numeric.
 *
 * NB on scope: an earlier version of this rule flagged any body where a literal
 * `{` preceded the first `{{`, on the theory that n8n cannot parse a JSON literal
 * containing holes. Measured against a 479-workflow production corpus that
 * produced 164 findings across 95 workflows, nearly all of them working code — so
 * the premise was wrong. The genuinely fatal parse case, an expression hole
 * abutting a literal `}` so the template engine reads `}}` as its terminator, is
 * a different defect and belongs to `expression-adjacent-close-braces`.
 */
export const rule: Rule = {
  id: 'http-json-body-inline-expression',
  severity: 'error',
  title: 'HTTP Request: expression spliced into JSON as an unquoted value',
  docs: 'docs/rules/http-json-body-inline-expression.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'httpRequest') continue;

      const jsonBody = node.parameters.jsonBody;
      if (typeof jsonBody !== 'string') continue;
      if (!jsonBody.startsWith('=')) continue;

      const unquoted = findUnquotedHoles(jsonBody.slice(1));
      if (unquoted.length === 0) continue;

      const sample = unquoted[0]!;
      const count =
        unquoted.length === 1 ? 'an expression' : `${unquoted.length} expressions`;

      findings.push({
        nodeName: node.name,
        message:
          `parameters.jsonBody splices ${count} into the JSON as a bare value, outside any ` +
          `string literal (e.g. ${sample}). The result is pasted in unquoted, so the body is ` +
          `valid JSON only while the expression returns a number, boolean, or null. As soon as ` +
          `it resolves to a string — or to anything containing a quote, comma, or newline — the ` +
          `request body is malformed and the node fails at runtime. The editor shows nothing, ` +
          `and numeric test data hides it.`,
        suggestion:
          `Quote the hole ("${sample}") if the value is a string, or build the whole body in a ` +
          `single expression — ={{ JSON.stringify({ userId: $json.id }) }} — which quotes and ` +
          `escapes every value correctly.`,
      });
    }

    return findings;
  },
};

/**
 * Returns the `{{ ... }}` holes that sit outside any JSON string literal.
 *
 * Walks the body tracking string context rather than scanning with indexOf,
 * because whether a hole is quoted is exactly what separates the safe idiom from
 * the bug — and that cannot be decided by looking for a `{` alone.
 */
function findUnquotedHoles(body: string): string[] {
  // The whole body being one expression is the RECOMMENDED shape, not a defect:
  // ={{ JSON.stringify({ ... }) }} builds the JSON in code and escapes correctly.
  // It has no surrounding JSON literal, so there is nothing to splice into.
  const trimmed = body.trim();
  if (
    trimmed.startsWith('{{') &&
    trimmed.endsWith('}}') &&
    trimmed.indexOf('}}') === trimmed.length - 2
  ) {
    return [];
  }

  const holes: string[] = [];
  let inString = false;
  let i = 0;

  while (i < body.length) {
    const ch = body[i]!;

    if (inString) {
      if (ch === '\\') {
        i += 2; // escaped char: consume both so \" never toggles the string
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      i++;
      continue;
    }

    if (ch === '{' && body[i + 1] === '{') {
      const end = body.indexOf('}}', i + 2);
      if (end === -1) break; // unterminated hole - not this rule's defect to report
      const hole = body.slice(i, end + 2).replace(/\s+/g, ' ');
      // A hole that already calls JSON.stringify() emits a quoted, escaped JSON
      // value, so splicing it unquoted is correct - it is precisely the fix this
      // rule recommends. Flagging it reported the remedy as the disease.
      if (!/\bJSON\s*\.\s*stringify\s*\(/.test(hole)) holes.push(hole);
      i = end + 2;
      continue;
    }

    i++;
  }

  return holes;
}
