import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/merge-combine-all-empty-input.js';

describe('merge-combine-all-empty-input', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('merge-combine-all-empty-input.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('merge-combine-all-empty-input.good'), [rule])).toHaveLength(0);
  });
});
