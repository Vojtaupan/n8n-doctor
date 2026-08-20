import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowFileContents } from '../src/load.js';
import { buildGraph } from '../src/graph.js';
import { buildContext } from '../src/context.js';
import type { Context } from '../src/types.js';

const fixturesDir = join(fileURLToPath(import.meta.url), '..', 'fixtures');

/**
 * Load one or more named fixture files (without `.json` extension) and return
 * a single Context containing all their workflows.
 *
 * Usage: `loadFixture('set-include-other-fields.bad')`
 *        `loadFixture('wf-a', 'wf-b')` — both land in one context (cross-workflow tests)
 */
export function loadFixture(...names: string[]): Context {
  const graphs = names.flatMap((name) => {
    const path = join(fixturesDir, `${name}.json`);
    const contents = readFileSync(path, 'utf8');
    return parseWorkflowFileContents(contents, path).map((raw) => buildGraph(raw));
  });
  return buildContext(graphs);
}
