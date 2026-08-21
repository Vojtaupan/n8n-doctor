import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/parallel-ifs-should-be-switch.js';

describe('parallel-ifs-should-be-switch', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('parallel-ifs-should-be-switch.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('parallel-ifs-should-be-switch.good'), [rule])).toHaveLength(0);
  });
});
