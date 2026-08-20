import type { Finding, Rule } from './types.js';
import type { Context } from './context.js';
import { rules as defaultRules } from './rules/index.js';

const SEVERITY_ORDER: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Sort findings by severity: error first, then warning, then info.
 * Findings with the same severity retain their original relative order (stable sort).
 */
export function orderBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  );
}

/**
 * Run all rules in the registry over every workflow in the context and return
 * a flat, severity-ordered list of findings.
 *
 * - `rules` defaults to the full registry from `src/rules/index.ts`.
 * - If a rule's `check` throws for a specific workflow, that failure is caught
 *   and reported as an `info` finding (ruleId = the rule's id) so that one
 *   malformed workflow never crashes the whole run.
 */
export function runRules(ctx: Context, rules: Rule[] = defaultRules): Finding[] {
  const findings: Finding[] = [];

  for (const rule of rules) {
    for (const graph of ctx.workflows) {
      let partialFindings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[];
      try {
        partialFindings = rule.check(graph, ctx);
      } catch (err) {
        findings.push({
          ruleId: rule.id,
          severity: 'info',
          workflowName: graph.name,
          message: `Rule check threw an unexpected error: ${(err as Error).message ?? String(err)}`,
          suggestion: 'Check the rule implementation or the workflow JSON for unexpected structure.',
        });
        continue;
      }

      for (const partial of partialFindings) {
        findings.push({
          ...partial,
          ruleId: rule.id,
          severity: rule.severity,
          workflowName: graph.name,
        });
      }
    }
  }

  return orderBySeverity(findings);
}
