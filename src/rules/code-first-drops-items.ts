import type { Rule, Finding } from '../types.js';

/**
 * Short node types whose entire purpose is to turn one input item into many —
 * a high-confidence signal that the stream reaching a downstream node carries
 * multiple items.
 */
const SPLITTER_TYPES = new Set([
  'splitOut', // Split Out — one field-array becomes one item per element
  'itemLists', // Item Lists — "Split Out Items" operation
  'splitInBatches', // Loop Over Items / Split In Batches
]);

/** Matches a call to `$input.first(` allowing incidental whitespace. */
const INPUT_FIRST = /\$input\s*\.\s*first\s*\(/;

/**
 * Detects a Code node that runs once over all items but reads only
 * `$input.first()`, silently discarding every item after the first.
 *
 * A Code node in "Run Once for All Items" mode (the default — `parameters.mode`
 * absent, or explicitly `runOnceForAllItems`) receives the whole incoming batch.
 * `$input.first()` returns only item 0; unless the code iterates `$input.all()`,
 * items 1..n never make it to the return value and vanish with no error. In
 * "Run Once for Each Item" mode `$input.first()` is the single current item and
 * the pattern is correct, so per-item nodes are exempt.
 *
 * The defect only bites when more than one item can actually arrive, so the rule
 * requires a transitive ancestor that is a dedicated splitter (Split Out, Item
 * Lists, or Loop Over Items) — a node whose whole job is to emit many items.
 * Restricting to splitters keeps the signal high-confidence: a Code node fed only
 * by single-item sources drops nothing, and firing on it would be a false positive.
 */
export const rule: Rule = {
  id: 'code-first-drops-items',
  severity: 'warning',
  title: 'Code node reads $input.first() in run-once-for-all-items mode, dropping the rest',
  docs: 'docs/rules/code-first-drops-items.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'code') continue;

      // Only run-once-for-all-items mode sees the whole batch. In per-item mode
      // `$input.first()` is the current item and dropping nothing.
      const mode = node.parameters.mode;
      if (mode !== undefined && mode !== 'runOnceForAllItems') continue;

      const jsCode = node.parameters.jsCode;
      if (typeof jsCode !== 'string' || !INPUT_FIRST.test(jsCode)) continue;

      // Require a genuinely multi-item source upstream — a dedicated splitter —
      // so single-item flows (where first() drops nothing) don't fire.
      const splitter = graph
        .ancestorsOf(node.name)
        .find((ancestor) => SPLITTER_TYPES.has(graph.shortType(ancestor)));
      if (!splitter) continue;

      findings.push({
        nodeName: node.name,
        message:
          `Code node "${node.name}" runs once over all items but reads only $input.first(), so it ` +
          `processes item 0 and silently discards the rest. Its input traces back to "${splitter.name}" ` +
          `(${graph.shortType(splitter)}), which emits one item per element — every item after the ` +
          `first is dropped with no error and the run still reports success.`,
        suggestion:
          `Iterate the whole batch with $input.all() (returning one output item per input), or set the ` +
          `node's mode to "Run Once for Each Item" so it runs per item. Use $input.first() only when you ` +
          `deliberately want a single item.`,
      });
    }

    return findings;
  },
};
