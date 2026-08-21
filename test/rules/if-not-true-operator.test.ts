import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/if-not-true-operator.js';

describe('if-not-true-operator', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('if-not-true-operator.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('if-not-true-operator.good'), [rule])).toHaveLength(0);
  });
});
