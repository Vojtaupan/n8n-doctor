import type { WorkflowGraph } from './graph.js';
import type { Context } from './context.js';

export type Severity = 'error' | 'warning' | 'info';

/** A node as it appears in an exported n8n workflow. */
export interface N8nNode {
  id?: string;
  name: string;
  /** Fully qualified, e.g. 'n8n-nodes-base.httpRequest'. */
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  disabled?: boolean;
  onError?: 'stopWorkflow' | 'continueRegularOutput' | 'continueErrorOutput';
  retryOnFail?: boolean;
  maxTries?: number;
  position?: [number, number];
}

/** A normalised connection. n8n stores these as a nested map; we flatten them. */
export interface Edge {
  from: string;
  to: string;
  /** Connection channel: 'main', 'ai_tool', 'ai_languageModel', ... */
  type: string;
  outputIndex: number;
  inputIndex: number;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  workflowName: string;
  nodeName?: string;
  message: string;
  suggestion: string;
  /**
   * True when the engine synthesized this entry because a rule's `check` threw,
   * false when a rule genuinely reported it. Set by `runRules`, never by a rule -
   * `Rule.check` cannot return it.
   *
   * Optional, and absent on any `Finding` built before this field existed (a
   * deserialized older report, say); `isRuleCrash` falls back to the message
   * marker in that case. Present on everything the current engine emits, which
   * is what stops a genuine message that happens to open with the marker from
   * being silently miscounted as a crash.
   */
  crashed?: boolean;
}

export interface Rule {
  id: string;
  severity: Severity;
  title: string;
  /** Relative path to docs/rules/<id>.md */
  docs: string;
  // `crashed` is omitted deliberately: it is the engine's discriminant, so a rule
  // must not be able to flag its own findings as crashes and vanish from the counts.
  check(
    graph: WorkflowGraph,
    ctx: Context,
  ): Omit<Finding, 'ruleId' | 'severity' | 'workflowName' | 'crashed'>[];
}

// Re-exported so rules and the engine can import every shared type from one module.
// The interface bodies live in their own modules (graph.ts, context.ts); their
// implementations (buildGraph, buildContext) land in Tasks 3 and 4.
export type { WorkflowGraph, Context };
