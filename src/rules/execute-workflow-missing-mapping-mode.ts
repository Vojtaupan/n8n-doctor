import type { Rule, Finding } from '../types.js';

/**
 * Detects an Execute Workflow node (typeVersion >= 1.3) whose
 * `parameters.workflowInputs` is present but has no `mappingMode` key.
 *
 * At typeVersion 1.3 the sub-workflow inputs became a resource-mapper parameter
 * whose shape is `{ mappingMode, value, schema }`. `mappingMode` selects how the
 * parent supplies inputs (`defineBelow` for an explicit mapping,
 * `autoMapInputData` to pass fields through). When the key is missing, n8n's
 * workflow-creation API silently fails to create the node — no error surfaces in
 * the editor, the mapping simply never takes effect.
 */
export const rule: Rule = {
  id: 'execute-workflow-missing-mapping-mode',
  severity: 'error',
  title: 'Execute Workflow: workflowInputs must carry a mappingMode key',
  docs: 'docs/rules/execute-workflow-missing-mapping-mode.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'executeWorkflow') continue;
      if (node.typeVersion < 1.3) continue;

      const workflowInputs = node.parameters.workflowInputs;
      if (!isPlainObject(workflowInputs)) continue;
      if ('mappingMode' in workflowInputs) continue;

      findings.push({
        nodeName: node.name,
        message:
          `The Execute Workflow node's parameters.workflowInputs has no "mappingMode" key. ` +
          `n8n's workflow-creation API silently fails to create the node, so the sub-workflow inputs never take effect.`,
        suggestion:
          `Add "mappingMode" to parameters.workflowInputs: "defineBelow" to map fields explicitly, ` +
          `or "autoMapInputData" to pass the incoming items straight through.`,
      });
    }

    return findings;
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
