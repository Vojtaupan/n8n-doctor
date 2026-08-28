import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph.js';
import type { RawWorkflow } from '../src/load.js';

function raw(partial: Partial<RawWorkflow>): RawWorkflow {
  return {
    name: 'T',
    active: false,
    nodes: [],
    connections: {},
    pinData: {},
    settings: {},
    source: 't.json',
    ...partial,
  };
}
const node = (name: string, type = 'n8n-nodes-base.noOp') => ({
  name,
  type,
  typeVersion: 1,
  parameters: {},
});

describe('buildGraph', () => {
  it('flattens connections into edges preserving output index', () => {
    const g = buildGraph(
      raw({
        nodes: [node('If', 'n8n-nodes-base.if'), node('A'), node('B')],
        connections: {
          If: {
            main: [
              [{ node: 'A', type: 'main', index: 0 }], // output 0 = true
              [{ node: 'B', type: 'main', index: 0 }], // output 1 = false
            ],
          },
        },
      }),
    );
    expect(g.edges).toHaveLength(2);
    expect(g.edges.find((e) => e.to === 'A')?.outputIndex).toBe(0);
    expect(g.edges.find((e) => e.to === 'B')?.outputIndex).toBe(1);
  });

  it('resolves parents and children by name', () => {
    const g = buildGraph(
      raw({
        nodes: [node('A'), node('B')],
        connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } },
      }),
    );
    expect(g.childrenOf('A').map((e) => e.to)).toEqual(['B']);
    expect(g.parentsOf('B').map((e) => e.from)).toEqual(['A']);
  });

  it('walks transitive ancestors without hanging on a cycle', () => {
    const g = buildGraph(
      raw({
        nodes: [node('A'), node('B'), node('C')],
        connections: {
          A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
          B: { main: [[{ node: 'C', type: 'main', index: 0 }]] },
          C: { main: [[{ node: 'A', type: 'main', index: 0 }]] },
        },
      }),
    );
    expect(
      g
        .ancestorsOf('C')
        .map((n) => n.name)
        .sort(),
    ).toEqual(['A', 'B', 'C']);
  });

  it('treats nodes with no inbound main edge as triggers', () => {
    const g = buildGraph(
      raw({
        nodes: [node('Webhook', 'n8n-nodes-base.webhook'), node('B')],
        connections: { Webhook: { main: [[{ node: 'B', type: 'main', index: 0 }]] } },
      }),
    );
    expect(g.triggers().map((n) => n.name)).toEqual(['Webhook']);
  });

  it('ignores connections referring to nodes that do not exist', () => {
    const g = buildGraph(
      raw({
        nodes: [node('A')],
        connections: { A: { main: [[{ node: 'Ghost', type: 'main', index: 0 }]] } },
      }),
    );
    expect(g.edges).toHaveLength(0);
  });

  it('shortens a fully qualified node type', () => {
    const g = buildGraph(raw({ nodes: [node('A', 'n8n-nodes-base.httpRequest')] }));
    expect(g.shortType(g.nodes[0]!)).toBe('httpRequest');
  });
});
