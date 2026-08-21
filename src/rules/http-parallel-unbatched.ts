import type { Rule, Finding, N8nNode, WorkflowGraph } from '../types.js';

/**
 * Short node types whose whole purpose is to turn one input into a stream of many
 * items — a demonstrably multi-item upstream source.
 */
const SPLITTER_TYPES = new Set([
  'splitInBatches', // Loop Over Items / Split In Batches
  'itemLists', // Item Lists — "Split Out Items" operation
]);

/** Matches a `.map(` call in a Code node's body, tolerating incidental whitespace. */
const MAP_CALL = /\.\s*map\s*\(/;

/** A non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when `node` demonstrably emits more than one item downstream: a dedicated
 * splitter node, a Code node that maps its input into a fresh array, or any node
 * explicitly set to run per item (`mode: 'each'`).
 */
function isSplitter(node: N8nNode, graph: WorkflowGraph): boolean {
  const shortType = graph.shortType(node);
  if (SPLITTER_TYPES.has(shortType)) return true;
  // A Code node that maps its input builds one output item per input item — an
  // array of many. `.map(` is the high-confidence signal of that shape.
  if (shortType === 'code') {
    const jsCode = node.parameters.jsCode;
    if (typeof jsCode === 'string' && MAP_CALL.test(jsCode)) return true;
  }
  // A node explicitly configured to run once per item.
  if (node.parameters.mode === 'each') return true;
  return false;
}

/**
 * Detects an HTTP Request node (`typeVersion >= 4`) with no batching configured
 * that is fed by a demonstrably multi-item upstream source.
 *
 * From v4 onward the HTTP Request node fires **all** incoming items in parallel by
 * default; earlier versions processed them one at a time. When the upstream stream
 * carries many items — because a splitter, a mapping Code node, or a per-item node
 * sits among its ancestors — an unbatched v4 node hammers the endpoint with every
 * request at once, which readily trips rate limits (HTTP 429) or gets the caller
 * temporarily banned. Nothing in the editor warns about it; the node is valid and
 * runs fine against the single pinned item you tested with.
 *
 * The naive "HTTP v4 without batching" shape hit 1,094 nodes on the calibration
 * corpus, because most of those nodes only ever see one item and parallelism is
 * harmless there. Requiring a demonstrably multi-item ancestor is the narrowing
 * that turns the signal from noise into a real finding — and it stays at `info`
 * because a burst of parallel requests is a risk, not a guaranteed defect.
 *
 * Signature: node of type `httpRequest`, `typeVersion >= 4`, with no
 * `parameters.options.batching`, and a transitive ancestor for which
 * {@link isSplitter} holds.
 */
export const rule: Rule = {
  id: 'http-parallel-unbatched',
  severity: 'info',
  title: 'HTTP Request v4 fires every item in parallel with no batching downstream of a splitter',
  docs: 'docs/rules/http-parallel-unbatched.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'httpRequest') continue;
      if (node.typeVersion < 4) continue;

      // Batching configured at all? Then the author has addressed the burst; the
      // presence of the key is enough to stay silent.
      const options = node.parameters.options;
      if (isPlainObject(options) && options.batching !== undefined) continue;

      // Only fire where more than one item can actually arrive — a splitter, a
      // mapping Code node, or a per-item node among the transitive ancestors.
      const splitter = graph.ancestorsOf(node.name).find((ancestor) => isSplitter(ancestor, graph));
      if (!splitter) continue;

      findings.push({
        nodeName: node.name,
        message:
          `HTTP Request "${node.name}" is typeVersion ${node.typeVersion} with no batching configured, ` +
          `and its input traces back to "${splitter.name}" (${graph.shortType(splitter)}), which emits ` +
          `many items. From v4 the node fires every incoming item in parallel by default, so it sends ` +
          `the whole batch of requests at once — which readily trips the endpoint's rate limit (HTTP ` +
          `429) or gets you temporarily banned. It runs fine against a single test item, so nothing ` +
          `flags it until production.`,
        suggestion:
          `Enable batching under the node's Options → Batching: set a Batch Size and a Batch Interval ` +
          `(ms) so requests go out in throttled groups instead of all at once. Match the batch size and ` +
          `interval to the endpoint's documented rate limit.`,
      });
    }

    return findings;
  },
};
