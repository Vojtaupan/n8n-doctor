import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/sheets-user-entered-for-data.js';

describe('sheets-user-entered-for-data', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('sheets-user-entered-for-data.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('sheets-user-entered-for-data.good'), [rule])).toHaveLength(0);
  });
});
