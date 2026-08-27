# execute-workflow-missing-mapping-mode

**Severity:** error  
**Applies to:** Execute Workflow node (`n8n-nodes-base.executeWorkflow`), `typeVersion >= 1.3`

## What this rule checks

An Execute Workflow node at `typeVersion >= 1.3` whose `parameters.workflowInputs`
object **is present but has no `mappingMode` key**.

## Why it matters

At typeVersion 1.3 the sub-workflow inputs became a **resource-mapper**
parameter. Its shape is `{ mappingMode, value, schema }`, where `mappingMode`
decides how the parent supplies data to the child:

- `defineBelow` — map fields explicitly via `value`
- `autoMapInputData` — pass the incoming items straight through

`mappingMode` is the switch that makes the whole block mean anything. When it is
absent — easy to drop when hand-editing exported JSON or generating the node
programmatically — n8n's **workflow-creation API silently fails to create the
node**. No error surfaces in the editor, and the mapping under `value` never
takes effect. The node looks complete and passes schema-shaped inspection, but
the sub-workflow either never runs as intended or receives nothing.

## Wrong

```json
{
  "name": "Execute Sub-Workflow",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1.3,
  "parameters": {
    "workflowId": { "value": "abc123", "mode": "id" },
    "workflowInputs": {
      "value": { "customerId": "={{ $json.customerId }}" },
      "schema": [
        { "id": "customerId", "displayName": "customerId", "type": "string" }
      ]
    }
  }
}
```

`workflowInputs` carries a `value` and a `schema` but no `mappingMode`. Creation
silently fails.

## Right

```json
{
  "name": "Execute Sub-Workflow",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1.3,
  "parameters": {
    "workflowId": { "value": "abc123", "mode": "id" },
    "workflowInputs": {
      "mappingMode": "defineBelow",
      "value": { "customerId": "={{ $json.customerId }}" },
      "schema": [
        { "id": "customerId", "displayName": "customerId", "type": "string" }
      ]
    }
  }
}
```

`workflowInputs.mappingMode` is present. The node is created and the mapping
takes effect.

## How it was found

Distilled from the field notes behind this linter: an Execute Workflow node
assembled outside the editor refused to be created through the API. The failure
was silent — the returned workflow simply did not contain the node — which sent
the debugging toward permissions and IDs before the missing `mappingMode` key
turned out to be the cause. Adding it fixed creation immediately.

This rule reports **zero** findings on the 479-workflow calibration corpus,
because n8n rejects the node at creation time - so the defect never survives into
an export. All 71 `workflowInputs` objects in that corpus carry `mappingMode`
(63 `defineBelow`, 8 `autoMapInputData`). Like the other creation-time rules
here, its audience is JSON on its way to the API, not JSON that came back from
it. See the zero-firing audit in `docs/calibration.md`.
