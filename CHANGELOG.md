# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 0.1.0

First release. A CLI that reads exported n8n workflow JSON and reports
production-readiness defects that schema validators cannot see.

### Added

- **CLI** - `n8n-doctor <path...>`, taking files, directories, globs, or `-` for
  stdin, and reading all three n8n export shapes (UI download, public-API
  response, `n8n export:workflow` array). Flags: `--severity`, `--rule`,
  `--json`, `--quiet`, `--no-color`, `--help`. Static analysis only: no
  execution, no network, no model calls, deterministic output.
- **Exit codes** - `0` clean or findings below `error`, `1` at least one
  `error`-severity finding, `2` bad usage or no readable workflow in the given
  paths. `2` is distinct from `0` so a glob that matches nothing fails rather
  than passing forever while linting nothing.
- **18 rules** - 7 `error`, 10 `warning`, 1 `info`, each with a page in
  `docs/rules/` giving its exact signature, the cost of the defect, and the fix.
  Two are cross-workflow: they resolve an Execute Workflow node's child by id
  against the other workflows in the same run. Every finding carries a
  suggestion.
- **Reporters** - a grouped human-readable report, and `--json` emitting the
  findings verbatim plus a per-severity summary. Every JSON finding carries
  `crashed`: `false` for anything a rule genuinely reported, `true` only on the
  placeholder the engine synthesizes when a rule throws, so one malformed
  workflow cannot kill a run over hundreds.
- **Calibration gate** - `npm run calibrate` runs every rule over a directory of
  real workflows and fails when any rule exceeds the bounds set by its own
  severity: `error` 0.5% of nodes scanned with an absolute cap of 25 findings,
  `warning` 5%, `info` 13.24%. `error` is bounded an order of magnitude tighter
  than `warning` because a wrong error costs the user real work and their trust
  in the first line of output. The harness prints aggregates only. Exit `0`
  pass, `1` a rule over bound, `2` bad usage or unreadable corpus.
- **Calibration evidence** - `docs/calibration.md` records the measurement the
  gate is derived from: 479 real production workflows, 4,412 nodes, 605 findings
  (22 `error`, 291 `warning`, 292 `info`), 0 rule crashes, gate PASS. The 22
  error findings land in at most 15 workflows, so at least 96.8% of the corpus
  comes back error-clean (464 of 479). The document includes the limits, in
  detail, and states which numbers are measured and which are inferred.
- **108 tests** across the loader, graph, engine, reporters, CLI, calibration
  logic, and the rules.

### Changed

- `http-json-body-inline-expression` narrowed from **164 error findings across 95
  workflows** to **20**, after the flagged values turned out to be almost all
  working code. It had assumed any value starting with `=` was a single
  expression, when such a value is an expression template and interpolating into
  a JSON string is the idiomatic working shape; and it was flagging holes already
  wrapped in `JSON.stringify()`, which is exactly what its own suggestion
  recommends. Both failure modes are now pinned by unit tests, so the gate cannot
  regress to permitting them.
- `http-parallel-unbatched` narrowed from the naive "HTTP v4 without batching"
  shape, which hit 1,094 nodes, to requiring a demonstrably multi-item ancestor.
  It stays at `info`: its severity is load-bearing, not incidental, and it would
  fail the `warning` bound.

### Fixed

- `sheets-user-entered-for-data` matched only `valueInputOption`, and only as a
  double-quoted parameter key - a combination n8n never emits - and its own
  fixture had been written in the same wrong shape as the matcher, so the test
  passed green while the rule could not fire on anything real. Found by the
  zero-firing audit. Now matches all three option names, as a key or as an
  assignment inside a string, with either quote character, and reports 131
  findings across 66 workflows. The 120 it produced before the final quote fix
  were checked exhaustively against the corpus: all 120 are true positives,
  measured false positives zero.
- `execute-workflow-input-dropped` handled only the JSON-example way a
  sub-workflow declares its inputs, not the field-list way, which is n8n's
  default and the only one the corpus uses. Extended to both. It still reports
  zero, so this closes a coverage hole rather than producing evidence.

### Removed

- `parallel-ifs-should-be-switch` cut, taking the registry from 19 rules to 18.
  It required four parallel IF nodes on one output where the corpus maximum is
  one, and it counted IF nodes as a proxy for a harm it never actually checked,
  so it would have accused a correct dispatch of a bug it had not looked for.

### Known limits

- `sheets-user-entered-for-data` is blind to the most common form of its own
  defect: a Sheets write that sets no cell-format option at all inherits
  `USER_ENTERED` from the platform default at node typeVersion 4.1 and above.
  (That version boundary is read from n8n's source rather than executed, so it is
  inferred rather than measured; the basis is noted in `docs/calibration.md`.)
  True corpus incidence is about 280 nodes (6.346%) against the 131 (2.969%)
  reported, and at 6.346% the rule would breach its own 5% `warning` bound if it
  detected properly. Disclosed rather than fixed, because closing it would force
  either moving a bound to fit a rule or re-deciding the rule's severity, and
  neither belongs in a measurement pass. Tracked as item 1 in
  `docs/plans/v1.1-backlog.md`.
- Six of the eighteen rules produce nothing on the validation corpus, four of
  them at `error` severity. Each fires against a synthetic fixture and each has a
  stated, checkable reason for being silent on real workflows, established by the
  zero-firing audit. That is weaker than corpus evidence.
- The validation corpus is private production work. It is gitignored and not
  published, so the calibration figures are reported rather than reproducible.
  The harness runs against any directory of workflow JSON.

### Non-goals

- **Schema and config validation.** n8n-mcp's `validate_workflow` already covers
  it; duplicating it would ship a worse copy of something already in the box.
  This tool assumes a well-formed workflow and asks whether it is correct.
