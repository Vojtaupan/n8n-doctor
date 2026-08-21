import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/mutually-exclusive-fan-in.js';

describe('mutually-exclusive-fan-in', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('mutually-exclusive-fan-in.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('mutually-exclusive-fan-in.good'), [rule])).toHaveLength(0);
  });
});
