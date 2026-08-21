import type { Rule, Finding } from '../types.js';

/**
 * Detects an IF node (typeVersion >= 2.2) whose `parameters.conditions.options`
 * object exists but is missing the `leftValue` key.
 *
 * n8n's v2 IF/Filter node carries a top-level `leftValue` inside
 * `conditions.options` (normally defaulting to `""`). When that key is absent,
 * n8n's own workflow-creation API rejects the node — even when every individual
 * condition under `conditions.conditions[]` already supplies its own
 * `leftValue`. The node looks complete in the editor but cannot be created
 * programmatically.
 */
export const rule: Rule = {
  id: 'if-v2-missing-left-value',
  severity: 'error',
  title: 'IF node v2: conditions.options must carry a leftValue key',
  docs: 'docs/rules/if-v2-missing-left-value.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'if') continue;
      if (node.typeVersion < 2.2) continue;

      const conditions = node.parameters.conditions;
      if (!isPlainObject(conditions)) continue;

      const options = conditions.options;
      if (!isPlainObject(options)) continue;
      if ('leftValue' in options) continue;

      findings.push({
        nodeName: node.name,
        message:
          `The IF node's parameters.conditions.options object has no "leftValue" key. ` +
          `n8n's workflow-creation API rejects the node even though each condition carries its own leftValue.`,
        suggestion:
          `Add "leftValue": "" to parameters.conditions.options (alongside caseSensitive / typeValidation). ` +
          `The value is normally empty — the key just needs to be present.`,
      });
    }

    return findings;
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
