import type { Rule, Finding } from '../types.js';

/**
 * How many IF nodes on one output turns hand-rolled dispatch into a Switch. Four is
 * the threshold from the field: three parallel IFs is often a genuine set of
 * independent guards, but four or more re-testing the same item is multi-way routing
 * assembled the wrong way.
 */
const MIN_PARALLEL_IFS = 4;

/**
 * Detects a single node whose main output fans out to four or more IF nodes on the
 * same output index.
 *
 * When one output feeds many IFs in parallel, each IF re-evaluates the same item to
 * decide whether *its* route applies — a multi-way dispatch built by hand out of
 * two-way branches. Every IF runs on every item, so more than one route can match at
 * once, and nothing guarantees the order in which the branches settle. The trap bites
 * hardest on a webhook whose Respond node (or `responseMode: 'lastNode'`) returns
 * "the last node's" output: the caller receives whichever IF branch happened to finish
 * last rather than the branch that actually matched, so the same request can return
 * different bodies run to run.
 *
 * A Switch is the node built for this — one rule per route, each on its own output,
 * routing each item down exactly one branch — which makes the matched route
 * deterministic and the last-node response correct. Fires at `info`: parallel IFs run
 * correctly for their own logic, so this is a design smell that becomes a defect under
 * last-node response semantics, not an unconditional error.
 */
export const rule: Rule = {
  id: 'parallel-ifs-should-be-switch',
  severity: 'info',
  title: 'One output fans out to four or more parallel IF nodes; use a Switch',
  docs: 'docs/rules/parallel-ifs-should-be-switch.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      // Count the distinct IF targets on each of this node's main outputs. Grouping by
      // output index keeps the "same output" requirement: two IFs on output 0 and two
      // on output 1 is two separate two-way splits, not a four-way dispatch.
      const ifTargetsByOutput = new Map<number, Set<string>>();
      for (const edge of graph.childrenOf(node.name)) {
        if (edge.type !== 'main') continue;
        const target = graph.nodeByName(edge.to);
        if (!target || graph.shortType(target) !== 'if') continue;
        const targets = ifTargetsByOutput.get(edge.outputIndex);
        if (targets) targets.add(edge.to);
        else ifTargetsByOutput.set(edge.outputIndex, new Set([edge.to]));
      }

      for (const [outputIndex, targets] of ifTargetsByOutput) {
        if (targets.size < MIN_PARALLEL_IFS) continue;
        const names = [...targets].map((n) => `"${n}"`).join(', ');
        findings.push({
          nodeName: node.name,
          message:
            `"${node.name}" fans out from output ${outputIndex} to ${targets.size} parallel IF nodes ` +
            `(${names}). Each IF re-tests the same item to decide whether its route applies, so this ` +
            `is multi-way dispatch built by hand from two-way branches: every IF runs on every item, ` +
            `more than one route can match at once, and the order the branches settle in is undefined. ` +
            `When the workflow answers a webhook with responseMode "lastNode", the caller receives ` +
            `whichever branch finished last rather than the branch that matched — so the same request ` +
            `can return the wrong branch's output.`,
          suggestion:
            `Replace the ${targets.size} IF nodes with a single Switch node — one rule per route, each ` +
            `on its own output. A Switch sends each item down exactly one branch, which makes the ` +
            `matched route deterministic and the last-node response correct.`,
        });
        break; // One finding per node, however many outputs cross the threshold.
      }
    }

    return findings;
  },
};
