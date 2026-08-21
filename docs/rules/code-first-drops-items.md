# code-first-drops-items

**Severity:** warning  
**Applies to:** a Code node in "Run Once for All Items" mode whose `jsCode` calls
`$input.first()`, when a dedicated splitter (Split Out, Item Lists, or Loop Over
Items) appears among its transitive ancestors.

## What this rule checks

A Code node that:

1. is in **Run Once for All Items** mode — `parameters.mode` is absent (the default)
   or explicitly `runOnceForAllItems`; and
2. calls `$input.first()` in its `jsCode`; and
3. has a transitive ancestor that is a **splitter** — `splitOut`, `itemLists`, or
   `splitInBatches` — a node whose whole job is to emit many items.

Nodes in **Run Once for Each Item** mode are exempt: there `$input.first()` is the
single current item and nothing is dropped.

## Why it matters

In "Run Once for All Items" mode a Code node receives the **entire** incoming batch
in `$input`. `$input.first()` returns only item 0. Unless the code iterates
`$input.all()`, every item after the first never reaches the return value — it is
discarded with **no error**, and the run still reports success.

This is easy to write by accident. You test the node against a single input item, it
works, you ship it — and in production, once the upstream splitter emits fifty items,
forty-nine of them silently disappear. Nothing in the editor flags it; the node is
"valid," it just quietly processes one row and drops the rest.

The rule requires a splitter upstream so it only fires where more than one item can
actually arrive. A Code node fed by single-item sources drops nothing, and firing on
it would be a false positive — so the splitter requirement is what keeps the signal
high-confidence rather than warning on every `$input.first()` in the codebase.

## Wrong

```json
{
  "nodes": [
    { "name": "Split Out Rows", "type": "n8n-nodes-base.splitOut", "typeVersion": 1, "parameters": { "fieldToSplitOut": "rows" } },
    {
      "name": "Process Row",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "parameters": {
        "mode": "runOnceForAllItems",
        "jsCode": "const row = $input.first().json;\nreturn [{ json: { id: row.id } }];"
      }
    }
  ],
  "connections": {
    "Split Out Rows": { "main": [[{ "node": "Process Row", "type": "main", "index": 0 }]] }
  }
}
```

`Split Out Rows` turns one `rows` array into one item per row. `Process Row` runs once
over the whole batch but reads only `$input.first()`, so it handles row 0 and drops
every other row.

## Right

```json
{
  "nodes": [
    { "name": "Split Out Rows", "type": "n8n-nodes-base.splitOut", "typeVersion": 1, "parameters": { "fieldToSplitOut": "rows" } },
    {
      "name": "Process Row",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "parameters": {
        "mode": "runOnceForAllItems",
        "jsCode": "return $input.all().map((item) => ({ json: { id: item.json.id } }));"
      }
    }
  ],
  "connections": {
    "Split Out Rows": { "main": [[{ "node": "Process Row", "type": "main", "index": 0 }]] }
  }
}
```

Iterate the whole batch with `$input.all()`, returning one output item per input item.
Alternatively, set the node to **Run Once for Each Item** so it runs per item and
`$input.first()` legitimately refers to that one item. Reserve `$input.first()` for the
cases where you deliberately want a single item.

## How it was found

Distilled from the field notes behind this linter: a Code node that summarised "the"
record with `$input.first()` worked in every manual test — where one item was pinned —
and then processed only the first of many rows once a Split Out fed it live data. No
error was ever raised; the missing rows were noticed downstream, days later.
