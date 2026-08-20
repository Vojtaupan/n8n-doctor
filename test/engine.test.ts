import { describe, expect, it } from 'vitest';
import { runRules, orderBySeverity } from '../src/engine.js';
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
