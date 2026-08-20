import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { N8nNode } from './types.js';

/**
 * A workflow as it comes off disk, before normalisation into a {@link WorkflowGraph}.
 * The three export shapes (UI download, public-API response, CLI `export:workflow`
 * array) all collapse into this one shape so nothing downstream has to care which
 * tool produced the file.
 */
export interface RawWorkflow {
  id?: string;
  name: string;
  active: boolean;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  pinData: Record<string, unknown>;
  settings: Record<string, unknown>;
  /** Where this workflow came from — a file path, a glob entry, or `-` for stdin. */
  source: string;
}

/** A non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An n8n workflow is recognised structurally: an array `nodes` and an object
 * `connections`. That pair is present in every export shape and absent from
 * unrelated JSON, so it is enough to tell a workflow from junk without a schema.
 */
function looksLikeWorkflow(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Array.isArray(value.nodes) && isPlainObject(value.connections);
}

/**
 * Normalise a single parsed JSON value into a {@link RawWorkflow}.
 *
 * Defaults that make the three shapes interchangeable: a missing `active` is
 * `false` (a UI download has no such flag), missing `pinData`/`settings` are `{}`,
 * and a missing or empty `name` falls back to the source filename so unnamed
 * exports are still identifiable in a report.
 *
 * @throws {TypeError} naming `source`, if the value is not workflow-shaped — so a
 *   single bad file inside a glob of hundreds can be pinpointed.
 */
export function parseWorkflow(json: unknown, source: string): RawWorkflow {
  if (!looksLikeWorkflow(json)) {
    throw new TypeError(
      `${source}: not an n8n workflow (expected an object with an array "nodes" and an object "connections")`,
    );
  }

  const name =
    typeof json.name === 'string' && json.name.trim() !== '' ? json.name : basename(source);

  const workflow: RawWorkflow = {
    name,
    active: json.active === true,
    nodes: json.nodes as N8nNode[],
    connections: json.connections as Record<string, unknown>,
    pinData: isPlainObject(json.pinData) ? json.pinData : {},
    settings: isPlainObject(json.settings) ? json.settings : {},
    source,
  };
  if (typeof json.id === 'string') {
    workflow.id = json.id;
  }
  return workflow;
}

/**
 * Parse the raw text of an export file into one or more workflows. A top-level
 * JSON array is a CLI `export:workflow --all` dump and yields many workflows;
 * anything else is a single workflow.
 *
 * @throws {TypeError} naming `source`, if the text is not valid JSON or not a workflow.
 */
export function parseWorkflowFileContents(contents: string, source: string): RawWorkflow[] {
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch (err) {
    throw new TypeError(`${source}: not valid JSON (${(err as Error).message})`);
  }

  if (Array.isArray(json)) {
    return json.map((entry, i) => parseWorkflow(entry, `${source}[${i}]`));
  }
  return [parseWorkflow(json, source)];
}

/**
 * Read and parse a workflow file from disk. Returns an array because a CLI export
 * file may contain many workflows; a single-workflow file yields a one-element array.
 */
export function loadWorkflowFile(path: string): RawWorkflow[] {
  return parseWorkflowFileContents(readFileSync(path, 'utf8'), path);
}
