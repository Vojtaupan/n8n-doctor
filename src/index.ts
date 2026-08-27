// Public library surface. The CLI (`src/cli.ts`) is the binary; this module is the
// programmatic entry (`package.json` "main") for embedding the linter in other tools.

export { loadWorkflowFile, parseWorkflow, parseWorkflowFileContents } from './load.js';
export type { RawWorkflow } from './load.js';

export { buildGraph } from './graph.js';
export type { WorkflowGraph } from './graph.js';

export { buildContext } from './context.js';

export { runRules, orderBySeverity, isRuleCrash, RULE_CRASH_PREFIX } from './engine.js';
export { rules } from './rules/index.js';

export { renderText } from './report/text.js';
export type { TextOptions } from './report/text.js';
export { renderJson } from './report/json.js';
export type { JsonReport, JsonSummary } from './report/json.js';

export type { Finding, Rule, Severity, N8nNode, Edge } from './types.js';
export type { Context } from './context.js';
