import { describe, expect, it } from 'vitest';
import { runRules, orderBySeverity, isRuleCrash, RULE_CRASH_PREFIX } from '../src/engine.js';
import type { Finding, Rule, Severity } from '../src/types.js';
import { loadFixture } from './helpers.js';

describe('engine', () => {
  it('reports the rule on the bad fixture', () => {
    const findings = runRules(loadFixture('set-include-other-fields.bad'));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('set-include-other-fields');
    expect(findings[0]!.nodeName).toBe('Edit Fields');
    expect(findings[0]!.suggestion).toMatch(/parameters root/i);
  });

  it('stays silent on the corrected fixture', () => {
    expect(runRules(loadFixture('set-include-other-fields.good'))).toHaveLength(0);
  });

  it('orders findings error before warning before info', () => {
    const findings = [
      { severity: 'info' },
      { severity: 'error' },
      { severity: 'warning' },
    ] as never[];
    // orderBySeverity is exported from engine.ts
    expect(orderBySeverity(findings).map((f) => f.severity)).toEqual(['error', 'warning', 'info']);
  });
});

describe('isRuleCrash', () => {
  /** A rule whose check always throws, so runRules has to synthesize a crash finding. */
  function throwingRule(id: string, severity: Severity): Rule {
    return {
      id,
      severity,
      title: 'always throws',
      docs: `docs/rules/${id}.md`,
      check() {
        throw new Error('kaboom');
      },
    };
  }

  it('recognises the crash finding from a rule declared error', () => {
    const findings = runRules(loadFixture('set-include-other-fields.good'), [
      throwingRule('boom-error', 'error'),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('info');
    expect(isRuleCrash(findings[0]!)).toBe(true);
  });

  it('recognises the crash finding from a rule declared info', () => {
    // The regression this test exists for: the engine synthesizes crashes as
    // `info`, so for a rule already declared `info` a severity comparison cannot
    // tell a crash from a genuine finding. Two registry rules are `info`.
    const findings = runRules(loadFixture('set-include-other-fields.good'), [
      throwingRule('boom-info', 'info'),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('info');
    expect(isRuleCrash(findings[0]!)).toBe(true);
  });

  it('does not mistake a genuine finding for a crash', () => {
    const findings = runRules(loadFixture('set-include-other-fields.bad'));

    expect(findings).toHaveLength(1);
    expect(isRuleCrash(findings[0]!)).toBe(false);
  });

  it('exposes the marker the engine writes, so consumers never hardcode it', () => {
    const findings = runRules(loadFixture('set-include-other-fields.good'), [
      throwingRule('boom', 'warning'),
    ]);

    expect(findings[0]!.message.startsWith(RULE_CRASH_PREFIX)).toBe(true);
  });

  it('marks a synthesized crash structurally, not only in its message', () => {
    const findings = runRules(loadFixture('set-include-other-fields.good'), [
      throwingRule('boom', 'error'),
    ]);

    expect(findings[0]!.crashed).toBe(true);
  });

  it('does not mistake a genuine info finding that quotes the marker for a crash', () => {
    // The point of making this structural. A rule author whose message happens to
    // open with the marker would have every one of their findings silently
    // reclassified as a crash - vanishing from the totals and inflating the crash
    // count - and no test anywhere would notice. The discriminant sits underneath
    // numbers this project publishes, so it cannot be a string match.
    const findings = runRules(loadFixture('set-include-other-fields.good'), [
      {
        id: 'quotes-the-marker',
        severity: 'info',
        title: 'quotes the marker in its own message',
        docs: 'docs/rules/quotes-the-marker.md',
        check: () => [
          {
            message: `${RULE_CRASH_PREFIX}is the string this rule warns you about`,
            suggestion: 'do not start a message with the crash marker',
          },
        ],
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('info');
    expect(findings[0]!.message.startsWith(RULE_CRASH_PREFIX)).toBe(true);
    expect(findings[0]!.crashed).toBe(false);
    expect(isRuleCrash(findings[0]!)).toBe(false);
  });

  it('cannot be forged by a rule that returns the crash flag itself', () => {
    // `Rule.check` cannot set `crashed` through the type system; this asserts the
    // runtime behaviour too, so the field stays engine-owned and a rule can never
    // hide its own findings from the calibration counts.
    const findings = runRules(loadFixture('set-include-other-fields.good'), [
      {
        id: 'liar',
        severity: 'warning',
        title: 'claims to have crashed',
        docs: 'docs/rules/liar.md',
        check: () => [{ message: 'a real finding', suggestion: 'fix it', crashed: true } as never],
      },
    ]);

    expect(findings[0]!.crashed).toBe(false);
    expect(isRuleCrash(findings[0]!)).toBe(false);
  });

  it('still classifies a crash finding built before the structural field existed', () => {
    // A `Finding` deserialized from an older JSON report has no `crashed` field.
    // The message marker stays as the fallback so those still classify correctly.
    const legacy: Finding = {
      ruleId: 'boom',
      severity: 'info',
      workflowName: 'wf',
      message: `${RULE_CRASH_PREFIX}kaboom`,
      suggestion: 'Check the rule implementation or the workflow JSON for unexpected structure.',
    };

    expect(legacy.crashed).toBeUndefined();
    expect(isRuleCrash(legacy)).toBe(true);
  });
});
