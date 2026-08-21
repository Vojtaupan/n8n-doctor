import type { Rule, Finding } from '../types.js';

/** Short node types whose every output is a mutually exclusive branch. */
const BRANCHING_TYPES = new Set(['if', 'switch']);

/**
 * Detects a Merge node in "Combine → Combine All" mode whose input traces back to
 * a branch output of an IF or Switch node.
 *
 * `mode: 'combine'` with `combineBy: 'combineAll'` takes the cross-product of every
 * input: each item on input 1 is paired with every item on input 2, and so on.
 * A cross-product with an empty side is empty — pair anything with zero items and
 * you get zero items out. When one of the Merge's inputs traces back to a branch
 * output of an IF or Switch, that branch is empty whenever the condition sends all
 * items the other way, so the Merge emits nothing and everything downstream
 * silently vanishes. Nothing errors; the run reports success on an empty result.
 *
 * Signature: Merge node at `typeVersion >= 3` with `parameters.mode === 'combine'`
 * and `parameters.combineBy === 'combineAll'`, where at least one transitive
 * ancestor is an IF or Switch node (every edge leaving one is a branch output).
 */
export const rule: Rule = {
  id: 'merge-combine-all-empty-input',
  severity: 'warning',
  title: 'Merge (Combine All): a conditional-branch input can empty the cross-product to zero items',
  docs: 'docs/rules/merge-combine-all-empty-input.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'merge') continue;
      if (node.typeVersion < 3) continue;
      if (node.parameters.mode !== 'combine') continue;
      if (node.parameters.combineBy !== 'combineAll') continue;

      // At least one input traces back to a branch output of an IF/Switch? Every edge
      // leaving an IF/Switch is one of its branch outputs, so an IF/Switch appearing
      // among the transitive ancestors is exactly that condition.
      const branch = graph
        .ancestorsOf(node.name)
        .find((ancestor) => BRANCHING_TYPES.has(graph.shortType(ancestor)));
      if (!branch) continue;

      findings.push({
        nodeName: node.name,
        message:
          `Merge is in "Combine → Combine All" mode and one of its inputs traces back to a branch ` +
          `output of "${branch.name}" (${graph.shortType(branch)}). Combine All takes the ` +
          `cross-product of its inputs, and a cross-product with an empty side is empty — whenever ` +
          `that branch sends no items, the Merge emits nothing and every downstream node is skipped. ` +
          `No error is raised, so the run reports success on an empty result.`,
        suggestion:
          `Use mode "append" instead of "combine"/"combineAll" so the inputs are concatenated: an ` +
          `empty branch then contributes nothing rather than annihilating the other input. Only keep ` +
          `Combine All if every input is guaranteed to carry at least one item.`,
      });
    }

    return findings;
  },
};
