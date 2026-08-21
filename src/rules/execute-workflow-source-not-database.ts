import type { Rule, Finding } from '../types.js';

/**
 * Detects an Execute Workflow node whose `parameters.source` is set to something
 * other than `'database'`.
 *
 * The Execute Workflow node can load its sub-workflow from four sources:
 * `database` (by id, from the n8n instance), `localFile` (a path on disk),
 * `parameter` (inline workflow JSON), or `url` (fetched at execution time).
 * Only `database` references a single, version-controlled workflow that every
 * environment shares. `localFile` depends on a filesystem layout that differs
 * between dev and prod; `parameter` freezes a copy that drifts from the real
 * workflow the moment either changes; `url` adds a network dependency and an
 * external trust boundary to every run.
 *
 * `source` is optional and defaults to `database`, so a missing key is fine —
 * the rule only fires when the key is present and explicitly not `database`.
 */
export const rule: Rule = {
  id: 'execute-workflow-source-not-database',
  severity: 'warning',
  title: 'Execute Workflow: load the sub-workflow from the database, not a file, URL, or inline copy',
  docs: 'docs/rules/execute-workflow-source-not-database.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'executeWorkflow') continue;

      const source = node.parameters.source;
      if (typeof source !== 'string') continue;
      if (source === 'database') continue;

      findings.push({
        nodeName: node.name,
        message:
          `The Execute Workflow node loads its sub-workflow from source "${source}", not "database". ` +
          `A file path, URL, or inline copy drifts from the real workflow and differs across environments, ` +
          `so the parent can silently run stale or missing logic.`,
        suggestion:
          `Set parameters.source to "database" and reference the sub-workflow by id, so the parent always ` +
          `runs the current, version-controlled workflow from this n8n instance.`,
      });
    }

    return findings;
  },
};
