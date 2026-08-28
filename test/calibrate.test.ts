import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, aggregateStats, evaluateGate } from '../src/calibrate.js';
import { RULE_CRASH_PREFIX } from '../src/engine.js';
import type { Finding } from '../src/types.js';
import type { RuleStats } from '../src/calibrate.js';

/**
 * The real corpus at the time this gate was written: 479 workflows, 4,412 nodes.
 * The tests use it so the numbers below are the numbers the gate actually faces.
 */
const CORPUS_NODES = 4412;

/**
 * Findings from `http-parallel-unbatched` on that same run - the loudest rule in
 * the registry and the measurement the `info` bound is calibrated against.
 * 292 / 4,412 = 6.618% of scanned nodes.
 */
const MEASURED_INFO_FINDINGS = 292;

function stat(over: Partial<RuleStats> & Pick<RuleStats, 'ruleId' | 'severity'>): RuleStats {
  return {
    findings: 0,
    nodesInspected: CORPUS_NODES,
    workflowsAffected: 0,
    crashes: 0,
    ...over,
  };
}

function verdictFor(stats: RuleStats[], ruleId: string) {
  const result = evaluateGate(stats, DEFAULT_THRESHOLDS);
  const verdict = result.verdicts.find((v) => v.ruleId === ruleId);
  if (!verdict) throw new Error(`no verdict for ${ruleId}`);
  return { result, verdict };
}

describe('evaluateGate', () => {
  it('passes a warning rule firing on 4% of nodes', () => {
    const stats = [stat({ ruleId: 'w', severity: 'warning', findings: 40, nodesInspected: 1000 })];
    const { result, verdict } = verdictFor(stats, 'w');

    expect(verdict.rate).toBeCloseTo(0.04, 10);
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toBe('ok');
    expect(result.pass).toBe(true);
  });

  it('fails an error rule firing on 3.72% of nodes - the case that motivated the gate', () => {
    // 164 findings over the 4,412-node corpus. It cleared the old flat 5% bound
    // and still meant 164 wrong accusations on first install.
    const stats = [stat({ ruleId: 'e', severity: 'error', findings: 164 })];
    const { result, verdict } = verdictFor(stats, 'e');

    expect(verdict.rate).toBeCloseTo(0.0372, 4);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('rate-exceeded');
    expect(result.pass).toBe(false);
  });

  it('fails an error rule on rate even when its absolute count is tiny', () => {
    // 3 findings is well under maxAbsolute, but 3 of 100 nodes is 3% - six times
    // the error bound. Rate is checked on its own merits, not excused by volume.
    const stats = [stat({ ruleId: 'e', severity: 'error', findings: 3, nodesInspected: 100 })];
    const { result, verdict } = verdictFor(stats, 'e');

    expect(verdict.rate).toBeCloseTo(0.03, 10);
    expect(verdict.findings).toBe(3);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('rate-exceeded');
    expect(result.pass).toBe(false);
  });

  it('fails an error rule that is under the rate bound but over the absolute cap', () => {
    // 30 of 100,000 nodes is 0.03%, comfortably under maxRate - but 30 wrong
    // errors is still 30 wrong errors.
    const stats = [stat({ ruleId: 'e', severity: 'error', findings: 30, nodesInspected: 100_000 })];
    const { result, verdict } = verdictFor(stats, 'e');

    expect(verdict.rate).toBeLessThan(DEFAULT_THRESHOLDS.error.maxRate);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('absolute-exceeded');
    expect(result.pass).toBe(false);
  });

  it('reports a zero-firing rule as pass: false without failing the gate', () => {
    const stats = [
      stat({ ruleId: 'silent', severity: 'error', findings: 0 }),
      stat({ ruleId: 'fine', severity: 'error', findings: 5 }),
    ];
    const { result, verdict } = verdictFor(stats, 'silent');

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('zero-firing');
    expect(verdict.rate).toBe(0);
    // Task 3 adjudicates zero-firing rules separately; a rule that never fires
    // cannot be a false-positive problem, so it does not fail this gate.
    expect(result.pass).toBe(true);
  });

  it('passes the loudest advisory rule the corpus actually contains', () => {
    // The real measurement, pinned. `http-parallel-unbatched` produces 292 of the
    // corpus run's 474 findings - 62% of everything the tool says - at 6.618% of
    // scanned nodes, and it is legitimate. The info bound exists to catch a
    // runaway advisory, not this one, so this rate must keep passing. If a future
    // bound change flips this test red, the bound moved past real measured data.
    const stats = [stat({ ruleId: 'i', severity: 'info', findings: MEASURED_INFO_FINDINGS })];
    const { result, verdict } = verdictFor(stats, 'i');

    expect(verdict.rate).toBeCloseTo(0.06618, 5);
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toBe('ok');
    expect(result.pass).toBe(true);
  });

  it('fails an info rule firing on 40% of nodes', () => {
    // Advisory is not a licence to shout. A rule accusing two nodes in every five
    // is describing the platform, not the workflow, and burying the 22 errors a
    // user should actually act on. Severity changes the bound, it does not remove it.
    const stats = [stat({ ruleId: 'i', severity: 'info', findings: 1765 })];
    const { result, verdict } = verdictFor(stats, 'i');

    expect(verdict.rate).toBeCloseTo(0.4, 3);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('rate-exceeded');
    expect(result.pass).toBe(false);
  });

  it('fails an info rule firing on half the corpus', () => {
    const stats = [stat({ ruleId: 'i', severity: 'info', findings: 2206 })];
    const { result, verdict } = verdictFor(stats, 'i');

    expect(verdict.rate).toBeCloseTo(0.5, 10);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('rate-exceeded');
    expect(result.pass).toBe(false);
  });

  it('does not divide by zero when a rule inspected no nodes', () => {
    const stats = [
      stat({ ruleId: 'empty', severity: 'error', findings: 0, nodesInspected: 0 }),
      stat({ ruleId: 'odd', severity: 'error', findings: 4, nodesInspected: 0 }),
    ];
    const result = evaluateGate(stats, DEFAULT_THRESHOLDS);
    const empty = result.verdicts.find((v) => v.ruleId === 'empty');
    const odd = result.verdicts.find((v) => v.ruleId === 'odd');

    expect(empty?.rate).toBe(0);
    expect(Number.isNaN(empty?.rate)).toBe(false);
    expect(empty?.reason).toBe('zero-firing');
    // Findings with no denominator cannot produce a meaningful rate, so only the
    // absolute cap applies - 4 is under it.
    expect(odd?.rate).toBe(0);
    expect(odd?.pass).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('returns one verdict per rule, in the order given', () => {
    const stats = [
      stat({ ruleId: 'a', severity: 'error', findings: 1 }),
      stat({ ruleId: 'b', severity: 'warning', findings: 2 }),
      stat({ ruleId: 'c', severity: 'info', findings: 3 }),
    ];
    const result = evaluateGate(stats, DEFAULT_THRESHOLDS);

    expect(result.verdicts.map((v) => v.ruleId)).toEqual(['a', 'b', 'c']);
    expect(result.verdicts.map((v) => v.severity)).toEqual(['error', 'warning', 'info']);
    expect(result.pass).toBe(true);
  });

  it('treats a rate exactly on the bound as passing', () => {
    // 5 of 1,000 nodes is exactly 0.5%. The bound is "more than", not "at least".
    const stats = [stat({ ruleId: 'e', severity: 'error', findings: 5, nodesInspected: 1000 })];
    const { verdict } = verdictFor(stats, 'e');

    expect(verdict.rate).toBeCloseTo(DEFAULT_THRESHOLDS.error.maxRate, 10);
    expect(verdict.pass).toBe(true);
  });

  it('treats an absolute count exactly on the cap as passing', () => {
    const stats = [stat({ ruleId: 'e', severity: 'error', findings: 25, nodesInspected: 100_000 })];
    const { verdict } = verdictFor(stats, 'e');

    expect(verdict.findings).toBe(DEFAULT_THRESHOLDS.error.maxAbsolute);
    expect(verdict.pass).toBe(true);
  });

  it('accepts caller-supplied thresholds so the bounds can be tuned in one place', () => {
    const loose = {
      error: { maxRate: 0.5, maxAbsolute: Infinity },
      warning: { maxRate: 0.5, maxAbsolute: Infinity },
      info: { maxRate: Infinity, maxAbsolute: Infinity },
    };
    const stats = [stat({ ruleId: 'e', severity: 'error', findings: 164 })];

    expect(evaluateGate(stats, loose).pass).toBe(true);
    expect(evaluateGate(stats, DEFAULT_THRESHOLDS).pass).toBe(false);
  });

  it('passes an empty stats list', () => {
    const result = evaluateGate([], DEFAULT_THRESHOLDS);
    expect(result.pass).toBe(true);
    expect(result.verdicts).toEqual([]);
  });

  it('defaults to DEFAULT_THRESHOLDS when none are given', () => {
    const stats = [stat({ ruleId: 'e', severity: 'error', findings: 164 })];
    expect(evaluateGate(stats).pass).toBe(false);
  });
});

describe('DEFAULT_THRESHOLDS', () => {
  it('bounds error an order of magnitude tighter than warning', () => {
    expect(DEFAULT_THRESHOLDS.error.maxRate).toBe(0.005);
    expect(DEFAULT_THRESHOLDS.warning.maxRate).toBe(0.05);
    expect(DEFAULT_THRESHOLDS.error.maxRate * 10).toBeCloseTo(
      DEFAULT_THRESHOLDS.warning.maxRate,
      10,
    );
  });

  it('caps error findings in absolute terms too', () => {
    expect(DEFAULT_THRESHOLDS.error.maxAbsolute).toBe(25);
    expect(DEFAULT_THRESHOLDS.warning.maxAbsolute).toBe(Infinity);
  });

  it('bounds info by rate but not in absolute terms', () => {
    // An advisory count scales with corpus size and costs the user nothing but a
    // glance, so there is no absolute cap. A share of the corpus is different:
    // past some fraction an advisory stops being advice and becomes wallpaper.
    expect(DEFAULT_THRESHOLDS.info.maxRate).toBeLessThan(Infinity);
    expect(DEFAULT_THRESHOLDS.info.maxAbsolute).toBe(Infinity);
  });

  it('calibrates the info bound against the loudest measured advisory rule', () => {
    // The bound is derived, not picked: twice the loudest rate the corpus actually
    // produces. That keeps a 2x margin under the one legitimate noisy rule while
    // still failing a rule that accuses 40% of nodes. Both ends are asserted so a
    // future edit cannot quietly slide the bound past either.
    const measuredRate = MEASURED_INFO_FINDINGS / CORPUS_NODES;

    expect(DEFAULT_THRESHOLDS.info.maxRate).toBeGreaterThanOrEqual(measuredRate * 2);
    expect(DEFAULT_THRESHOLDS.info.maxRate).toBeLessThan(0.4);
  });

  it('keeps info looser than warning, as its severity implies', () => {
    expect(DEFAULT_THRESHOLDS.info.maxRate).toBeGreaterThan(DEFAULT_THRESHOLDS.warning.maxRate);
  });

  it('keeps the rate bound and the absolute cap in the same region on this corpus', () => {
    // 0.5% of 4,412 nodes is ~22 findings; the absolute cap is 25. The two bounds
    // are meant to bite at roughly the same place - if the corpus grows enough that
    // they diverge wildly, one of them needs revisiting.
    const rateBoundInFindings = DEFAULT_THRESHOLDS.error.maxRate * CORPUS_NODES;
    expect(rateBoundInFindings).toBeGreaterThan(DEFAULT_THRESHOLDS.error.maxAbsolute * 0.5);
    expect(rateBoundInFindings).toBeLessThan(DEFAULT_THRESHOLDS.error.maxAbsolute * 2);
  });
});

describe('aggregateStats', () => {
  const registry = [
    { id: 'an-error', severity: 'error' as const },
    { id: 'a-warning', severity: 'warning' as const },
    { id: 'an-info', severity: 'info' as const },
  ];

  function finding(over: Partial<Finding> & Pick<Finding, 'ruleId' | 'severity'>): Finding {
    return { workflowName: 'wf-1', message: 'a genuine finding', suggestion: 'fix it', ...over };
  }

  /** A crash finding exactly as `runRules` synthesizes one. */
  function crash(ruleId: string, workflowName = 'wf-1'): Finding {
    return {
      ruleId,
      severity: 'info',
      workflowName,
      message: `${RULE_CRASH_PREFIX}kaboom`,
      suggestion: 'Check the rule implementation or the workflow JSON for unexpected structure.',
    };
  }

  it('returns one entry per registered rule, in registry order, including silent ones', () => {
    const stats = aggregateStats([], registry, 4412);

    expect(stats.map((s) => s.ruleId)).toEqual(['an-error', 'a-warning', 'an-info']);
    expect(stats.map((s) => s.severity)).toEqual(['error', 'warning', 'info']);
    expect(stats.every((s) => s.findings === 0 && s.crashes === 0)).toBe(true);
  });

  it('gives every rule the same nodesInspected denominator', () => {
    const stats = aggregateStats(
      [finding({ ruleId: 'an-error', severity: 'error' })],
      registry,
      4412,
    );
    expect(stats.every((s) => s.nodesInspected === 4412)).toBe(true);
  });

  it('counts findings and the distinct workflows they came from', () => {
    const stats = aggregateStats(
      [
        finding({ ruleId: 'a-warning', severity: 'warning', workflowName: 'wf-1' }),
        finding({ ruleId: 'a-warning', severity: 'warning', workflowName: 'wf-1' }),
        finding({ ruleId: 'a-warning', severity: 'warning', workflowName: 'wf-2' }),
      ],
      registry,
      1000,
    );
    const warn = stats.find((s) => s.ruleId === 'a-warning');

    expect(warn?.findings).toBe(3);
    expect(warn?.workflowsAffected).toBe(2);
  });

  it('excludes a crash from the findings count and reports it separately', () => {
    const stats = aggregateStats(
      [finding({ ruleId: 'an-error', severity: 'error' }), crash('an-error')],
      registry,
      1000,
    );
    const err = stats.find((s) => s.ruleId === 'an-error');

    expect(err?.findings).toBe(1);
    expect(err?.crashes).toBe(1);
    expect(err?.workflowsAffected).toBe(1);
  });

  it('excludes a crash from an INFO-declared rule too', () => {
    // The regression. A crash is synthesized as `info`, so comparing the finding's
    // severity to the rule's declared severity cannot spot a crash in an `info`
    // rule - it silently inflates that rule's finding count. Two registry rules
    // are `info`, and one of them carries most of the suite's findings.
    const stats = aggregateStats(
      [finding({ ruleId: 'an-info', severity: 'info' }), crash('an-info', 'wf-9')],
      registry,
      1000,
    );
    const info = stats.find((s) => s.ruleId === 'an-info');

    expect(info?.findings).toBe(1);
    expect(info?.crashes).toBe(1);
    // The crashed workflow is not an "affected" workflow - nothing was found there.
    expect(info?.workflowsAffected).toBe(1);
  });

  it('counts a genuine info finding that quotes the crash marker as a finding', () => {
    // The aggregation-level version of the structural-crash point: the counts the
    // calibration doc publishes must not move because a rule author happened to
    // start a message with the marker. `crashed: false` is what the engine stamps
    // on every genuine finding, so the marker in the message is irrelevant here.
    const stats = aggregateStats(
      [
        finding({
          ruleId: 'an-info',
          severity: 'info',
          message: `${RULE_CRASH_PREFIX}is the string this rule warns you about`,
          crashed: false,
        }),
      ],
      registry,
      1000,
    );
    const info = stats.find((s) => s.ruleId === 'an-info');

    expect(info?.findings).toBe(1);
    expect(info?.crashes).toBe(0);
  });

  it('counts a structurally flagged crash even without the message marker', () => {
    const stats = aggregateStats(
      [finding({ ruleId: 'an-error', severity: 'info', message: 'no marker here', crashed: true })],
      registry,
      1000,
    );
    const err = stats.find((s) => s.ruleId === 'an-error');

    expect(err?.findings).toBe(0);
    expect(err?.crashes).toBe(1);
  });

  it('ignores findings from rules outside the given registry', () => {
    const stats = aggregateStats(
      [finding({ ruleId: 'not-registered', severity: 'error' })],
      registry,
      1000,
    );
    expect(stats.reduce((sum, s) => sum + s.findings, 0)).toBe(0);
  });

  it('produces stats that evaluateGate accepts directly', () => {
    const findings = Array.from({ length: 164 }, (_, i) =>
      finding({ ruleId: 'an-error', severity: 'error', workflowName: `wf-${i % 95}` }),
    );
    const result = evaluateGate(aggregateStats(findings, registry, 4412), DEFAULT_THRESHOLDS);
    const err = result.verdicts.find((v) => v.ruleId === 'an-error');

    expect(err?.rate).toBeCloseTo(0.0372, 4);
    expect(err?.reason).toBe('rate-exceeded');
    expect(result.pass).toBe(false);
  });
});
