#!/usr/bin/env node
/**
 * Pull every workflow from a live n8n instance into ./corpus (gitignored).
 *
 * This corpus is the FALSE-POSITIVE VALIDATION SET, not test data.
 * It is real client work: it must never be committed. See .gitignore.
 *
 * Credentials are read at runtime from an existing .mcp.json (or env) and are
 * never written to disk by this script.
 *
 *   node scripts/pull-corpus.mjs
 *   N8N_API_URL=... N8N_API_KEY=... node scripts/pull-corpus.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const MCP_JSON =
  process.env.N8N_MCP_JSON ??
  'C:\\Users\\Lenovo\\Documents\\Agentic Workflows\\.mcp.json';
const OUT_DIR = path.resolve(process.cwd(), 'corpus');

function findCreds(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.N8N_API_KEY === 'string' && node.N8N_API_KEY) {
    return { key: node.N8N_API_KEY, url: node.N8N_API_URL };
  }
  for (const value of Object.values(node)) {
    const found = findCreds(value);
    if (found) return found;
  }
  return null;
}

function resolveCreds() {
  if (process.env.N8N_API_KEY && process.env.N8N_API_URL) {
    return { key: process.env.N8N_API_KEY, url: process.env.N8N_API_URL };
  }
  if (!fs.existsSync(MCP_JSON)) {
    throw new Error(
      `No credentials: set N8N_API_URL + N8N_API_KEY, or point N8N_MCP_JSON at an .mcp.json (looked in ${MCP_JSON})`,
    );
  }
  const creds = findCreds(JSON.parse(fs.readFileSync(MCP_JSON, 'utf8')));
  if (!creds?.key || !creds?.url) {
    throw new Error(`No N8N_API_KEY / N8N_API_URL found inside ${MCP_JSON}`);
  }
  return creds;
}

async function api(url, key, endpoint) {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/v1${endpoint}`, {
    headers: { 'X-N8N-API-KEY': key, accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`${endpoint} -> HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function main() {
  const { key, url } = resolveCreds();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Page through the index. The API caps `limit` at 100.
  const index = [];
  let cursor = null;
  do {
    const qs = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await api(url, key, `/workflows${qs}`);
    index.push(...(page.data ?? []));
    cursor = page.nextCursor ?? null;
  } while (cursor);

  console.log(`index: ${index.length} workflows`);

  let written = 0;
  let failed = 0;
  for (const [i, meta] of index.entries()) {
    try {
      // The index omits nodes/connections; the detail endpoint carries the graph.
      const wf = await api(url, key, `/workflows/${meta.id}`);
      fs.writeFileSync(
        path.join(OUT_DIR, `${meta.id}.json`),
        JSON.stringify(wf, null, 2),
      );
      written++;
    } catch (err) {
      failed++;
      console.error(`  ! ${meta.id} (${meta.name}): ${err.message}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${index.length}`);
  }

  const nodeCounts = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const wf = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
      return Array.isArray(wf.nodes) ? wf.nodes.length : 0;
    });

  console.log(
    `\ncorpus: ${written} written, ${failed} failed -> ${OUT_DIR}\n` +
      `nodes: ${nodeCounts.reduce((a, b) => a + b, 0)} total, ` +
      `${Math.max(0, ...nodeCounts)} max, ` +
      `${nodeCounts.filter((n) => n === 0).length} workflows with no graph`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
