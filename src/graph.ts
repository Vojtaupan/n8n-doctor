import type { N8nNode, Edge } from './types.js';

/**
 * The normalised workflow model every rule receives. Rules never touch raw JSON;
 * they traverse this graph.
 *
 * NOTE: `buildGraph` and the traversal implementations land in Task 3. This file
 * currently declares only the interface, which `src/types.ts` re-exports so that
 * `Rule.check` can be typed against it from Task 1 onward.
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
