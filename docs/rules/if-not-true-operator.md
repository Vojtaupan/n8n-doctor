# if-not-true-operator

**Severity:** warning  
**Applies to:** IF node (`n8n-nodes-base.if`) and Filter node (`n8n-nodes-base.filter`)

## What this rule checks

An IF or Filter node with a condition whose operator is the boolean `notTrue`
operator — `{ "type": "boolean", "operation": "notTrue" }`.

## Why it matters

`notTrue` looks like the clean inverse of `true`, but it does not route the way
a plain inverted test does. A boolean condition has three practical inputs, not
two: `true`, `false`, and *absent* (null, undefined, or an empty string from an
unresolved expression). `true` sends only genuinely-true values down the true
branch. `notTrue` sends **everything that is not exactly `true`** — including
missing and empty values — down its branch, so the routing depends on data
shape that is easy to get wrong and hard to see in the editor.

The result is a branch that fires on items you did not intend, or a workflow
whose behaviour changes the first time an upstream field is empty. Nothing
errors; the items simply take the wrong path.

## Wrong

```json
{
  "name": "If",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "parameters": {
    "conditions": {
      "conditions": [
        {
          "leftValue": "={{ $json.approved }}",
          "rightValue": "",
          "operator": { "type": "boolean", "operation": "notTrue", "singleValue": true }
        }
      ]
    }
  }
}
```

## Right

Test for `true` and swap the true/false branches so routing follows a single,
well-defined boolean test:

```json
{
  "name": "If",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "parameters": {
    "conditions": {
      "conditions": [
        {
          "leftValue": "={{ $json.approved }}",
          "rightValue": "",
          "operator": { "type": "boolean", "operation": "true", "singleValue": true }
        }
      ]
    }
  }
}
```

The work that used to hang off the `notTrue` branch now hangs off the false
branch of a `true` test. Same intent, deterministic routing.

## How it was found

Distilled from the field notes behind this linter. A workflow used `notTrue` to
mean "not approved" and routed correctly in testing, where the field was always
populated. In production the upstream step occasionally emitted an empty value;
those items matched `notTrue` and went down the rejection branch even though
they had never been evaluated. Rewriting the node to test `true` with swapped
branches made the routing predictable.

This signature returned zero hits on the private calibration corpus — the corpus
belongs to the person who documented and fixed the trap — so the synthetic
fixture pair is its only coverage.
