import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, evaluateGate } from '../src/calibrate.js';
import type { RuleStats } from '../src/calibrate.js';

/**
 * The real corpus at the time this gate was written: 479 workflows, 4,412 nodes.
 * The tests use it so the numbers below are the numbers the gate actually faces.
 */
const CORPUS_NODES = 4412;

function stat(over: Partial<RuleStats> & Pick<RuleStats, 'ruleId' | 'severity'>): RuleStats {
  return {
    findings: 0,
    nodesInspected: CORPUS_NODES,
    workflowsAffected: 0,
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

  it('exempts info severity from the rate bound entirely', () => {
    const stats = [stat({ ruleId: 'i', severity: 'info', findings: 2206 })];
    const { result, verdict } = verdictFor(stats, 'i');

    expect(verdict.rate).toBeCloseTo(0.5, 10);
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toBe('ok');
    expect(result.pass).toBe(true);
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

  it('exempts info from both bounds', () => {
    expect(DEFAULT_THRESHOLDS.info.maxRate).toBe(Infinity);
    expect(DEFAULT_THRESHOLDS.info.maxAbsolute).toBe(Infinity);
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
