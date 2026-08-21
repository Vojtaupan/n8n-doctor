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

  // Regression: the original rule fired whenever a literal '{' preceded the first
  // '{{', which matches the standard n8n template idiom. Measured against 479 real
  // workflows it produced 164 findings across 95 workflows - almost all of them
  // working code. A value starting with '=' is a TEMPLATE with holes, not a single
  // expression, so quoted interpolation is correct and must stay silent.
  it('stays silent when every interpolation sits inside a JSON string', () => {
    const found = runRules(
      loadFixture('http-json-body-inline-expression.quoted-safe'),
      [rule],
    );
    expect(found).toHaveLength(0);
  });

  // Regression: an unquoted hole whose expression already calls JSON.stringify()
  // is the CORRECT shape - stringify emits a quoted, escaped JSON value, so
  // splicing it bare is exactly what this rule's own suggestion recommends.
  // Flagging it meant the rule reported the fix as the defect: 85 of 88 corpus
  // findings were this pattern.
  it('stays silent when the spliced expression is already JSON.stringify()', () => {
    const found = runRules(
      loadFixture('http-json-body-inline-expression.stringified'),
      [rule],
    );
    expect(found).toHaveLength(0);
  });
});
