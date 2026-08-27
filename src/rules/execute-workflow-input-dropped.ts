import type { Rule, Finding } from '../types.js';
import type { WorkflowGraph } from '../graph.js';
import type { Context } from '../context.js';

/**
 * Cross-workflow rule. For each Execute Workflow node, resolve the child by id
 * via `ctx.byId` and compare the parent's mapped input keys
 * (`workflowInputs.value`) against the inputs the child's Execute Workflow
 * Trigger actually declares.
 *
 * n8n treats the child's declaration as a whitelist: any input the parent maps
 * whose key is absent from it is **silently discarded at runtime** - no error, no
 * warning, the field simply never arrives at the child. The parent looks like it
 * passes the field; the child never sees it.
 *
 * This is invisible in either file alone and obvious with both in hand, which is
 * exactly the cross-workflow capability the context enables. If the child id is
 * not among the loaded workflows, the rule emits nothing: absence of the file is
 * not evidence of a defect.
 *
 * ## The trigger declares its inputs two ways, and both whitelist
 *
 * - `inputSource: 'jsonExample'` - a pasted JSON object; its top-level keys are
 *   the whitelist.
 * - `inputSource: 'workflowInputs'` - an explicit field list under
 *   `workflowInputs.values[]`; the `name` of each entry is the whitelist. This is
 *   the trigger's **default**, so `inputSource` is frequently absent when it is in
 *   use, and an absent key with a field list present means this mode.
 *
 * An earlier version of this rule handled only `jsonExample`. That left the more
 * common of the two modes entirely uncovered by an `error`-severity rule, which
 * a full corpus run made visible: every child that declared inputs there did so
 * with a field list, and not one used a JSON example.
 *
 * The third mode, `inputSource: 'passthrough'`, declares nothing and whitelists
 * nothing - it forwards the parent's upstream `$json` verbatim and ignores the
 * mapping outright. That is a different defect and belongs to
 * `execute-workflow-passthrough-ignores-mapping`; this rule skips it.
 */
export const rule: Rule = {
  id: 'execute-workflow-input-dropped',
  severity: 'error',
  title: 'Execute Workflow: mapped inputs the child does not declare are silently dropped',
  docs: 'docs/rules/execute-workflow-input-dropped.md',

  check(graph: WorkflowGraph, ctx: Context) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'executeWorkflow') continue;

      const workflowInputs = node.parameters.workflowInputs;
      // Under `autoMapInputData` the parent forwards the incoming item and the
      // `value` map is inert UI state that n8n never applies, so comparing it
      // against the child's declaration would accuse a mapping with no effect.
      if (isPlainObject(workflowInputs) && workflowInputs.mappingMode === 'autoMapInputData') {
        continue;
      }

      const parentKeys = mappedInputKeys(workflowInputs);
      if (parentKeys.length === 0) continue;

      const childId = resolveWorkflowId(node.parameters.workflowId);
      if (childId === undefined) continue;

      const child = ctx.byId.get(childId);
      if (child === undefined) continue; // child not loaded: not our evidence

      const declared = declaredInputs(child);
      if (declared === undefined) continue; // child declares no whitelist

      const dropped = parentKeys.filter((key) => !declared.keys.includes(key));
      if (dropped.length === 0) continue;

      const list = dropped.map((k) => `"${k}"`).join(', ');
      const verb = dropped.length === 1 ? 'is' : 'are';
      findings.push({
        nodeName: node.name,
        message:
          `The Execute Workflow node maps ${list}, but the sub-workflow "${child.name}" does not ` +
          `declare ${dropped.length === 1 ? 'that key' : 'those keys'} in its Execute Workflow Trigger ` +
          `${declared.source}. n8n silently discards any input key the child does not declare, so ` +
          `${list} ${verb} never delivered to the child - no error is raised.`,
        suggestion:
          `Add ${list} to the sub-workflow's Execute Workflow Trigger ${declared.source}, or drop the ` +
          `unused mapping from the parent so the mapping reflects what the child actually receives.`,
      });
    }

    return findings;
  },
};

/** What a child's Execute Workflow Trigger declares, and what to call it in a message. */
interface DeclaredInputs {
  keys: string[];
  /** How the child declares them, phrased to drop into a sentence. */
  source: string;
}

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
 * The input keys a child's Execute Workflow Trigger whitelists, in whichever of
 * the two declaring modes it uses.
 *
 * Returns `undefined` when there is no whitelist to compare against: no trigger,
 * an explicit `passthrough` source, a JSON example that is not a parseable JSON
 * object, or a field list that is absent or malformed. In every one of those
 * cases the child does not constrain its inputs, so nothing can be dropped.
 */
function declaredInputs(child: WorkflowGraph): DeclaredInputs | undefined {
  const trigger = child.nodes.find((n) => child.shortType(n) === 'executeWorkflowTrigger');
  if (trigger === undefined) return undefined;

  const inputSource = trigger.parameters.inputSource;
  if (inputSource === 'passthrough') return undefined;

  if (inputSource === 'jsonExample') {
    const example = trigger.parameters.jsonExample;
    if (typeof example !== 'string') return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(example);
    } catch {
      return undefined;
    }
    if (!isPlainObject(parsed)) return undefined;
    return { keys: Object.keys(parsed), source: 'JSON example' };
  }

  // The field-list mode, either declared explicitly or left at its default -
  // which is why an absent `inputSource` with a field list present counts.
  if (inputSource === 'workflowInputs' || inputSource === undefined) {
    const workflowInputs = trigger.parameters.workflowInputs;
    if (!isPlainObject(workflowInputs)) return undefined;
    const values = workflowInputs.values;
    if (!Array.isArray(values)) return undefined;

    const keys = values
      .map((entry) => (isPlainObject(entry) ? entry.name : undefined))
      .filter((name): name is string => typeof name === 'string');
    if (keys.length === 0) return undefined;
    return { keys, source: 'input field list' };
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
