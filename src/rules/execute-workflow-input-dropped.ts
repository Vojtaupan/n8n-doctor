import type { Rule, Finding } from '../types.js';
import type { WorkflowGraph } from '../graph.js';
import type { Context } from '../context.js';

/**
 * Cross-workflow rule. For each Execute Workflow node, resolve the child by id
 * via `ctx.byId`. If the child's Execute Workflow Trigger declares its inputs
 * with `inputSource: 'jsonExample'`, compare the parent's mapped input keys
 * (`workflowInputs.value`) against the keys of that example.
 *
 * n8n treats the trigger's JSON example as a whitelist: any input the parent
 * maps whose key is absent from the example is **silently discarded at runtime**
 * — no error, no warning, the field simply never arrives at the child. The
 * parent looks like it passes the field; the child never sees it.
 *
 * This is invisible in either file alone and obvious with both in hand, which is
 * exactly the cross-workflow capability the context enables. If the child id is
 * not among the loaded workflows, the rule emits nothing: absence of the file is
 * not evidence of a defect.
 */
export const rule: Rule = {
  id: 'execute-workflow-input-dropped',
  severity: 'error',
  title: 'Execute Workflow: mapped inputs absent from the child jsonExample are silently dropped',
  docs: 'docs/rules/execute-workflow-input-dropped.md',

  check(graph: WorkflowGraph, ctx: Context) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'executeWorkflow') continue;

      const parentKeys = mappedInputKeys(node.parameters.workflowInputs);
      if (parentKeys.length === 0) continue;

      const childId = resolveWorkflowId(node.parameters.workflowId);
      if (childId === undefined) continue;

      const child = ctx.byId.get(childId);
      if (child === undefined) continue; // child not loaded: not our evidence

      const exampleKeys = jsonExampleKeys(child);
      if (exampleKeys === undefined) continue; // child does not use jsonExample

      const dropped = parentKeys.filter((key) => !exampleKeys.includes(key));
      if (dropped.length === 0) continue;

      const list = dropped.map((k) => `"${k}"`).join(', ');
      const verb = dropped.length === 1 ? 'is' : 'are';
      findings.push({
        nodeName: node.name,
        message:
          `The Execute Workflow node maps ${list}, but the sub-workflow "${child.name}" does not ` +
          `declare ${dropped.length === 1 ? 'that key' : 'those keys'} in its Execute Workflow Trigger ` +
          `JSON example. n8n silently discards any input key absent from the example, so ${list} ${verb} ` +
          `never delivered to the child — no error is raised.`,
        suggestion:
          `Add ${list} to the sub-workflow's Execute Workflow Trigger JSON example (inputSource: ` +
          `"jsonExample"), or drop the unused mapping from the parent so the mapping reflects what the ` +
          `child actually receives.`,
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
 * The declared input keys of a child's Execute Workflow Trigger when it uses
 * `inputSource: 'jsonExample'`. Returns `undefined` when the child has no such
 * trigger or does not use the jsonExample source, or when the example is not a
 * parseable JSON object — in all those cases there is no whitelist to compare
 * against.
 */
function jsonExampleKeys(child: WorkflowGraph): string[] | undefined {
  const trigger = child.nodes.find((n) => child.shortType(n) === 'executeWorkflowTrigger');
  if (trigger === undefined) return undefined;
  if (trigger.parameters.inputSource !== 'jsonExample') return undefined;

  const example = trigger.parameters.jsonExample;
  if (typeof example !== 'string') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(example);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) return undefined;
  return Object.keys(parsed);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
