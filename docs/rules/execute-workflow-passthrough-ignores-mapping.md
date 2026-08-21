# execute-workflow-passthrough-ignores-mapping

**Severity:** warning
**Applies to:** Execute Workflow node (`n8n-nodes-base.executeWorkflow`) paired with the
sub-workflow's Execute Workflow Trigger (`n8n-nodes-base.executeWorkflowTrigger`)

## What this rule checks

A **cross-workflow** rule. For each Execute Workflow node that maps inputs
(`workflowInputs.value` is non-empty), it resolves the child workflow by id (via
the shared context) and reads the child's Execute Workflow Trigger. If — and only
if — that trigger declares its input source as `inputSource: 'passthrough'`, the
rule fires, listing the mapped keys the child will never see.

If the child workflow is not among the loaded files, the rule emits nothing:
absence of the file is not evidence of a defect, only absence of evidence. Load
the parent and child together (a directory or glob) to get this check.

## Why it matters

An Execute Workflow Trigger has three ways to describe its inputs:

- **Define using fields below** (`inputSource: 'workflowInputs'`)
- **Define using JSON example** (`inputSource: 'jsonExample'`)
- **Accept all data** (`inputSource: 'passthrough'`)

The first two give the child a declared input shape, and the parent's mapping is
delivered against it. **Passthrough is different: the child receives the parent's
upstream `$json` unchanged and the mapping is ignored entirely.** Nothing errors.
The parent's carefully written `workflowInputs.value` mapping is dead weight — it
describes inputs the child does not consume.

That makes the mapping a lie about what the child sees. Whoever reads the parent
believes the child runs on `customerId` and `channel`; the child actually runs on
whatever `$json` happened to flow into the Execute Workflow node. If those two
disagree — a renamed field, an extra wrapper, a value computed only in the
mapping expression — the child silently operates on the wrong data.

This is invisible in either file alone. The parent looks correct: it maps its
fields. The child looks correct: it accepts input. Only with both in hand does the
mismatch show, which is exactly what having every loaded workflow in one context
makes possible.

## Wrong

Parent maps `customerId` and `channel`:

```json
{
  "name": "Execute Sub-Workflow",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1.3,
  "parameters": {
    "workflowId": { "value": "child-abc123", "mode": "id" },
    "workflowInputs": {
      "mappingMode": "defineBelow",
      "value": {
        "customerId": "={{ $json.customerId }}",
        "channel": "email"
      }
    }
  }
}
```

Child (id `child-abc123`) accepts all data by passthrough:

```json
{
  "name": "When Executed by Another Workflow",
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "typeVersion": 1.1,
  "parameters": {
    "inputSource": "passthrough"
  }
}
```

The mapping never runs. The child receives the parent's upstream `$json` as-is;
`customerId` and `channel` as mapped are discarded.

## Right

Declare the child's inputs so the mapping is honoured (fields below, or a JSON
example):

```json
{
  "name": "When Executed by Another Workflow",
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "typeVersion": 1.1,
  "parameters": {
    "inputSource": "jsonExample",
    "jsonExample": "{\n  \"customerId\": \"abc123\",\n  \"channel\": \"email\"\n}"
  }
}
```

Now the parent's mapping lands on a declared input shape and the child receives
exactly what the parent mapped. Alternatively, if passthrough is genuinely what
you want, remove the mapping from the parent and shape the child's input upstream
so the JSON on the file reflects what actually happens.

## How it was found

Distilled from the field notes behind this linter. A sub-workflow was refactored
from a declared-input trigger to "Accept all data" so it could be reused more
loosely, but the parents that called it kept their old field mappings. The
mappings still read correctly in every parent, so nobody suspected them — yet the
children were running on raw upstream `$json` and quietly ignoring the mapping.
It is a cross-file defect, which is why it needs a linter that holds both files at
once.
