# paired-item-lineage-broken

**Severity:** warning  
**Applies to:** any node whose parameters reference `$('X').item`, where `X` is a
Code node whose `jsCode` calls `.map(`.

## What this rule checks

For every node, the rule scans all parameter strings for a cross-node reference of
the shape `$('X').item` (both quote styles). For each referenced name `X` it looks up
the node and fires only when **all** of the following hold:

1. `X` is a real node in the workflow, and
2. `X` is a **Code** node, and
3. `X`'s `jsCode` contains a `.map(` call.

`$('X').item` against any other kind of node, or against a Code node that preserves
lineage, is legitimate and stays silent. `.itemMatching(...)` — a different, valid API
that does not depend on the current item's automatic lineage — is deliberately not
matched.

## Why it matters

`$('X').item` relies on n8n's **paired-item lineage**: every item flowing through a
workflow carries a `pairedItem` back reference to the input item it descends from, and
`.item` uses that reference to resolve the entry of `X` that produced the **current**
item.

A `.map()` inside a Code node builds a brand-new array of item objects. Those objects
have no `pairedItem` metadata, so the chain that links a downstream item back to a
specific output of `X` is severed. When a later expression asks for `$('X').item`, n8n
cannot map the current item onto one of `X`'s outputs and throws:

```
ExpressionError: Can't get data for expression
```

This happens **at runtime only**. The expression validates, saves, and activates
without complaint — the failure appears the first time the node executes against real
data, which is exactly when it is most expensive.

## Wrong

```json
{
  "nodes": [
    {
      "name": "Expand Rows",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "parameters": {
        "jsCode": "const out = $input.all().map((item) => ({ json: { id: item.json.id } }));\nreturn out;"
      }
    },
    {
      "name": "Build Payload",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "parameters": {
        "assignments": {
          "assignments": [
            { "name": "id", "type": "string", "value": "={{ $('Expand Rows').item.json.id }}" }
          ]
        }
      }
    }
  ],
  "connections": {
    "Expand Rows": { "main": [[{ "node": "Build Payload", "type": "main", "index": 0 }]] }
  }
}
```

`Expand Rows` rebuilds its items with `.map()`, dropping their paired-item metadata.
`Build Payload` then reads `$('Expand Rows').item`, which throws at runtime because the
lineage no longer exists.

## Right

```json
{
  "nodes": [
    {
      "name": "Expand Rows",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "parameters": {
        "jsCode": "const out = $input.all().map((item) => ({ json: { id: item.json.id } }));\nreturn out;"
      }
    },
    {
      "name": "Build Payload",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "parameters": {
        "assignments": {
          "assignments": [
            { "name": "id", "type": "string", "value": "={{ $('Expand Rows').first().json.id }}" }
          ]
        }
      }
    }
  ],
  "connections": {
    "Expand Rows": { "main": [[{ "node": "Build Payload", "type": "main", "index": 0 }]] }
  }
}
```

Read `$('Expand Rows').first()` instead of `.item`. `.first()` returns the mapped
node's first output item explicitly and does not need paired-item lineage. If you truly
need per-item correspondence, restructure so the value travels on the current item's own
paired lineage rather than being fetched back through a mapped node.

## How it was found

Distilled from the field notes behind this linter: an expression that read
`$('Format Rows').item.json.…` worked while the referenced Code node returned items
one-for-one, then began throwing `ExpressionError: Can't get data for expression` the
moment that node was changed to `.map()` a single incoming record into many. Nothing in
the editor flagged it — the expression was still "valid," it just lost the lineage it
silently depended on.
