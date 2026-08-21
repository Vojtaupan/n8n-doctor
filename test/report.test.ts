import { describe, expect, it } from 'vitest';
import { renderText } from '../src/report/text.js';
import { renderJson } from '../src/report/json.js';
import type { Finding } from '../src/types.js';

const errorFinding: Finding = {
  ruleId: 'r',
  severity: 'error',
  workflowName: 'My Flow',
  nodeName: 'HTTP Request',
  message: 'boom',
  suggestion: 'fix it',
};

describe('renderText', () => {
  it('groups findings by workflow and names the node', () => {
    const out = renderText([errorFinding], { color: false });
    expect(out).toContain('My Flow');
    expect(out).toContain('HTTP Request');
    expect(out).toContain('fix it');
    expect(out).toContain('r');
  });

  it('reports a clean run explicitly rather than printing nothing', () => {
    expect(renderText([], { color: false })).toMatch(/no findings/i);
  });

  it('closes with a per-severity summary line, which --quiet suppresses', () => {
    expect(renderText([errorFinding], { color: false })).toMatch(/summary/i);
    expect(renderText([errorFinding], { color: false, quiet: true })).not.toMatch(/summary/i);
  });
});

describe('renderJson', () => {
  it('emits a parseable report with findings and per-severity counts', () => {
    const parsed = JSON.parse(renderJson([errorFinding]));
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].ruleId).toBe('r');
    expect(parsed.summary).toEqual({ error: 1, warning: 0, info: 0, total: 1 });
  });
});
