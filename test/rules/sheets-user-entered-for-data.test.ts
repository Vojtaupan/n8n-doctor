import { describe, expect, it } from 'vitest';
import { runRules } from '../../src/engine.js';
import { loadFixture } from '../helpers.js';
import { rule } from '../../src/rules/sheets-user-entered-for-data.js';

describe('sheets-user-entered-for-data', () => {
  it('fires on the n8n Google Sheets node option (valueInputMode)', () => {
    const found = runRules(loadFixture('sheets-user-entered-for-data.bad'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toBeTruthy();
  });

  // The n8n Google Sheets node names this option `cellFormat` at v4, not
  // `valueInputOption` - the rule matched only the Google REST API's own field
  // name and so was blind to every write the n8n node itself makes.
  it('fires on the n8n Google Sheets node option (cellFormat)', () => {
    const found = runRules(loadFixture('sheets-user-entered-for-data.cell-format'), [rule]);
    expect(found).toHaveLength(1);
  });

  // Calling the Sheets API from an HTTP Request node puts `valueInputOption` in
  // the URL query string, where it is part of a string value and never a
  // parameter key - so a key-only scan cannot see it.
  it('fires when the Sheets API URL carries valueInputOption=USER_ENTERED', () => {
    const found = runRules(loadFixture('sheets-user-entered-for-data.http-url'), [rule]);
    expect(found).toHaveLength(1);
  });

  it('fires when a JSON body string assigns valueInputOption USER_ENTERED', () => {
    const found = runRules(loadFixture('sheets-user-entered-for-data.http-json-body'), [rule]);
    expect(found).toHaveLength(1);
  });

  // Expression bodies are JavaScript, so the option is single-quoted far more
  // often than double-quoted. Allowing only double quotes made the matcher miss
  // the dominant form.
  it('fires when the assignment is single-quoted inside an expression', () => {
    const found = runRules(loadFixture('sheets-user-entered-for-data.single-quoted'), [rule]);
    expect(found).toHaveLength(1);
  });

  // `valueInputMode` is the v1 Sheets node's option name and is inert on the v2
  // node (typeVersion >= 4.1), where only `cellFormat` is read. The write is
  // still USER_ENTERED - the platform default at that version - so the finding
  // stands, but the suggestion has to name the option that actually fixes it.
  it('names cellFormat when the inert v1 option is set on a v2 node', () => {
    const found = runRules(loadFixture('sheets-user-entered-for-data.inert-key'), [rule]);
    expect(found).toHaveLength(1);
    expect(found[0]!.suggestion).toContain('options.cellFormat');
    // The whole point: say that the key already there does nothing.
    expect(found[0]!.suggestion).toContain('ignored');
  });

  // RAW in every form is the correct choice and must stay silent; so must a node
  // that merely mentions USER_ENTERED without assigning it to the option, which
  // is why the match requires the key and the value together.
  it('stays silent on the good fixture', () => {
    expect(runRules(loadFixture('sheets-user-entered-for-data.good'), [rule])).toHaveLength(0);
  });
});
