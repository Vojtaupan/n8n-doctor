# merge-combine-all-empty-input

**Severity:** warning  
**Applies to:** Merge nodes (`n8n-nodes-base.merge`) at `typeVersion >= 3` with
`parameters.mode === 'combine'` and `parameters.combineBy === 'combineAll'`, where
at least one input traces back to a branch output of an IF or Switch node.

## What this rule checks

A Merge node set to **Combine → Combine All** where one of its inputs traces back,
transitively, to a branch output of an **IF** or **Switch** node. The rule walks the
Merge's ancestors; if any of them is an IF or Switch (every edge leaving one is a
mutually exclusive branch output), it fires.

## Why it matters

**Combine All** takes the **cross-product** of its inputs: every item on input 1 is
paired with every item on input 2, and so on. A cross-product with an empty side is
empty — pair anything with zero items and you get zero items back.

An IF or Switch routes each item down exactly one branch. So the branch that feeds
one of the Merge's inputs is **empty whenever the condition sends all items the other
way**. When that happens, Combine All produces zero items and **every node downstream
of the Merge is skipped**.

The trap is that **nothing errors**. There is no failed node, no red run — the Merge
simply emits an empty list and the workflow reports success. You discover it only when
the thing that was supposed to happen after the Merge silently didn't: no row written,
no message sent, no record updated, on exactly the runs where the branch went the
other way.

## Wrong

```json
{
  "nodes": [
    { "name": "Route", "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {} },
    {
      "name": "Merge",
      "type": "n8n-nodes-base.merge",
      "typeVersion": 3,
      "parameters": { "mode": "combine", "combineBy": "combineAll" }
    }
  ],
  "connections": {
    "Route": {
      "main": [
        [{ "node": "Merge", "type": "main", "index": 0 }],
        [{ "node": "Merge", "type": "main", "index": 1 }]
      ]
    }
  }
}
```

`Route`'s true branch feeds Merge input 0 and its false branch feeds input 1. On any
run every item takes one branch, so the other input is empty — and Combine All
cross-products it to nothing.

## Right

```json
{
  "nodes": [
    { "name": "Route", "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {} },
    {
      "name": "Merge",
      "type": "n8n-nodes-base.merge",
      "typeVersion": 3,
      "parameters": { "mode": "append" }
    }
  ],
  "connections": {
    "Route": {
      "main": [
        [{ "node": "Merge", "type": "main", "index": 0 }],
        [{ "node": "Merge", "type": "main", "index": 1 }]
      ]
    }
  }
}
```

Use **`mode: "append"`** so the inputs are concatenated rather than cross-multiplied:
an empty branch contributes nothing and the items from the other branch flow through
unharmed. Only keep Combine All when every input is guaranteed to carry at least one
item on every run.

## How it was found

Distilled from the field notes behind this linter.

This rule fired **zero** times across the 479-workflow production corpus - but not
because the trap is rare. The corpus belongs to the same person who documented this
defect and had already fixed every instance of it, and the corpus carries that fix's
fingerprint: of its 36 Merge nodes, **23 are `mode: "append"`, 4 are `chooseBranch`,
9 are left at the default, and not one is in `combine` mode at all.** The mode this
rule inspects is entirely unused there, so the corpus cannot speak for or against it.
Its only coverage is therefore the synthetic fixture pair, which is written to
exercise the exact shape: both branches of a single IF feeding a Combine-All Merge.
See the zero-firing audit in `docs/calibration.md`.
