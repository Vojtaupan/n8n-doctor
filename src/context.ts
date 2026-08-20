import type { WorkflowGraph } from './graph.js';

/**
 * Every loaded workflow, indexed for the cross-workflow rules (Tasks 22-23).
 *
 * NOTE: `buildContext` lands in Task 4. This file currently declares only the
 * interface, which `src/types.ts` re-exports so that `Rule.check` can be typed
 * against it from Task 1 onward.
 */
export interface Context {
  workflows: WorkflowGraph[];
  byId: Map<string, WorkflowGraph>;
  byName: Map<string, WorkflowGraph>;
}

/**
 * Build a {@link Context} from an array of already-normalised workflow graphs.
 *
 * `byId` indexes only graphs that have an `id` defined; `byName` indexes every
 * graph by its `name`. Both maps are used by cross-workflow rules.
 */
export function buildContext(graphs: WorkflowGraph[]): Context {
  const byId = new Map<string, WorkflowGraph>();
  const byName = new Map<string, WorkflowGraph>();

  for (const graph of graphs) {
    if (graph.id !== undefined) byId.set(graph.id, graph);
    byName.set(graph.name, graph);
  }

  return { workflows: graphs, byId, byName };
}
