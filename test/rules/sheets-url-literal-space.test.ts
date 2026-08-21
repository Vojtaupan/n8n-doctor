import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/sheets-url-literal-space.js';

describe('sheets-url-literal-space', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('sheets-url-literal-space.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('sheets-url-literal-space.good'), [rule])).toHaveLength(0);
  });
});
