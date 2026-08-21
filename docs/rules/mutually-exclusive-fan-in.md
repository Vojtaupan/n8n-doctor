# mutually-exclusive-fan-in

**Severity:** warning  
**Applies to:** any non-Merge node whose inbound edges include two or more edges from
the **same** IF or Switch node at **different output indices**.

## What this rule checks

A node — anything other than a Merge — that is fed by two or more mutually exclusive
branch outputs of a single IF or Switch node. The rule groups the node's parent edges
by their source; if any one IF/Switch source reaches this node from two or more of its
output indices, it fires.

## Why it matters

An IF or Switch routes each incoming item down **exactly one** of its outputs. Its
branches are mutually exclusive: an item that leaves the true output never also leaves
the false output.

When two different outputs of the same IF/Switch land on the same downstream node, that
node does **not** wait for both branches and run once. It runs **once per branch that
carries items** — up to once per parent completion. So on the runs where more than one
branch carries items, everything downstream of that node executes **twice** (or on
partial data): the row is written twice, the email is sent twice, the counter is
incremented twice.

This is invisible in the editor. The wiring looks like "both branches continue here,"
which reads as a join — but n8n has no implicit join. The double execution only shows up
in production, on exactly the inputs that split across branches.

The naive shape — "a node with more than one parent" — hit 282 nodes on the
479-workflow corpus, almost all of them legitimate fan-in. The real defect is this
narrowed shape: **two edges from the same IF/Switch, at different output indices,
into one non-Merge node.**

## Wrong

```json
{
  "nodes": [
    { "name": "Route", "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {} },
    { "name": "Handle", "type": "n8n-nodes-base.noOp", "typeVersion": 1, "parameters": {} }
  ],
  "connections": {
    "Route": {
      "main": [
        [{ "node": "Handle", "type": "main", "index": 0 }],
        [{ "node": "Handle", "type": "main", "index": 0 }]
      ]
    }
  }
}
```

Both the true output (0) and the false output (1) of `Route` feed `Handle` directly.
`Handle` runs once for the items on the true branch and again for the items on the false
branch.

## Right

```json
{
  "nodes": [
    { "name": "Route", "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {} },
    { "name": "Merge", "type": "n8n-nodes-base.merge", "typeVersion": 3, "parameters": { "mode": "append" } },
    { "name": "Handle", "type": "n8n-nodes-base.noOp", "typeVersion": 1, "parameters": {} }
  ],
  "connections": {
    "Route": {
      "main": [
        [{ "node": "Merge", "type": "main", "index": 0 }],
        [{ "node": "Merge", "type": "main", "index": 1 }]
      ]
    },
    "Merge": {
      "main": [[{ "node": "Handle", "type": "main", "index": 0 }]]
    }
  }
}
```

Route the two branches through a **Merge in `append` mode** first, then feed `Handle`
from the Merge's single output. The Merge concatenates the branches into one input, so
`Handle` runs exactly once on the combined result. Merge nodes are the intended join
point and are exempt from this rule.

## How it was found

Distilled from the field notes behind this linter. The naive "multi-parent fan-in"
signature fired on 282 nodes of the 479-workflow production corpus — overwhelmingly
false positives, because ordinary fan-in from independent sources is fine. Narrowing to
"two outputs of the *same* IF/Switch into a non-Merge node" is what isolates the actual
double-execution bug from benign fan-in.
