import { describe, expect, it } from 'vitest';
import { parseWorkflow, parseWorkflowFileContents } from '../src/load.js';

describe('parseWorkflow', () => {
  it('parses a UI-download export with no active flag', () => {
    const wf = parseWorkflow({ name: 'Bare', nodes: [], connections: {} }, 'ui.json');
    expect(wf.name).toBe('Bare');
    expect(wf.active).toBe(false);
    expect(wf.pinData).toEqual({});
  });

  it('parses an API-response export and keeps id and active', () => {
    const wf = parseWorkflow(
      { id: 'abc123', name: 'Live', active: true, nodes: [], connections: {} },
      'api.json',
    );
    expect(wf.id).toBe('abc123');
    expect(wf.active).toBe(true);
  });

  it('rejects JSON that is not a workflow', () => {
    expect(() => parseWorkflow({ foo: 'bar' }, 'junk.json')).toThrow(/not an n8n workflow/i);
  });

  it('parses a CLI export array into many workflows', () => {
    const wfs = parseWorkflowFileContents(
      JSON.stringify([
        { name: 'One', nodes: [], connections: {} },
        { name: 'Two', nodes: [], connections: {} },
      ]),
      'all.json',
    );
    expect(wfs.map((w) => w.name)).toEqual(['One', 'Two']);
  });

  it('names an unnamed workflow after its source file', () => {
    const wf = parseWorkflow({ nodes: [], connections: {} }, 'my-flow.json');
    expect(wf.name).toBe('my-flow.json');
  });
});
