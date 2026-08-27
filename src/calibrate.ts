import type { Severity } from './types.js';

/**
 * Per-rule measurements taken over the validation corpus.
 *
 * `nodesInspected` is the total number of nodes scanned in the run, not a
 * per-rule figure: the `Rule` interface does not report how many nodes a given
 * rule looked at, and inferring it would be guesswork. So the denominator is the
 * same for every rule and a rate answers "how much of the corpus did this rule
 * accuse", which is the question the gate cares about.
 */
export interface RuleStats {
  ruleId: string;
  severity: Severity;
  /** How many findings this rule produced across the whole corpus. */
  findings: number;
  /** Total nodes scanned in the run - the shared rate denominator. */
  nodesInspected: number;
  /** How many distinct workflows this rule fired on. Reported, not gated. */
  workflowsAffected: number;
}

/** The bounds one severity has to stay inside. */
export interface Threshold {
  /** Max share of scanned nodes this severity may fire on. Exceeding it fails. */
  maxRate: number;
  /** Max raw finding count, regardless of rate. Exceeding it fails. */
  maxAbsolute: number;
}

export type Thresholds = Record<Severity, Threshold>;

/** Why a rule got the verdict it got. */
export type VerdictReason = 'ok' | 'zero-firing' | 'rate-exceeded' | 'absolute-exceeded';

export interface RuleVerdict {
  ruleId: string;
  severity: Severity;
  findings: number;
  /** `findings / nodesInspected`, or 0 when nothing was inspected. */
  rate: number;
  pass: boolean;
  reason: VerdictReason;
}

export interface GateResult {
  /** False if any rule exceeded its severity's bounds. Zero-firing does not count. */
  pass: boolean;
  verdicts: RuleVerdict[];
}

/**
 * Severity-weighted calibration bounds.
 *
 * An `error` is an accusation the user is expected to act on - stop the build,
 * open the workflow, change something. Getting one wrong costs trust in a way a
 * `warning` does not, so `error` earns a bound an order of magnitude tighter:
 * 0.5% of scanned nodes against 5%. It also carries an absolute cap, because a
 * low percentage of a large corpus is still a large pile of noise - 3.72% of a
 * 4,412-node corpus cleared the old flat 5% bound and still meant 164 wrong
 * errors on first install, which is how a linter gets uninstalled. On that
 * corpus the two error bounds bite in the same region: 0.5% is ~22 findings
 * against a cap of 25.
 *
 * `info` is advisory - it asks the user to look, not to act - so it is exempt
 * from both bounds. `warning` keeps the documented 5% rate bound and no cap.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  error: { maxRate: 0.005, maxAbsolute: 25 },
  warning: { maxRate: 0.05, maxAbsolute: Infinity },
  info: { maxRate: Infinity, maxAbsolute: Infinity },
};

/**
 * Judge every rule's corpus behaviour against its severity's bounds.
 *
 * A rule fails when it fires on more of the corpus than its severity allows, or
 * more times in absolute terms than its severity allows. Rate is checked first:
 * a tiny absolute count does not excuse a rule that accuses a large share of
 * whatever it inspected.
 *
 * A rule with zero findings is flagged `pass: false` with reason `zero-firing`,
 * but does NOT fail the overall gate. A rule that never fires cannot be a
 * false-positive problem; whether it is dead weight or just waiting for the
 * right workflow is a separate judgement, made elsewhere.
 *
 * @param stats one entry per rule, from a corpus run
 * @param thresholds bounds per severity; defaults to {@link DEFAULT_THRESHOLDS}
 */
export function evaluateGate(
  stats: RuleStats[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): GateResult {
  const verdicts = stats.map((s) => judge(s, thresholds[s.severity]));

  // Zero-firing rules are reported but are not gate failures.
  const pass = verdicts.every((v) => v.pass || v.reason === 'zero-firing');

  return { pass, verdicts };
}

function judge(stats: RuleStats, threshold: Threshold): RuleVerdict {
  // No denominator means no meaningful rate. Report 0 rather than NaN or
  // Infinity so the number is safe to compare, format and sort.
  const rate = stats.nodesInspected > 0 ? stats.findings / stats.nodesInspected : 0;

  const base = {
    ruleId: stats.ruleId,
    severity: stats.severity,
    findings: stats.findings,
    rate,
  };

  if (stats.findings === 0) {
    return { ...base, pass: false, reason: 'zero-firing' };
  }
  if (rate > threshold.maxRate) {
    return { ...base, pass: false, reason: 'rate-exceeded' };
  }
  if (stats.findings > threshold.maxAbsolute) {
    return { ...base, pass: false, reason: 'absolute-exceeded' };
  }
  return { ...base, pass: true, reason: 'ok' };
}
