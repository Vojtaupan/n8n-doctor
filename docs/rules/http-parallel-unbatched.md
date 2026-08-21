# http-parallel-unbatched

**Severity:** info  
**Applies to:** an HTTP Request node at `typeVersion >= 4` with no batching
configured, when a demonstrably multi-item source (Split In Batches / Loop Over
Items, Item Lists, a mapping Code node, or a node set to run per item) appears
among its transitive ancestors.

## What this rule checks

An HTTP Request node that:

1. is `typeVersion >= 4`; and
2. has **no** `parameters.options.batching` — the batching key is absent
   entirely; and
3. has a transitive ancestor that demonstrably emits many items:
   - a **splitter** — `splitInBatches` (Loop Over Items) or `itemLists`
     (Item Lists); or
   - a **Code node** whose `jsCode` calls `.map(`, building one output item per
     input item; or
   - **any node** with `parameters.mode === 'each'`, explicitly set to run per
     item.

If batching is configured at all — the `options.batching` key is present — the
rule stays silent: the author has already addressed the burst.

## Why it matters

From `typeVersion 4` onward, the HTTP Request node fires **all** incoming items in
parallel by default. Earlier versions walked the batch one item at a time; v4
flipped the default to maximum concurrency. That is fast when the endpoint can take
it and catastrophic when it cannot.

When the upstream stream carries many items — because a splitter, a mapping Code
node, or a per-item node sits among its ancestors — an unbatched v4 node sends the
entire batch of requests at once. Fifty upstream items become fifty simultaneous
requests. Most public APIs answer that with `HTTP 429 Too Many Requests`, and some
temporarily ban the caller. Nothing in the editor warns about it: the node is
valid, and it runs perfectly against the single pinned item you tested with. The
failure only appears in production once real data widens the stream.

The naive "HTTP v4 without batching" shape matched **1,094 nodes** on the
calibration corpus, because most of those nodes only ever see one item and firing
them all "in parallel" is harmless. Requiring a demonstrably multi-item ancestor is
the narrowing that separates a real finding from noise — and even then the rule
ships at `info`, because a burst of parallel requests is a risk (it depends on the
endpoint's limits), not a guaranteed defect.

## Wrong

```json
{
  "nodes": [
    { "name": "Loop Over Items", "type": "n8n-nodes-base.splitInBatches", "typeVersion": 3, "parameters": { "batchSize": 1, "options": {} } },
    {
      "name": "Call API",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "parameters": { "url": "https://api.example.com/items", "options": {} }
    }
  ],
  "connections": {
    "Loop Over Items": { "main": [[], [{ "node": "Call API", "type": "main", "index": 0 }]] }
  }
}
```

`Loop Over Items` feeds many items into `Call API`, which has no batching. On v4
every request goes out at once.

## Right

```json
{
  "nodes": [
    { "name": "Loop Over Items", "type": "n8n-nodes-base.splitInBatches", "typeVersion": 3, "parameters": { "batchSize": 1, "options": {} } },
    {
      "name": "Call API",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "parameters": {
        "url": "https://api.example.com/items",
        "options": { "batching": { "batch": { "batchSize": 10, "batchInterval": 1000 } } }
      }
    }
  ],
  "connections": {
    "Loop Over Items": { "main": [[], [{ "node": "Call API", "type": "main", "index": 0 }]] }
  }
}
```

Enable **Options → Batching**: a Batch Size and a Batch Interval (ms) send requests
in throttled groups instead of all at once. Match the batch size and interval to the
endpoint's documented rate limit.

## How it was found

Distilled from the field notes behind this linter, and confirmed against the
calibration corpus: the unnarrowed "v4 HTTP node with no batching" signature lit up
1,094 nodes — far too many to be useful, most of them single-item calls where
parallelism costs nothing. The real trap is narrower: a v4 node placed after
something that fans the stream wide, where the default parallel fire turns one
logical step into a rate-limit-tripping thundering herd. Restricting the rule to a
demonstrably multi-item ancestor is what makes it worth surfacing.
