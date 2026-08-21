import type { Rule, Finding } from '../types.js';

/** Short node types every one of whose outputs is a mutually exclusive branch. */
const BRANCHING_TYPES = new Set(['if', 'switch']);

/**
 * Detects a non-Merge node fed by two or more mutually exclusive branch outputs of
 * the same IF or Switch node.
 *
 * An IF or Switch routes each item down exactly one of its outputs, so its branches
 * are mutually exclusive: an item that leaves output 0 never also leaves output 1.
 * When two different outputs of the same IF/Switch feed the same downstream node, that
 * node runs **once per branch that carries items** — up to once per parent completion —
 * rather than once after all its inputs are ready. Downstream work then executes twice
 * (or on partial data) on exactly the runs where both branches carry items.
 *
 * A Merge node is the correct place to fan mutually exclusive branches back together,
 * so Merge targets are exempt. The naive "more than one parent" shape hit 282 nodes on
 * the corpus and is wrong; the real defect is this narrowed shape — two or more edges
 * from a single IF/Switch at different output indices landing on one non-Merge node.
 */
export const rule: Rule = {
  id: 'mutually-exclusive-fan-in',
  severity: 'warning',
  title: 'Non-Merge node fed by two mutually exclusive branches of the same IF/Switch',
  docs: 'docs/rules/mutually-exclusive-fan-in.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      // A Merge is the intended place to recombine mutually exclusive branches.
      if (graph.shortType(node) === 'merge') continue;

      // Group inbound edges by their branching source, collecting the distinct output
      // indices each IF/Switch feeds this node from.
      const branchOutputs = new Map<string, Set<number>>();
      for (const edge of graph.parentsOf(node.name)) {
        const parent = graph.nodeByName(edge.from);
        if (!parent || !BRANCHING_TYPES.has(graph.shortType(parent))) continue;
        const outputs = branchOutputs.get(edge.from);
        if (outputs) outputs.add(edge.outputIndex);
        else branchOutputs.set(edge.from, new Set([edge.outputIndex]));
      }

      // Fire when any single IF/Switch feeds this node from two or more of its outputs.
      for (const [sourceName, outputs] of branchOutputs) {
        if (outputs.size < 2) continue;
        const source = graph.nodeByName(sourceName)!;
        const indices = [...outputs].sort((a, b) => a - b).join(' and ');
        findings.push({
          nodeName: node.name,
          message:
            `"${node.name}" is fed by outputs ${indices} of "${sourceName}" ` +
            `(${graph.shortType(source)}), whose branches are mutually exclusive. It therefore ` +
            `runs once per branch that carries items — up to once per parent completion — instead ` +
            `of once after all inputs are ready, so downstream work executes twice (or on partial ` +
            `data) whenever more than one branch carries items.`,
          suggestion:
            `Route the branches of "${sourceName}" through a Merge node in "append" mode first, ` +
            `then feed "${node.name}" from the Merge's single output so it runs once on the ` +
            `combined result.`,
        });
        break; // One finding per node is enough, regardless of how many sources cause it.
      }
    }

    return findings;
  },
};
