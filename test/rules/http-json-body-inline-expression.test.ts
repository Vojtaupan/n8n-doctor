import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/http-json-body-inline-expression.js';

describe('http-json-body-inline-expression', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('http-json-body-inline-expression.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('http-json-body-inline-expression.good'), [rule])).toHaveLength(0);
  });
});
