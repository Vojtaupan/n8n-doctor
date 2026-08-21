import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/switch-options-placement.js';

describe('switch-options-placement', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('switch-options-placement.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('switch-options-placement.good'), [rule])).toHaveLength(0);
  });
});
