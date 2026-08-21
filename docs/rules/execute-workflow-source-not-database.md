# execute-workflow-source-not-database

**Severity:** warning  
**Applies to:** Execute Workflow node (`n8n-nodes-base.executeWorkflow`)

## What this rule checks

An Execute Workflow node whose `parameters.source` is present and set to
anything other than `"database"`.

`source` is optional and defaults to `database`, so a workflow that omits the
key is fine — the rule fires only when the key is explicitly set to `localFile`,
`parameter`, or `url`.

## Why it matters

The Execute Workflow node can load the sub-workflow it runs from four places:

- `database` — by id, from this n8n instance. One canonical, version-controlled
  workflow that every environment shares.
- `localFile` — a path on disk. Depends on a filesystem layout that differs
  between dev, staging, and prod; the same export runs different code, or none,
  depending on where it lands.
- `parameter` — inline workflow JSON. Freezes a **copy** of the sub-workflow the
  moment it is pasted in. Edit the real workflow and this copy silently drifts;
  the parent keeps running the stale version with no indication anything is out
  of date.
- `url` — fetched over the network at execution time. Adds a runtime network
  dependency and an external trust boundary to every run: if the URL is
  unreachable or its contents change, the parent's behaviour changes with it.

Only `database` gives you a single source of truth that deploys, versions, and
audits like the rest of your workflows. The other three all pass schema
validation and look complete in the editor, but each ties the parent to
something that lives outside n8n's own version control.

## Wrong

```json
{
  "name": "Execute Sub-Workflow",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1.2,
  "parameters": {
    "source": "localFile",
    "workflowPath": "/data/workflows/sub.json"
  }
}
```

The sub-workflow is loaded from a filesystem path that need not exist — or may
hold different content — in another environment.

## Right

```json
{
  "name": "Execute Sub-Workflow",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1.2,
  "parameters": {
    "source": "database",
    "workflowId": { "value": "abc123", "mode": "id" }
  }
}
```

The sub-workflow is referenced by id from the database. The parent always runs
the current, version-controlled workflow on this instance.

## How it was found

Distilled from the field notes behind this linter. A parent workflow executed a
sub-workflow from an inline `parameter` copy during early prototyping. The real
sub-workflow was later fixed, but the parent kept running the pasted-in original
because nothing links the two once the JSON is inlined — the bug had been fixed
"everywhere" except the copy no one remembered was frozen inside the caller.

This signature returned zero hits on the private calibration corpus — the corpus
belongs to the person who documented and fixed the trap — so the synthetic
fixture pair is its only coverage.
