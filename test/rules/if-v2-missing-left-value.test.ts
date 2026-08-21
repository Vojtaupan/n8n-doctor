import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/if-v2-missing-left-value.js';

describe('if-v2-missing-left-value', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('if-v2-missing-left-value.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('if-v2-missing-left-value.good'), [rule])).toHaveLength(0);
  });
});
