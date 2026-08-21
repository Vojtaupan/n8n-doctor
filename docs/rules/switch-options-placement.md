# switch-options-placement

**Severity:** error  
**Applies to:** Switch node (`n8n-nodes-base.switch`), `typeVersion >= 3`

## What this rule checks

A Switch node at `typeVersion >= 3` where the `options` key is nested **inside**
`parameters.rules` instead of sitting at the `parameters` root as a sibling of
`rules`.

## Why it matters

In the v3 Switch node, `options` (fallback output, loose type validation, etc.)
belongs directly under `parameters`, next to `rules`. When it is placed one level
too deep — inside `parameters.rules` — n8n cannot bind the node's property values.
**Activating the workflow fails with a cryptic `propertyValues` error**, and the
Switch never runs. The editor gives no hint that a single misplaced key is the
cause, so this can cost real time to diagnose.

This shape is easy to produce by hand-editing exported JSON or by copy-pasting a
rule block, and it passes schema-shaped inspection because both `rules` and
`options` are otherwise valid objects — they are just in the wrong nesting.

## Wrong

```json
{
  "name": "Route",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3,
  "parameters": {
    "rules": {
      "values": [{ "outputKey": "A" }],
      "options": { "fallbackOutput": "none" }
    }
  }
}
```

`options` is nested inside `parameters.rules`. Activation fails with a
`propertyValues` error.

## Right

```json
{
  "name": "Route",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3,
  "parameters": {
    "rules": {
      "values": [{ "outputKey": "A" }]
    },
    "options": { "fallbackOutput": "none" }
  }
}
```

`options` is at the `parameters` root, a sibling of `rules`. The node binds and
runs.

## How it was found

Distilled from the field notes behind this linter: a Switch node whose `options`
had drifted inside `rules` during manual JSON surgery refused to activate, and the
`propertyValues` error named neither the node nor the offending key. The fix was a
one-line move; finding it was not.
