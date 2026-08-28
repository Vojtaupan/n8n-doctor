import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/execute-workflow-input-dropped.js';

describe('execute-workflow-input-dropped', () => {
  it('fires when the child declares its inputs as a JSON example', () => {
    const found = runRules(loadFixture('execute-workflow-input-dropped.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });

  it('stays silent when the JSON example declares every mapped key', () => {
    expect(runRules(loadFixture('execute-workflow-input-dropped.good'), [rule])).toHaveLength(0);
  });

  // The trigger's other declaring mode - an explicit field list - whitelists
  // inputs identically, and is the mode n8n selects by default. The rule handled
  // only the JSON example, so it could not see this at all.
  it('fires when the child declares its inputs as a field list', () => {
    const found = runRules(loadFixture('execute-workflow-input-dropped.fields-bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('carrier');
  });

  // `inputSource` is omitted when the trigger is left on its default, so an
  // absent key with a field list present is the same declaring mode.
  it('fires when the field list is present and inputSource is left at its default', () => {
    const found = runRules(loadFixture('execute-workflow-input-dropped.fields-default-bad'), [
      rule,
    ]);
    expect(found).toHaveLength(1);
  });

  it('stays silent when the field list declares every mapped key', () => {
    expect(
      runRules(loadFixture('execute-workflow-input-dropped.fields-good'), [rule]),
    ).toHaveLength(0);
  });

  // Under `autoMapInputData` the parent passes the incoming item through and the
  // `value` map is inert UI state, so comparing it against the child's
  // declaration would accuse a mapping that is never applied.
  it('stays silent when the parent auto-maps its input data', () => {
    expect(runRules(loadFixture('execute-workflow-input-dropped.automap'), [rule])).toHaveLength(0);
  });
});
