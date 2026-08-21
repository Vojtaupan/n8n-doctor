import type { Rule, Finding } from '../types.js';

/**
 * Detects an n8n expression whose intended terminator is preempted by an
 * adjacent `}}` produced by nested object literals.
 *
 * n8n expressions are delimited by `{{` and `}}`, and the Tournament template
 * engine ends the expression at the *first* `}}` it sees after the opener. When
 * an expression builds a nested object and the developer closes two braces
 * without a separator — `={{ JSON.stringify({ user: { id: $json.id }}) }}` — the
 * `}}` that closes the two objects is read as the expression terminator. The
 * expression is truncated to `{{ JSON.stringify({ user: { id: $json.id ` and the
 * node throws `invalid syntax` at runtime. It looks correct in the editor, saves,
 * and activates; it only fails when the node executes.
 *
 * Detection: walk every parameter string; for each `{{`, take the substring up to
 * the first following `}}` and count its braces. If that span leaves any `{`
 * unclosed, the first `}}` was an inner one from adjacent object closes rather
 * than the intended terminator — fire.
 */
export const rule: Rule = {
  id: 'expression-adjacent-close-braces',
  severity: 'error',
  title: 'Expression: adjacent "}}" from nested objects is read as the expression terminator',
  docs: 'docs/rules/expression-adjacent-close-braces.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      const offending: string[] = [];
      collectOffendingStrings(node.parameters, 'parameters', offending);
      if (offending.length === 0) continue;

      findings.push({
        nodeName: node.name,
        message:
          `An expression closes nested object literals with an adjacent "}}" (at ${offending.join(
            ', ',
          )}). n8n's Tournament template engine reads that first "}}" as the end of the ` +
          `expression, truncating it, and the node throws "invalid syntax" at runtime — even ` +
          `though it looks correct in the editor.`,
        suggestion:
          `Separate the object-closing brace from the expression terminator with a space — write ` +
          `"} }" not "}}". For example ={{ JSON.stringify({ user: { id: $json.id } }) }} rather ` +
          `than ={{ JSON.stringify({ user: { id: $json.id }}) }}.`,
      });
    }

    return findings;
  },
};

/**
 * Recursively collect the parameter paths of every string leaf that contains an
 * expression truncated by adjacent close braces.
 */
function collectOffendingStrings(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    if (hasAdjacentCloseBraces(value)) out.push(path);
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
 * True if the string contains an expression `{{ ... }}` whose first `}}` after
 * the opener leaves unbalanced open braces behind — the signature of nested
 * object literals whose adjacent `}}` collides with the expression terminator.
 */
function hasAdjacentCloseBraces(text: string): boolean {
  let searchFrom = 0;
  for (;;) {
    const open = text.indexOf('{{', searchFrom);
    if (open === -1) return false;

    const bodyStart = open + 2;
    const close = text.indexOf('}}', bodyStart);
    if (close === -1) return false; // no terminator at all — not this rule's concern

    if (braceDepth(text.slice(bodyStart, close)) > 0) return true;
    searchFrom = close + 2;
  }
}

/** Net brace balance of a span: `{` adds one, `}` removes one. */
function braceDepth(span: string): number {
  let depth = 0;
  for (const ch of span) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
