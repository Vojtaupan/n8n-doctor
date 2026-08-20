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
