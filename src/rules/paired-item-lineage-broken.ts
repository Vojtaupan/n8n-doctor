import type { Rule, Finding } from '../types.js';

/**
 * Matches an n8n cross-node reference of the shape `$('Node Name').item`,
 * capturing the referenced node name. Both quote styles are accepted. The
 * trailing `\b` after `item` keeps `.itemMatching(...)` — a distinct, valid API
 * that *does* survive mapping — from matching.
 */
const ITEM_REF = /\$\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*item\b/g;

/** Matches a `.map(` call in a Code node's body, tolerating incidental whitespace. */
const MAP_CALL = /\.\s*map\s*\(/;

/**
 * Detects an expression that reads `$('X').item` where `X` is a Code node whose
 * `jsCode` calls `.map(`.
 *
 * `$('X').item` relies on n8n's paired-item lineage: every item carries a back
 * reference to the input item it descends from, and `.item` resolves the entry of
 * `X` that produced the *current* item. `.map()` inside a Code node builds a brand
 * new array of items with no `pairedItem` metadata, so the lineage is severed.
 * When a downstream expression then asks for `$('X').item`, n8n cannot map the
 * current item back to one of `X`'s outputs and throws
 * `ExpressionError: Can't get data for expression` at runtime — even though the
 * expression validates, saves, and activates without complaint.
 *
 * The rule fires only when the referenced node actually exists, is a Code node, and
 * its `jsCode` contains a `.map(` call. `$('X').item` against any other node — or a
 * Code node that preserves lineage — is legitimate and stays silent, which is what
 * keeps this precise rather than warning on every `.item` reference.
 */
export const rule: Rule = {
  id: 'paired-item-lineage-broken',
  severity: 'warning',
  title:
    "Expression reads $('Code').item where the Code node maps items, breaking paired-item lineage",
  docs: 'docs/rules/paired-item-lineage-broken.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      const referenced = new Set<string>();
      collectItemRefs(node.parameters, referenced);
      if (referenced.size === 0) continue;

      // Keep only references whose target is a Code node that maps its items —
      // the exact shape that severs paired-item lineage.
      const broken: string[] = [];
      for (const name of referenced) {
        const target = graph.nodeByName(name);
        if (!target || graph.shortType(target) !== 'code') continue;
        const jsCode = target.parameters.jsCode;
        if (typeof jsCode === 'string' && MAP_CALL.test(jsCode)) broken.push(name);
      }
      if (broken.length === 0) continue;

      const list = broken.map((n) => `"${n}"`).join(', ');
      const plural = broken.length > 1;
      findings.push({
        nodeName: node.name,
        message:
          `"${node.name}" reads ${list} via $('…').item, but ${
            plural
              ? 'those are Code nodes whose jsCode calls'
              : 'that is a Code node whose jsCode calls'
          } .map(). A .map() rebuilds items without paired-item metadata, so the lineage that ` +
          `.item depends on is severed — n8n cannot trace the current item back to the mapped ` +
          `node and throws "ExpressionError: Can't get data for expression" at runtime, even ` +
          `though the expression validates and saves cleanly.`,
        suggestion:
          `Replace .item with .first() — e.g. $(${JSON.stringify(broken[0])}).first() — to read the ` +
          `mapped node's first output item explicitly, or restructure so the value you need travels ` +
          `on the current item's own paired lineage rather than through a mapped node.`,
      });
    }

    return findings;
  },
};

/**
 * Recursively collect every node name referenced through `$('X').item` in a
 * parameter value.
 */
function collectItemRefs(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(ITEM_REF)) {
      out.add(match[2]!);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectItemRefs(item, out);
    return;
  }
  if (isPlainObject(value)) {
    for (const nested of Object.values(value)) collectItemRefs(nested, out);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
