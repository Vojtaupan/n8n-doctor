import type { Rule, Finding } from '../types.js';

/**
 * Detects a Switch node (typeVersion >= 3) whose `options` key is nested inside
 * `parameters.rules` instead of at the `parameters` root.
 *
 * n8n expects `options` as a sibling of `rules`. When it is nested one level too
 * deep, activating the workflow fails with a cryptic `propertyValues` error and
 * the Switch never runs — the editor gives no hint that a misplaced key is the
 * cause.
 */
export const rule: Rule = {
  id: 'switch-options-placement',
  severity: 'error',
  title: 'Switch node: options must be at the parameters root, not inside rules',
  docs: 'docs/rules/switch-options-placement.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'switch') continue;
      if (node.typeVersion < 3) continue;

      const rules = node.parameters.rules;
      if (isPlainObject(rules) && 'options' in rules) {
        findings.push({
          nodeName: node.name,
          message:
            `"options" is nested inside parameters.rules instead of at the parameters root. ` +
            `Activating the workflow fails with a cryptic "propertyValues" error and the Switch never runs.`,
          suggestion:
            `Move "options" out of parameters.rules to the parameters root, as a sibling of "rules": ` +
            `"parameters": { "rules": { "values": [...] }, "options": {...} }.`,
        });
      }
    }

    return findings;
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
