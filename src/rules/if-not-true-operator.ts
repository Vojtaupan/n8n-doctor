import type { Rule, Finding } from '../types.js';

/**
 * Detects an IF or Filter node whose conditions use the boolean `notTrue`
 * operator — `{ type: 'boolean', operation: 'notTrue' }`.
 *
 * `notTrue` routes inconsistently: it is not the clean inverse of `true` that it
 * appears to be, because null/undefined/empty left values fall through in ways
 * that differ from a plain `true` test. The reliable pattern is to test for
 * `true` and swap the true/false branches instead, so the routing follows a
 * single, well-defined boolean test.
 */
export const rule: Rule = {
  id: 'if-not-true-operator',
  severity: 'warning',
  title: 'IF/Filter node: the boolean notTrue operator routes inconsistently',
  docs: 'docs/rules/if-not-true-operator.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      const shortType = graph.shortType(node);
      if (shortType !== 'if' && shortType !== 'filter') continue;

      if (usesNotTrue(node.parameters)) {
        findings.push({
          nodeName: node.name,
          message:
            `A condition uses the boolean "notTrue" operator. ` +
            `notTrue routes inconsistently — it is not a clean inverse of "true", and empty or ` +
            `missing left values fall through unpredictably.`,
          suggestion:
            `Replace the operator with { "type": "boolean", "operation": "true" } and swap the ` +
            `true/false branches so routing follows a single, well-defined boolean test.`,
        });
      }
    }

    return findings;
  },
};

/**
 * True if any operator nested anywhere under the node parameters is the boolean
 * `notTrue` operator. Walking recursively keeps the rule robust across the v2
 * `conditions.conditions[]` array shape without hard-coding a single path.
 */
function usesNotTrue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(usesNotTrue);
  }
  if (isPlainObject(value)) {
    if (value.type === 'boolean' && value.operation === 'notTrue') {
      return true;
    }
    return Object.values(value).some(usesNotTrue);
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
