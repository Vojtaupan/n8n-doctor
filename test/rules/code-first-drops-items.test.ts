import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/code-first-drops-items.js';

describe('code-first-drops-items', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('code-first-drops-items.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('code-first-drops-items.good'), [rule])).toHaveLength(0);
  });
});
