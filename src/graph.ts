import type { N8nNode, Edge } from './types.js';
import type { RawWorkflow } from './load.js';

/**
 * The normalised workflow model every rule receives. Rules never touch raw JSON;
 * they traverse this graph.
 */
export interface WorkflowGraph {
  id?: string;
  name: string;
  active: boolean;
  nodes: N8nNode[];
  edges: Edge[];
  pinData: Record<string, unknown>;
  settings: Record<string, unknown>;
  source: string;

  nodeByName(name: string): N8nNode | undefined;
  /** Inbound edges. */
  parentsOf(name: string): Edge[];
  /** Outbound edges. */
  childrenOf(name: string): Edge[];
  /** Transitive ancestors, cycle-safe, nearest first. */
  ancestorsOf(name: string): N8nNode[];
  /** Nodes with no inbound main edges. */
  triggers(): N8nNode[];
  /** 'n8n-nodes-base.httpRequest' -> 'httpRequest' */
  shortType(node: N8nNode): string;
}

/** A non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Append `edge` to the list at `key`, creating the list on first use. */
function index(map: Map<string, Edge[]>, key: string, edge: Edge): void {
  const existing = map.get(key);
  if (existing) existing.push(edge);
  else map.set(key, [edge]);
}

/**
 * Flatten n8n's nested connection map into a flat {@link Edge} list.
 *
 * n8n stores connections as
 * `{ [sourceName]: { [channel]: Array<Array<{ node, type, index }>> } }`, where the
 * outer array index is the source's **output index** (an IF node's true branch is 0,
 * false is 1) and each inner array holds that output's fan-out targets. Several rules
 * depend on knowing which branch an edge left from, so the output index is preserved
 * verbatim. Edges whose target is not a real node are dropped: a dangling reference is
 * not this tool's problem and would crash traversal.
 */
function flattenConnections(connections: Record<string, unknown>, known: Set<string>): Edge[] {
  const edges: Edge[] = [];
  for (const [from, channels] of Object.entries(connections)) {
    if (!known.has(from) || !isPlainObject(channels)) continue;
    for (const [type, outputs] of Object.entries(channels)) {
      if (!Array.isArray(outputs)) continue;
      outputs.forEach((targets, outputIndex) => {
        if (!Array.isArray(targets)) return;
        for (const target of targets) {
          if (!isPlainObject(target) || typeof target.node !== 'string') continue;
          if (!known.has(target.node)) continue;
          const inputIndex = typeof target.index === 'number' ? target.index : 0;
          edges.push({ from, to: target.node, type, outputIndex, inputIndex });
        }
      });
    }
  }
  return edges;
}

/**
 * Normalise a {@link RawWorkflow} into the {@link WorkflowGraph} every rule traverses.
 *
 * The edge list is built once and indexed into two maps — by `to` for parents, by `from`
 * for children — so `parentsOf`/`childrenOf` are O(1); rules call them in inner loops over
 * thousands of nodes.
 */
export function buildGraph(raw: RawWorkflow): WorkflowGraph {
  const nodes = raw.nodes;
  const known = new Set(nodes.map((n) => n.name));

  const byName = new Map<string, N8nNode>();
  for (const node of nodes) byName.set(node.name, node);

  const edges = flattenConnections(raw.connections, known);

  const parents = new Map<string, Edge[]>();
  const children = new Map<string, Edge[]>();
  for (const edge of edges) {
    index(parents, edge.to, edge);
    index(children, edge.from, edge);
  }

  const graph: WorkflowGraph = {
    name: raw.name,
    active: raw.active,
    nodes,
    edges,
    pinData: raw.pinData,
    settings: raw.settings,
    source: raw.source,

    nodeByName(name) {
      return byName.get(name);
    },
    parentsOf(name) {
      return parents.get(name) ?? [];
    },
    childrenOf(name) {
      return children.get(name) ?? [];
    },
    ancestorsOf(name) {
      // Breadth-first walk up the parent edges, nearest first. The visited set makes
      // it cycle-safe: a workflow with a loop terminates instead of hanging.
      const result: N8nNode[] = [];
      const visited = new Set<string>();
      const queue = (parents.get(name) ?? []).map((e) => e.from);
      while (queue.length > 0) {
        const current = queue.shift() as string;
        if (visited.has(current)) continue;
        visited.add(current);
        const node = byName.get(current);
        if (node) result.push(node);
        for (const edge of parents.get(current) ?? []) {
          if (!visited.has(edge.from)) queue.push(edge.from);
        }
      }
      return result;
    },
    triggers() {
      const hasMainParent = new Set<string>();
      for (const edge of edges) {
        if (edge.type === 'main') hasMainParent.add(edge.to);
      }
      return nodes.filter((n) => !hasMainParent.has(n.name));
    },
    shortType(node) {
      const dot = node.type.lastIndexOf('.');
      return dot === -1 ? node.type : node.type.slice(dot + 1);
    },
  };

  if (raw.id !== undefined) graph.id = raw.id;
  return graph;
}
