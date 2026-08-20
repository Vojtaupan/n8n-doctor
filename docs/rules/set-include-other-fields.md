# set-include-other-fields

**Severity:** error  
**Applies to:** Set node (`n8n-nodes-base.set`), `typeVersion >= 3.3`

## What this rule checks

A Set node at `typeVersion >= 3.3` where `includeOtherFields` is nested under
`parameters.options` or `parameters.assignments` instead of at the `parameters` root.

## Why it matters

When `includeOtherFields` is misplaced, n8n silently ignores it. The Set node
outputs **only** the fields you explicitly assigned — every other field from
the upstream node (including entire webhook bodies) vanishes downstream with no
warning and no error. The workflow continues to run and produces no visible
failure, so this defect can survive for a long time undetected.

## Wrong

```json
{
  "name": "Edit Fields",
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4,
  "parameters": {
    "options": { "includeOtherFields": true },
    "assignments": { "assignments": [] }
  }
}
```

The flag is inside `parameters.options`. n8n does not read it there for this
version of the Set node; upstream fields are silently dropped.

## Right

```json
{
  "name": "Edit Fields",
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4,
  "parameters": {
    "includeOtherFields": true,
    "options": {},
    "assignments": { "assignments": [] }
  }
}
```

The flag is at the `parameters` root. n8n reads it correctly and passes all
upstream fields through alongside the explicitly assigned ones.

## Corpus evidence

Found **2 times** in a 479-workflow production corpus. Both occurrences were
genuine defects where webhook data was being silently discarded. The 0.4% hit
rate is low enough to trust every finding as a real problem.
