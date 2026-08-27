# if-v2-missing-left-value

**Severity:** error  
**Applies to:** IF node (`n8n-nodes-base.if`), `typeVersion >= 2.2`

## What this rule checks

An IF node at `typeVersion >= 2.2` whose `parameters.conditions.options` object
**exists but has no `leftValue` key**.

## Why it matters

The v2 IF/Filter node stores a top-level `leftValue` inside
`conditions.options`, next to `caseSensitive` and `typeValidation`. It normally
defaults to an empty string, so it is easy to miss — and easy to drop when
hand-editing exported JSON or generating a node programmatically.

When that key is absent, **n8n's own workflow-creation API rejects the node** —
even though every individual condition under `conditions.conditions[]` already
carries its own `leftValue`. The per-condition values are not enough; the API
validates the presence of the options-level `leftValue` separately. The node
looks complete in the editor and passes schema-shaped inspection, but the
workflow cannot be created.

## Wrong

```json
{
  "name": "If",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": true,
        "typeValidation": "strict"
      },
      "conditions": [
        {
          "leftValue": "={{ $json.status }}",
          "rightValue": "active",
          "operator": { "type": "string", "operation": "equals" }
        }
      ],
      "combinator": "and"
    }
  }
}
```

`conditions.options` has no `leftValue`. Creation is rejected despite the
condition supplying its own `leftValue`.

## Right

```json
{
  "name": "If",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": true,
        "typeValidation": "strict",
        "leftValue": ""
      },
      "conditions": [
        {
          "leftValue": "={{ $json.status }}",
          "rightValue": "active",
          "operator": { "type": "string", "operation": "equals" }
        }
      ],
      "combinator": "and"
    }
  }
}
```

`conditions.options.leftValue` is present (empty is fine). The node is accepted.

## How it was found

Distilled from the field notes behind this linter: an IF node assembled outside
the editor was rejected by n8n's creation API with an error that pointed at the
conditions block but not at the missing key. Every condition already had a
`leftValue`, which sent the debugging in the wrong direction. The fix was to add
a single empty `leftValue` to `conditions.options`.

This rule reports **zero** findings on the 479-workflow calibration corpus, but
that corpus validates its version gate rather than leaving it unexamined: of the
254 IF nodes there, **all 212 at typeVersion 2.2 or 2.3 carry
`conditions.options.leftValue`**, while 26 of the 42 at typeVersion 2.0 - where
it is not required - do not. n8n's own serializer emits the key at 2.2+, so an
exported workflow structurally cannot contain the defect; a hand-assembled or
agent-generated one can, and is rejected on creation. See the zero-firing audit
in `docs/calibration.md`.
