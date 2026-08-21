# parallel-ifs-should-be-switch

**Severity:** info  
**Applies to:** any node whose single `main` output fans out to four or more IF
nodes on the same output index.

## What this rule checks

A node fires when, on one of its `main` outputs, four or more distinct downstream
nodes of type `if` are connected in parallel:

1. group the node's outbound `main` edges by output index; then
2. for each output index, count the **distinct** IF-node targets; and
3. if any single output index reaches four or more, report the fan-out node.

Grouping by output index is deliberate: two IFs on output 0 and two on output 1
are two separate two-way splits, not a four-way dispatch, and stay silent. The
threshold is four — three parallel IFs are often genuine independent guards, but
four or more re-testing the same item is multi-way routing assembled the wrong way.

## Why it matters

When one output feeds several IFs in parallel, each IF re-evaluates the same item to
decide whether *its* route applies. That is multi-way dispatch built by hand out of
two-way branches, and it has three problems the editor never surfaces:

- **Every IF runs on every item.** They are not mutually exclusive the way a Switch's
  outputs are, so more than one route can match at once.
- **The settling order is undefined.** Nothing guarantees which branch finishes first.
- **Last-node response returns the wrong branch.** The trap bites hardest on a webhook
  whose Respond node — or `responseMode: 'lastNode'` — returns "the last node's"
  output. The caller receives whichever IF branch happened to finish last rather than
  the branch that actually matched, so the same request can return different bodies run
  to run.

A Switch is the node built for this: one rule per route, each on its own output,
routing each item down exactly one branch. That makes the matched route deterministic
and the last-node response correct.

The rule ships at `info`: parallel IFs run correctly for their own logic, and the
shape only turns into a defect under last-node response semantics. It is a design
smell worth surfacing, not an unconditional error.

## Wrong

```json
{
  "nodes": [
    { "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "parameters": {} },
    { "name": "If Create", "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {} },
    { "name": "If Update", "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {} },
    { "name": "If Delete", "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {} },
    { "name": "If Archive", "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {} }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [
          { "node": "If Create", "type": "main", "index": 0 },
          { "node": "If Update", "type": "main", "index": 0 },
          { "node": "If Delete", "type": "main", "index": 0 },
          { "node": "If Archive", "type": "main", "index": 0 }
        ]
      ]
    }
  }
}
```

`Webhook` fans out from output 0 to four IFs. Each IF tests the incoming request to
pick its own route; under a last-node response the caller gets whichever branch
finished last.

## Right

```json
{
  "nodes": [
    { "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "parameters": {} },
    { "name": "Route", "type": "n8n-nodes-base.switch", "typeVersion": 3, "parameters": {} },
    { "name": "Create", "type": "n8n-nodes-base.noOp", "typeVersion": 1, "parameters": {} },
    { "name": "Update", "type": "n8n-nodes-base.noOp", "typeVersion": 1, "parameters": {} },
    { "name": "Delete", "type": "n8n-nodes-base.noOp", "typeVersion": 1, "parameters": {} },
    { "name": "Archive", "type": "n8n-nodes-base.noOp", "typeVersion": 1, "parameters": {} }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Route", "type": "main", "index": 0 }]] },
    "Route": {
      "main": [
        [{ "node": "Create", "type": "main", "index": 0 }],
        [{ "node": "Update", "type": "main", "index": 0 }],
        [{ "node": "Delete", "type": "main", "index": 0 }],
        [{ "node": "Archive", "type": "main", "index": 0 }]
      ]
    }
  }
}
```

One Switch with a rule per route sends each item down exactly one branch. The matched
route is deterministic, and the last node the run touches is the one that actually
handled the request.

## How it was found

Distilled from the field notes behind this linter: a webhook that dispatched by
CRUD action through four parallel IFs returned the wrong response body
intermittently, because `responseMode: 'lastNode'` echoed whichever IF settled last
rather than the one that matched. Collapsing the four IFs into a single Switch made
the response deterministic. The rule looks for the same shape — four or more IFs on
one output — and stays at `info`, since the branches are individually valid and the
defect only surfaces under last-node response semantics.
