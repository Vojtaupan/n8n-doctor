import type { Rule, Finding } from '../types.js';

/**
 * Detects a Set node (typeVersion >= 3.3) where `includeOtherFields` is nested
 * under `parameters.options` or `parameters.assignments` instead of at the
 * `parameters` root.
 *
 * n8n silently ignores the flag when it is misplaced, causing all upstream
 * fields to be dropped downstream — webhook bodies vanish with no error.
 */
export const setIncludeOtherFields: Rule = {
  id: 'set-include-other-fields',
  severity: 'error',
  title: 'Set node: includeOtherFields must be at the parameters root',
  docs: 'docs/rules/set-include-other-fields.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'set') continue;
      if (node.typeVersion < 3.3) continue;

      const params = node.parameters;

      // Check if includeOtherFields is misplaced inside options or assignments
      const misplacedInOptions =
        isPlainObject(params.options) &&
        (params.options as Record<string, unknown>).includeOtherFields;

      const misplacedInAssignments =
        isPlainObject(params.assignments) &&
        (params.assignments as Record<string, unknown>).includeOtherFields;

      if (misplacedInOptions || misplacedInAssignments) {
        findings.push({
          nodeName: node.name,
          message:
            `"includeOtherFields" is nested under ${misplacedInOptions ? 'parameters.options' : 'parameters.assignments'} ` +
            `instead of the parameters root. n8n silently ignores the misplaced flag and drops all upstream fields downstream.`,
          suggestion:
            `Move "includeOtherFields" to the parameters root ` +
            `(e.g. "parameters": { "includeOtherFields": true, "options": {}, ... }). ` +
            `Placing it anywhere other than the parameters root causes it to be silently ignored.`,
        });
      }
    }

    return findings;
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
