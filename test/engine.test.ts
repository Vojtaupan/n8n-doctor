import { describe, expect, it } from 'vitest';
import { runRules, orderBySeverity, isRuleCrash, RULE_CRASH_PREFIX } from '../src/engine.js';
import type { Rule, Severity } from '../src/types.js';
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
      { severity: 'info' }, { severity: 'error' }, { severity: 'warning' },
    ] as never[];
    // orderBySeverity is exported from engine.ts
    expect(orderBySeverity(findings).map((f) => f.severity))
      .toEqual(['error', 'warning', 'info']);
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
});
