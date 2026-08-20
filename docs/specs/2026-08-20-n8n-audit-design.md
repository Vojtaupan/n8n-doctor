# n8n-audit — design

**Date:** 2026-08-20
**Status:** approved (Vojtech, in session)

## Problem

n8n ships a config validator: it checks node parameters against schemas and tells you a
workflow *can* run. Nothing checks whether it will run *correctly* once deployed.

The expensive n8n bugs are not schema violations. They are graph-shape and semantics traps
that pass every validator and then silently drop items, fire twice, swallow errors, or write
to the wrong cells at 2am. They are invisible in the editor and expensive in production.

There is no linter for that layer. This is that linter.

## Scope

`n8n-audit` is a CLI that reads exported n8n workflow JSON and reports production-readiness
defects. It is a static analyser: no execution, no network, no model calls, deterministic
output.

**Explicit non-goal:** re-implementing schema/config validation. n8n-mcp's `validate_workflow`
already does that well. Duplicating it would ship a worse copy of something already in the box.
`n8n-audit` starts where that stops.

## Rule provenance

Rules come from two sources:

1. **Field-derived (~22).** Distilled from 34 documented runtime traps recorded while building
   ~479 production workflows. Each was discovered by losing hours to it.
2. **Universal production-readiness (~7).** Hardcoded secrets, missing retries, unauthenticated
   webhooks, silent error swallows, pinned test data in active workflows, disabled nodes,
   no error workflow.

Twelve of the 34 notes were deliberately excluded, and the reasons are part of the design:

| Excluded | Why |
|---|---|
| `code_node_template_literals`, `code_runOnceForAllItems_primitive_falsepos`, `validator_double_brace_scan` | Describe the *n8n validator's own false positives*, not workflow defects. Linting these would lint the wrong artifact. |
| `write_api_additional_properties` | An n8n REST API quirk, unrelated to workflow content. |
| `sheets_credential`, `sheets_cred_drive_scope`, `sheets_demo_cred_revoked` | Contain private credential identifiers. Cannot enter a public repo. The *generalised* lesson from `sheets_cred_drive_scope` survives as the `silent-continue` rule. |
| `gdrive_mcp_direct` | Design advice, not a detectable condition. |

## Architecture

Single-purpose CLI, TypeScript, distributed on npm for `npx` with no install.

```
src/
  cli.ts          arg parsing, glob expansion, exit codes
  load.ts         parse exports; tolerate UI-download / API-response / CLI-export shapes
  graph.ts        normalised model: nodes, typed edges, parent+child lookup, traversal
  engine.ts       run registry over graph, order findings by severity
  rules/<id>.ts   one self-contained rule per file
  report/         text.ts (default), json.ts (--json)
```

Rules never touch raw JSON. They receive the normalised graph, which is what keeps ~29 rules
from tangling and what lets an outsider add rule #30 in one file.

```ts
interface Rule {
  id: string;                    // 'merge-combine-all-empty'
  severity: 'error' | 'warning' | 'info';
  title: string;
  docs: string;                  // docs/rules/<id>.md
  check(graph: WorkflowGraph, ctx: Context): Finding[];
}

interface Finding {
  ruleId: string;
  severity: Severity;
  nodeName?: string;
  message: string;               // what is wrong
  suggestion?: string;           // what to do instead
}
```

`ctx` holds every loaded workflow. This enables the cross-workflow checks that are the tool's
most distinctive capability: a parent whose Execute Workflow mapping is silently discarded by
its child's `jsonExample` whitelist is invisible in either file alone and obvious when both are
in hand.

**Interface:**

```
npx n8n-audit ./workflows            # text report
npx n8n-audit ./wf/*.json --json     # machine-readable
cat wf.json | npx n8n-audit -        # stdin
```

Exit 1 when any `error`-severity finding is present, so it drops into CI unchanged.
Input is local JSON only in v1; a `--api-url/--api-key` live mode is v1.1, deliberately deferred
so that trying the tool needs no credentials.

## Verification

Two gates. Both are objective, which is what makes an unattended build safe.

**Gate 1 — paired fixtures.** Every rule ships with two hand-written synthetic workflows: one
that must trigger it, one corrected version that must not. The pair guards false negatives and
false positives simultaneously. No rule is done without both.

**Gate 2 — corpus calibration.** The linter runs across 479 real workflows (4,412 nodes) and
reports per-rule fire rates. **Any rule firing on more than 5% of the nodes it inspects must be
narrowed or demoted to `info` before shipping.** A linter that cries wolf gets uninstalled, so
this is a release gate, not a nicety.

Measured on 2026-08-20 with a throwaway probe, before implementation:

| Naive signature | Raw hits | Consequence for the rule |
|---|---|---|
| `http-no-batching` | 1,094 | Must require a demonstrably multi-item upstream source |
| `http-no-retry` | 973 | Narrow to active workflows lacking an error branch |
| `silent-continue` | 533 | `info` unless nothing downstream inspects the result |
| `webhook-no-auth` | 303 | Narrow to active workflows |
| `multi-parent-fanin` | 282 | Naive shape wrong; real bug needs mutually exclusive parents |
| `set-includeOtherFields-in-options` | 2 | Correctly narrow; both are genuine live defects |

Several field-derived signatures (`merge-combineAll`, `if-notTrue`, `exec-wf-source-not-db`)
returned zero corpus hits, which is expected: the corpus belongs to the person who documented
and then fixed them. Those rules rely on synthetic fixtures for coverage.

## Privacy boundary

The 479-workflow corpus is client work: client names, webhook URLs, business logic, credential
IDs. It lives in a gitignored `corpus/` directory, is used only for calibration, and is never
committed. `.gitignore` was written before the corpus was pulled.

Committed fixtures are synthetic and minimal — roughly fifteen lines each, one trap apiece.
Credentials are read at runtime from an existing `.mcp.json` and never copied into this repo.

## Repository

Standalone public repo at `C:\Users\Lenovo\Documents\n8n-audit`, MIT licensed. Deliberately
outside the private vault and outside the client build repo.

## Out of scope for v1

- Live-instance mode (`--api-url`) — v1.1
- Autofix — reporting must earn trust before rewriting anyone's workflows
- Editor/IDE integration
- LLM-assisted analysis — non-deterministic, costs money per run, cannot be trusted in CI
