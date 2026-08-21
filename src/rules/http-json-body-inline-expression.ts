import type { Rule, Finding } from '../types.js';

/**
 * Detects an HTTP Request node (typeVersion >= 4) whose `parameters.jsonBody` is
 * an expression (starts with `=`) that embeds inline `{{ }}` holes inside a JSON
 * literal, instead of wrapping the whole body in a single expression.
 *
 * When `jsonBody` starts with `=`, n8n evaluates the entire value as one
 * expression and expects it to resolve to valid JSON — the idiomatic shape is
 * `={{ JSON.stringify({ ... }) }}`, where the object is built in code. Writing a
 * JSON literal with expression holes punched into it
 * (`={ "id": {{ $json.id }} }`) is not a valid expression: n8n's Tournament
 * template engine parses the leading literal `{` as expression syntax and the
 * node throws at runtime. It passes every editor and schema check and only fails
 * when the node actually runs.
 *
 * Signature: the body starts with `=`, contains an expression opener `{{`, and a
 * literal `{` appears *before* that first `{{` — the tell that the body is a JSON
 * literal wrapping the expression rather than being wrapped by it.
 */
export const rule: Rule = {
  id: 'http-json-body-inline-expression',
  severity: 'error',
  title: 'HTTP Request: wrap the whole JSON body in one expression, not inline {{ }} holes',
  docs: 'docs/rules/http-json-body-inline-expression.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'httpRequest') continue;
      if (node.typeVersion < 4) continue;

      const jsonBody = node.parameters.jsonBody;
      if (typeof jsonBody !== 'string') continue;
      if (!jsonBody.startsWith('=')) continue;

      const body = jsonBody.slice(1);
      const firstExpr = body.indexOf('{{');
      if (firstExpr === -1) continue;
      if (!body.slice(0, firstExpr).includes('{')) continue;

      findings.push({
        nodeName: node.name,
        message:
          `parameters.jsonBody is an expression (it starts with "=") but embeds inline {{ }} ` +
          `expressions inside a JSON literal. n8n parses the leading literal "{" as expression ` +
          `syntax and the node throws "invalid syntax" at runtime, even though the body looks valid ` +
          `in the editor.`,
        suggestion:
          `Wrap the whole body in a single expression that returns valid JSON, e.g. ` +
          `={{ JSON.stringify({ userId: $json.id, name: $json.name }) }}, instead of punching ` +
          `{{ }} holes into a JSON literal.`,
      });
    }

    return findings;
  },
};
