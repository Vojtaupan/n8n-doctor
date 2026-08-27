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
 * The marker `runRules` writes into the finding it synthesizes when a rule's
 * `check` throws. Exported so consumers can identify a crash without hardcoding
 * the string: the producer and the test for it stay in this one module.
 */
export const RULE_CRASH_PREFIX = 'Rule check threw an unexpected error: ';

/**
 * True when `finding` is a synthesized rule crash rather than a real defect the
 * rule detected.
 *
 * Severity alone cannot answer this. A crash is always downgraded to `info`, so
 * for a rule already declared `info` a crash and a genuine finding carry the
 * same severity - comparing the finding's severity to the rule's declared one
 * silently counts the crash as a finding.
 *
 * The answer is the structural `crashed` flag `runRules` stamps on every finding
 * it emits, true or false. The message marker is only a fallback, for a `Finding`
 * built before that field existed. It has to be a fallback and not the test: a
 * rule whose genuine message happened to open with the marker would otherwise
 * have all of its findings reclassified as crashes, with nothing to catch it -
 * the same silent-miscount class the info-severity blindness was, relocated into
 * a string comparison.
 */
export function isRuleCrash(finding: Finding): boolean {
  if (finding.crashed !== undefined) return finding.crashed;
  return finding.severity === 'info' && finding.message.startsWith(RULE_CRASH_PREFIX);
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
          message: `${RULE_CRASH_PREFIX}${(err as Error).message ?? String(err)}`,
          suggestion: 'Check the rule implementation or the workflow JSON for unexpected structure.',
          crashed: true,
        });
        continue;
      }

      for (const partial of partialFindings) {
        findings.push({
          // The engine's fields go after the spread on purpose: `crashed` is the
          // discriminant the calibration counts rest on, so a rule cannot set it.
          ...partial,
          ruleId: rule.id,
          severity: rule.severity,
          workflowName: graph.name,
          crashed: false,
        });
      }
    }
  }

  return orderBySeverity(findings);
}
