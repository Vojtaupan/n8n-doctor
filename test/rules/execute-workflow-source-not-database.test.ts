import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/execute-workflow-source-not-database.js';

describe('execute-workflow-source-not-database', () => {
  it('fires on the bad fixture', () => {
    const found = runRules(loadFixture('execute-workflow-source-not-database.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('execute-workflow-source-not-database.good'), [rule])).toHaveLength(0);
  });
});
