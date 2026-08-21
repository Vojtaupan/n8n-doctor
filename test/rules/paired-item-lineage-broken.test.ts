import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/paired-item-lineage-broken.js';

describe('paired-item-lineage-broken', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('paired-item-lineage-broken.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('paired-item-lineage-broken.good'), [rule])).toHaveLength(0);
  });
});
