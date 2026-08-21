import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/execute-workflow-input-dropped.js';

describe('execute-workflow-input-dropped', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('execute-workflow-input-dropped.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('execute-workflow-input-dropped.good'), [rule])).toHaveLength(0);
  });
});
