# n8n-lint

Lint exported n8n workflow JSON for production-readiness defects that schema
validators cannot see.

## The problem

n8n's own validator answers one question: **can this workflow run?** It checks
node parameters against schemas and tells you the config is well formed.

Nothing answers the second question: **will it run correctly once deployed?**

The expensive n8n bugs are not schema violations. They are graph-shape and
semantic traps that pass every schema validator and then, in production, silently
drop items, fire twice, swallow an error, or write data in a format that corrupts
it. A misplaced `includeOtherFields` on a Set node is valid JSON, valid config,
and drops every upstream field downstream with no error. An expression spliced
into a JSON body as a bare value works right up to the day it resolves to a
string. A Google Sheets write left on `USER_ENTERED` reports success while Sheets
quietly re-parses your phone numbers as arithmetic.

None of that is visible in the editor. All of it shows up at 2am.

This is a linter for that layer.

## What it does

```
npx n8n-lint path/to/workflow.json      # one file
npx n8n-lint ./workflows                # a directory, recursively
cat workflow.json | npx n8n-lint -      # stdin
```

Static analysis only: no execution, no network, no model calls, deterministic
output. It reads all three export shapes - the UI **Download**, a public-API
response, and the array `n8n export:workflow` produces - and normalises them, so
nothing you have to do depends on which one you used.

A real run, against a small sample workflow:

```
$ npx n8n-lint nightly-export.json
Nightly Export
  error   set-include-other-fields  Shape Payload — "includeOtherFields" is nested under parameters.options instead of the parameters root. n8n silently ignores the misplaced flag and drops all upstream fields downstream.
          ↳ Move "includeOtherFields" to the parameters root (e.g. "parameters": { "includeOtherFields": true, "options": {}, ... }). Placing it anywhere other than the parameters root causes it to be silently ignored.
  error   http-json-body-inline-expression  Post Record — parameters.jsonBody splices an expression into the JSON as a bare value, outside any string literal (e.g. {{ $json.id }}). The result is pasted in unquoted, so the body is valid JSON only while the expression returns a number, boolean, or null. As soon as it resolves to a string — or to anything containing a quote, comma, or newline — the request body is malformed and the node fails at runtime. The editor shows nothing, and numeric test data hides it.
          ↳ Quote the hole ("{{ $json.id }}") if the value is a string, or build the whole body in a single expression — ={{ JSON.stringify({ userId: $json.id }) }} — which quotes and escapes every value correctly.
  warning sheets-user-entered-for-data  Append Row — A Google Sheets write asks for USER_ENTERED input (at parameters.options.cellFormat). Sheets then evaluates every written value as if a person typed it: strings beginning "=" become formulas, phone numbers beginning "+" or "-" become arithmetic, ISO timestamps coerce to Sheets dates that no longer round-trip, and leading-zero codes lose their zeros. The write succeeds and the workflow reports success, but the stored data no longer matches what you sent.
          ↳ Set options.cellFormat to "RAW" so values are stored verbatim, exactly as the workflow produced them. Use USER_ENTERED only when you deliberately want Sheets to parse formulas or reformat input.
  info    http-parallel-unbatched  Post Record — HTTP Request "Post Record" is typeVersion 4.2 with no batching configured, and its input traces back to "Build Rows" (code), which emits many items. From v4 the node fires every incoming item in parallel by default, so it sends the whole batch of requests at once — which readily trips the endpoint's rate limit (HTTP 429) or gets you temporarily banned. It runs fine against a single test item, so nothing flags it until production.
          ↳ Enable batching under the node's Options → Batching: set a Batch Size and a Batch Interval (ms) so requests go out in throttled groups instead of all at once. Match the batch size and interval to the endpoint's documented rate limit.

Summary: 2 error, 1 warning, 1 info
```

Every finding carries a suggestion, because a finding you cannot act on is noise
with a rule id attached.

### Options

| flag | effect |
| --- | --- |
| `--severity <level>` | minimum severity to report: `error`, `warning`, `info` (default `info`) |
| `--rule <id>` | run only this rule; repeatable |
| `--json` | machine-readable output |
| `--quiet` | drop the closing summary line |
| `--no-color` | disable ANSI colour (also off automatically when stdout is not a TTY) |
| `-h`, `--help` | usage |

Two rules are **cross-workflow**: they resolve an Execute Workflow node's child by
id against the other workflows in the same run. Pass the directory, not a single
file, if you want those to fire.

Requires Node 20 or newer. Two runtime dependencies (`fast-glob`, `picocolors`).

## Calibration

There are already a dozen or so open-source n8n linters, and none of them has
meaningful adoption. The plausible reason is that a linter which opens with
hundreds of findings on a workflow that has been running fine for a year teaches
you, in one run, that its output is not worth reading.

So the claim here is not that this tool finds more. It is that **what it reports
is worth reading**, and that claim is measured rather than asserted.

The evidence, in full, is in **[`docs/calibration.md`](docs/calibration.md)**,
including the parts that do not flatter the tool. The summary:

### The corpus

**479 real n8n workflows, 4,412 nodes**, exported from production instances. Not
fixtures, not synthetic: workflows built to do a job that are doing it. A linter
calibrated against workflows written to trip it will always look good.

### The results

Measured 2026-08-27, whole corpus, one pass, through the same pipeline the CLI
uses.

| metric | value |
| --- | --- |
| workflows scanned | 479 |
| nodes scanned | 4,412 |
| rules run | 18 |
| findings, total | **605** |
| - `error` | **22** |
| - `warning` | 291 |
| - `info` | 292 |
| rule crashes | 0 |
| rules over bound | 0 |
| gate | **PASS** |

The line to look at is the error line. **The entire rule suite produces 22 error
findings across 479 production workflows.** Those land in at most 15 workflows,
so **at least 96.8% of the corpus comes back error-clean** (464 of 479). That is
a first run a user can work through instead of dismissing.

### The gate

Every rule is judged against bounds set by its own severity, and the gate is a CI
step that fails the build when a rule goes over.

| severity | max rate | max absolute |
| --- | --- | --- |
| `error` | 0.5% of nodes scanned | 25 findings |
| `warning` | 5% of nodes scanned | none |
| `info` | 13.24% of nodes scanned | none |

**`error` is bounded an order of magnitude tighter than `warning` because the
cost of being wrong is an order of magnitude higher.** A warning invites a look.
An error demands work: stop the build, open the workflow, change something. The
second time that turns out to be for nothing, the user stops believing the first
line of output.

The absolute cap exists because a rate alone does not bite on the number the user
actually sees. 3.72% sounds tolerable. 164 wrong errors on first install is how a
linter gets uninstalled before its second run.

The `info` bound is derived rather than chosen: the loudest legitimate advisory
rule measures 6.618% and is right to, so the bound is twice that. Tying it to a
measurement means that if the corpus moves, the derivation moves with it.

**How to read a rate.** A rule's rate is its finding count over the total nodes
scanned in the run, and that denominator - 4,412 - is **identical for every
rule**. So it is not a false-positive rate and it is not the share of the nodes
that rule inspected. It answers one question: how much **of all nodes scanned**
did this rule accuse? Read it as a floor.

### The gate's proof of work

A gate nothing has ever failed is a decoration. This one has a case.

`http-json-body-inline-expression` used to produce **164 error findings across 95
workflows** - 3.72% of nodes, and nearly all of them working, correct code. The
rule had two wrong premises, one of which meant it was flagging
`JSON.stringify()` wrappers, which is precisely the fix its own suggestion
recommends. It was reporting the remedy as the disease.

Narrowing it took that rule from **164 findings to 20** and the whole suite from
166 errors to 22.

The relevant part is not that a rule was wrong. It is that **164 mostly-benign
errors cleared the old flat threshold.** The threshold said this was fine. The
current bounds are calibrated against exactly that: the same behaviour now fails
the `error` rate bound by more than sevenfold and breaches the absolute cap by
more than 6.5x, and both failures are pinned by unit tests so the gate cannot
regress back to permitting it.

Rules have been narrowed and cut to meet these bounds. One was cut outright,
taking the registry from 19 to 18.

### The rule that could not fire

The gate bounds noise. It says nothing about silence, so silence is audited
separately - and the audit found the worst bug in this project.

`sheets-user-entered-for-data` fired zero times on 4,412 nodes. It searched for
the parameter key `valueInputOption`, which the n8n Google Sheets node never
emits: the node calls the option `cellFormat` or `valueInputMode`, and an HTTP
Request calling the Sheets API directly carries `valueInputOption` inside a URL
or a JSON body, where it is part of a string value and never a key. The rule was
structurally incapable of reporting the defect it was written for.

Its unit test passed the whole time, because **the fixture had been written in
the same wrong shape as the matcher**. The rule and its test agreed with each
other and neither agreed with n8n.

Fixed, it reports **131 findings across 66 workflows**. The 120 it produced
before the final quote fix were then checked exhaustively against the corpus: all
120 are true positives. **Measured false positives: zero.**

That is the argument for auditing zero-firing rules, and it is why the audit
checks fixtures against the platform rather than against the rule.

### What it still misses

The same rule is blind to the most common form of its own defect. It fires on a
Sheets write that *sets* the cell-format option to `USER_ENTERED`, but from node
typeVersion 4.1 onward that is the platform default, so a write that sets nothing
is a `USER_ENTERED` write too. (That version boundary is read from n8n's source
rather than executed, so unlike the rest of the numbers here it is inferred; the
basis is noted in `docs/calibration.md`.) On this corpus, 149 of 172 Sheets write operations
set no cell-format option at all. True incidence is therefore about **280 nodes,
6.346%**, against the 131 (2.969%) the rule reports - and **at 6.346% it would
breach its own 5% warning bound if it detected properly.**

That is stated rather than fixed, deliberately: closing it would force either
moving a bound to fit a rule, which is the anti-pattern this gate exists to
prevent, or re-deciding the rule's severity, which is a product call and not a
measurement. It is limits item 4 in [`docs/calibration.md`](docs/calibration.md)
and the first item in
[`docs/plans/v1.1-backlog.md`](docs/plans/v1.1-backlog.md).

Six of the eighteen rules produce nothing on this corpus. Each has a stated,
checkable reason for being silent, established by the same audit. That is weaker
than corpus evidence and stronger than nothing, and it is written up rather than
hidden.

## The rules

Eighteen rules. Each links to a page giving the exact signature it matches, why
the defect costs you something, and how to fix it.

### `error`

| rule | what it catches |
| --- | --- |
| [`execute-workflow-input-dropped`](docs/rules/execute-workflow-input-dropped.md) | The parent maps an input the child sub-workflow does not declare, so n8n discards it at runtime with no error. |
| [`execute-workflow-missing-mapping-mode`](docs/rules/execute-workflow-missing-mapping-mode.md) | Execute Workflow at typeVersion >= 1.3 has a `workflowInputs` object with no `mappingMode` key. |
| [`expression-adjacent-close-braces`](docs/rules/expression-adjacent-close-braces.md) | A nested object literal's `}}` is read as the expression terminator, so the expression ends early. |
| [`http-json-body-inline-expression`](docs/rules/http-json-body-inline-expression.md) | An expression is spliced into a JSON body as a bare, unquoted value; the request breaks the moment it resolves to a string. |
| [`if-v2-missing-left-value`](docs/rules/if-v2-missing-left-value.md) | IF at typeVersion >= 2.2 has a `conditions.options` object with no `leftValue` key. |
| [`set-include-other-fields`](docs/rules/set-include-other-fields.md) | `includeOtherFields` is nested under `options` or `assignments` instead of the parameters root, so n8n ignores it and drops every upstream field. |
| [`switch-options-placement`](docs/rules/switch-options-placement.md) | Switch at typeVersion >= 3 has `options` nested inside `rules` instead of at the parameters root. |

### `warning`

| rule | what it catches |
| --- | --- |
| [`code-first-drops-items`](docs/rules/code-first-drops-items.md) | A Code node in run-once-for-all-items mode reads `$input.first()` downstream of a splitter, dropping every other item. |
| [`execute-workflow-passthrough-ignores-mapping`](docs/rules/execute-workflow-passthrough-ignores-mapping.md) | The parent maps inputs but the child trigger is passthrough, so the whole mapping is ignored. |
| [`execute-workflow-source-not-database`](docs/rules/execute-workflow-source-not-database.md) | The sub-workflow is loaded from a file, URL, or inline copy rather than the database. |
| [`http-raw-body`](docs/rules/http-raw-body.md) | A raw request body is rewritten to an empty body on programmatic creation. |
| [`if-not-true-operator`](docs/rules/if-not-true-operator.md) | The boolean `notTrue` operator routes inconsistently; it is not the clean inverse of `true`. |
| [`merge-combine-all-empty-input`](docs/rules/merge-combine-all-empty-input.md) | A Merge in Combine All mode fed from an IF/Switch branch can collapse the cross-product to zero items. |
| [`mutually-exclusive-fan-in`](docs/rules/mutually-exclusive-fan-in.md) | A non-Merge node is fed by two mutually exclusive branch outputs of the same IF or Switch. |
| [`paired-item-lineage-broken`](docs/rules/paired-item-lineage-broken.md) | An expression reads `$('X').item` where X is a Code node that maps items, so paired-item lineage cannot resolve. |
| [`sheets-url-literal-space`](docs/rules/sheets-url-literal-space.md) | A literal space in a Sheets A1 range tab name makes the API request fail silently. |
| [`sheets-user-entered-for-data`](docs/rules/sheets-user-entered-for-data.md) | A Google Sheets write asks for `USER_ENTERED`, so Sheets re-parses every stored value as if it had been typed. |

### `info`

| rule | what it catches |
| --- | --- |
| [`http-parallel-unbatched`](docs/rules/http-parallel-unbatched.md) | HTTP Request at typeVersion >= 4 with no batching, downstream of a splitter, fires every item in parallel. |

## What it deliberately does not do

**Schema and config validation is an explicit non-goal.** n8n-mcp's
`validate_workflow` already does that well, and duplicating it would ship a worse
copy of something already in the box. This tool starts where that stops: it
assumes your workflow is well formed and asks whether it is correct.

The two are complementary, not alternatives. Run `validate_workflow` to find out
whether a workflow can run. Run this to find out what it will do wrong once it
does.

It also does not execute anything, call the n8n API, reach the network, or use a
model. It reads JSON and reports. That is the whole surface.

## Continuous integration

Exit codes:

| code | meaning |
| --- | --- |
| `0` | clean, or findings only below `error` |
| `1` | at least one `error`-severity finding |
| `2` | bad usage, or no readable workflow in the given paths |

`2` is deliberately distinct from `0`. A glob that matches nothing is not a clean
run, and a CI step that treats it as one will pass forever while linting nothing.

Gate a deploy on the error tier:

```yaml
# .github/workflows/lint-workflows.yml
name: lint n8n workflows
on: [push, pull_request]

jobs:
  n8n-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # Fails the job on any error-severity finding; exits 2 if ./workflows is empty.
      - run: npx n8n-lint ./workflows --severity error
```

Drop `--severity error` to see warnings and advisories in the log without failing
the build - the exit code is driven by error findings either way.

For a machine-readable report, `--json` writes the findings verbatim plus a
per-severity summary to stdout:

```json
{
  "findings": [
    {
      "nodeName": "Shape Payload",
      "message": "\"includeOtherFields\" is nested under parameters.options instead of the parameters root. ...",
      "suggestion": "Move \"includeOtherFields\" to the parameters root ...",
      "ruleId": "set-include-other-fields",
      "severity": "error",
      "workflowName": "Nightly Export",
      "crashed": false
    }
  ],
  "summary": { "error": 1, "warning": 0, "info": 0, "total": 1 }
}
```

`crashed` is on every finding. It is `false` for anything a rule genuinely
reported and `true` only on a placeholder the engine synthesizes when a rule
throws, so one malformed workflow cannot kill a run over hundreds. Filter on it
if you are counting findings: a crash is not a defect that was found.

## Limits

The honest version. The long version, with the measurements behind each point, is
in [`docs/calibration.md`](docs/calibration.md).

1. **The calibration numbers are reported, not reproducible by you.** The corpus
   is private production work. It is gitignored, it is not in the package, and it
   will not be published. You can run the harness against your own directory of
   workflows and get the same table for your own material, which is the check
   that actually matters to you, but the 479 / 4,412 figures you have to take on
   the record of them.
2. **Six of eighteen rules have no corpus evidence**, four of them at `error`
   severity. Each fires against a synthetic fixture and each has a stated reason
   for being silent on real workflows. That is not the same bar the other twelve
   cleared.
3. **A rate is a floor, not a false-positive rate.** A rule scoring 0.453% did
   not get 99.5% of its judgements right. It accused 0.453% of all nodes scanned.
4. **`sheets-user-entered-for-data` under-detects**, by more than it detects. See
   [what it still misses](#what-it-still-misses) above.
5. **A passing gate is not proof the findings are correct.** The gate bounds
   volume. A rule that is wrong quietly - firing rarely, wrong every time -
   passes it easily. What caught the 164-finding rule was volume plus a human
   reading the flagged values. The gate narrows where that reading has to happen;
   it does not replace it.
6. **One corpus, one moment.** n8n's node types version and change shape. A rule
   well calibrated today can drift as the platform moves, and 479 workflows from
   a limited set of sources do not represent every way people build.
7. **A clean run is not a certificate.** Most rules key on a specific core node
   type and typeVersion; a few scan every node's parameter strings. Nothing here
   covers a community node's own semantics, and nothing covers a defect outside
   the eighteen shapes above. A clean run means these eighteen rules found
   nothing.

## Development

```
npm install
npm run check       # typecheck, lint, tests
npm run build
npm run calibrate   # build, then run the gate over ./corpus
```

`npm run calibrate` exits `0` when the gate passes, `1` when a rule is over
bound, `2` on bad usage or an unreadable corpus. It prints aggregates only - rule
ids, counts, rates - and that is a hard constraint on anything added to it. Point
it at your own workflows with
`node scripts/calibrate.mjs --corpus <dir>`.

Adding a rule means adding it to the registry, giving it a `docs/rules/<id>.md`,
and clearing the gate. A rule that cannot clear the gate on real workflows does
not ship at the severity it wants.

## Licence

MIT.
