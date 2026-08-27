# execute-workflow-input-dropped

**Severity:** error
**Applies to:** Execute Workflow node (`n8n-nodes-base.executeWorkflow`) paired with the
sub-workflow's Execute Workflow Trigger (`n8n-nodes-base.executeWorkflowTrigger`)

## What this rule checks

A **cross-workflow** rule. For each Execute Workflow node it resolves the child
workflow by id (via the shared context), reads the child's Execute Workflow
Trigger, and compares the parent's mapped input keys (`workflowInputs.value`)
against the inputs the child actually declares. Any parent key the child does
**not** declare is reported by name.

The trigger declares its inputs in one of two ways, and the rule handles both,
because both whitelist identically:

| `inputSource` | where the declared inputs live |
| --- | --- |
| `jsonExample` | the top-level keys of the pasted JSON object |
| `workflowInputs` | the `name` of each entry in `workflowInputs.values[]` |

`workflowInputs` is n8n's **default**, so `inputSource` is often absent when it is
in use; an absent key with a field list present counts as this mode.

The rule stays silent, deliberately, in four cases:

- **The child is not among the loaded files.** Absence of the file is not
  evidence of a defect, only absence of evidence. Load the parent and child
  together (a directory or glob) to get this check.
- **The trigger is `inputSource: 'passthrough'`.** It declares nothing and
  whitelists nothing - it forwards the parent's upstream `$json` verbatim and
  ignores the mapping outright. That is a different defect, and
  `execute-workflow-passthrough-ignores-mapping` reports it.
- **The trigger declares no inputs at all.** There is no whitelist to violate.
- **The parent is on `mappingMode: 'autoMapInputData'`.** The parent forwards the
  incoming item and the `value` map is inert UI state n8n never applies, so
  comparing it would accuse a mapping that has no effect.

## Why it matters

When a sub-workflow's trigger declares its inputs - by JSON example or by field
list - n8n treats **what it declares as a whitelist**. At runtime the parent's
mapped inputs are filtered against it: any field whose key is not declared is
**silently dropped**. No error, no warning, no editor hint - the field simply
never arrives at the child.

This is invisible in either file alone. The parent looks correct: it maps the
field with a real expression. The child looks correct: it accepts inputs. Only
with both in hand does the mismatch show, which is exactly what having every
loaded workflow in one context makes possible. A single-file linter cannot see
it.

The failure mode is the worst kind: the workflow runs, reports success, and does
the wrong thing because a value the author believed they passed was quietly
discarded upstream of the logic that needed it.

## Wrong

Parent maps `customerId` and `priority`:

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
        "priority": "={{ $json.priority }}"
      }
    }
  }
}
```

Child (id `child-abc123`) only declares `customerId`:

```json
{
  "name": "When Executed by Another Workflow",
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "typeVersion": 1.1,
  "parameters": {
    "inputSource": "jsonExample",
    "jsonExample": "{\n  \"customerId\": \"abc123\"\n}"
  }
}
```

`priority` is not in the example, so it never reaches the child. The child runs
with `priority` undefined and no one is told.

## Right

Declare every mapped key in the child's example (or stop mapping the unused one):

```json
{
  "name": "When Executed by Another Workflow",
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "typeVersion": 1.1,
  "parameters": {
    "inputSource": "jsonExample",
    "jsonExample": "{\n  \"customerId\": \"abc123\",\n  \"priority\": \"high\"\n}"
  }
}
```

Now the parent's mapping and the child's declared inputs agree, and every mapped
field is delivered.

The field-list form of the same declaration, which is the trigger's default:

```json
{
  "name": "When Executed by Another Workflow",
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "typeVersion": 1.1,
  "parameters": {
    "inputSource": "workflowInputs",
    "workflowInputs": {
      "values": [
        { "name": "customerId", "type": "string" },
        { "name": "priority", "type": "string" }
      ]
    }
  }
}
```

Drop either entry and the parent's matching mapped field is dropped with it.

## How it was found

Distilled from the field notes behind this linter. A parent workflow mapped a
field into a sub-workflow, the sub-workflow behaved as if the field were empty,
and the debugging went everywhere except the trigger — because the parent's
mapping plainly named the field. The sub-workflow's JSON example simply had not
been updated to include it, and n8n dropped the field without a word. It is a
cross-file defect, which is why it needs a linter that holds both files at once.

The rule's first version handled only the JSON-example declaration. A full corpus
run showed why that mattered: of 98 parent-child links that resolved, the child
declared its inputs by field list 14 times and by JSON example not once. An
`error`-severity rule was inspecting none of the places its own defect could
occur. It covers both modes as of the zero-firing audit in
`docs/calibration.md`.
