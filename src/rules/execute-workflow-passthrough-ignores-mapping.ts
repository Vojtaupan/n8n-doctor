import type { Rule, Finding } from '../types.js';
import type { WorkflowGraph } from '../graph.js';
import type { Context } from '../context.js';

/**
 * Cross-workflow rule. For each Execute Workflow node that maps inputs
 * (`workflowInputs.value` non-empty), resolve the child by id via `ctx.byId`.
 * If the child's Execute Workflow Trigger uses `inputSource: 'passthrough'`, the
 * child ignores the mapping entirely: it receives the parent's upstream `$json`
 * verbatim. So the mapping is a lie about what the child actually sees — the
 * author declares specific fields, and the child gets the raw upstream item
 * instead.
 *
 * If the child id is not among the loaded workflows, the rule emits nothing:
 * absence of the file is not evidence of a defect. Load the parent and child
 * together (a directory or glob) to get this check.
 */
export const rule: Rule = {
  id: 'execute-workflow-passthrough-ignores-mapping',
  severity: 'warning',
  title:
    'Execute Workflow: parent maps inputs but the child trigger is passthrough, so the mapping is ignored',
  docs: 'docs/rules/execute-workflow-passthrough-ignores-mapping.md',

  check(graph: WorkflowGraph, ctx: Context) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'executeWorkflow') continue;

      const mappedKeys = mappedInputKeys(node.parameters.workflowInputs);
      if (mappedKeys.length === 0) continue;

      const childId = resolveWorkflowId(node.parameters.workflowId);
      if (childId === undefined) continue;

      const child = ctx.byId.get(childId);
      if (child === undefined) continue; // child not loaded: not our evidence

      if (!childTriggerIsPassthrough(child)) continue;

      const list = mappedKeys.map((k) => `"${k}"`).join(', ');
      const verb = mappedKeys.length === 1 ? 'is' : 'are';
      findings.push({
        nodeName: node.name,
        message:
          `The Execute Workflow node maps ${list}, but the sub-workflow "${child.name}" declares its ` +
          `Execute Workflow Trigger input source as "passthrough". A passthrough trigger forwards the ` +
          `parent's upstream $json unchanged and ignores the mapping entirely, so ${list} ${verb} silently ` +
          `discarded — the mapping describes inputs the child never receives.`,
        suggestion:
          `Either change the sub-workflow's Execute Workflow Trigger to declare its inputs (inputSource ` +
          `"Define using fields below" or "Define using JSON example") so the mapping is honoured, or ` +
          `remove the mapping from the parent and shape the child's input upstream, since passthrough ` +
          `forwards $json as-is.`,
      });
    }

    return findings;
  },
};

/** Read the mapped-input keys from an Execute Workflow node's `workflowInputs.value`. */
function mappedInputKeys(workflowInputs: unknown): string[] {
  if (!isPlainObject(workflowInputs)) return [];
  const value = workflowInputs.value;
  if (!isPlainObject(value)) return [];
  return Object.keys(value);
}

/**
 * Extract the id the parent points at. n8n stores `workflowId` either as a
 * resource-locator object `{ value, mode }` or, in older exports, a bare string.
 */
function resolveWorkflowId(workflowId: unknown): string | undefined {
  if (typeof workflowId === 'string') return workflowId;
  if (isPlainObject(workflowId) && typeof workflowId.value === 'string') return workflowId.value;
  return undefined;
}

/**
 * Whether the child's Execute Workflow Trigger accepts inputs by passthrough.
 * Only an explicit `inputSource: 'passthrough'` counts — an absent or differently
 * declared source means the trigger shapes its own inputs and the mapping is not
 * ignored, so there is nothing to warn about.
 */
function childTriggerIsPassthrough(child: WorkflowGraph): boolean {
  const trigger = child.nodes.find((n) => child.shortType(n) === 'executeWorkflowTrigger');
  if (trigger === undefined) return false;
  return trigger.parameters.inputSource === 'passthrough';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
