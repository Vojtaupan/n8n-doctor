import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/http-parallel-unbatched.js';

describe('http-parallel-unbatched', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('http-parallel-unbatched.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('http-parallel-unbatched.good'), [rule])).toHaveLength(0);
  });
});
