# Calibration

n8n-lint's claim is not that it finds more than the other n8n linters. It is that
what it reports is worth reading: run it on a directory of real, working,
in-production workflows and it does not bury you in false positives. This
document is the evidence for that claim, and the record of the gate that keeps it
true as rules are added.

It is deliberately written to be checkable. Where a number is soft, it says so.
The limits section at the end is the part to read first if you are sceptical.

---

## Method

### The corpus

The validation corpus is **479 real n8n workflows, 4,412 nodes**, exported from
production instances. It is not a fixture set and not synthetic: these are
workflows that were built to do a job and are doing it. That is the point. A
linter calibrated against workflows written to trip it will always look good.

Every rule in the registry is run over every workflow in one pass, through the
same pipeline the CLI uses (`parseWorkflowFileContents` -> `buildGraph` ->
`buildContext` -> `runRules`), with the whole corpus in a single `Context` so
cross-workflow rules resolve their lookups the way they would in a real run.
The harness is `scripts/calibrate.mjs`; the logic it is judged by is
`src/calibrate.ts`, which is unit-tested.

### The rate denominator

A rule's **rate is its finding count divided by the total number of nodes scanned
in the run** - 4,412 - and that denominator is **identical for every rule**.

This matters enough to be precise about, because the obvious reading is wrong.
The rate is *not* a false-positive rate, and it is *not* "the share of the nodes
this rule inspected". The `Rule` interface does not report how many nodes a given
rule looked at, so a per-rule denominator would be invented rather than measured,
and we would rather publish a number that is smaller than the truth than one that
is made up.

So a rate answers exactly one question: **how much of the corpus did this rule
accuse?** For a rule that only ever inspects one node type, its share of the
nodes it actually looks at is several times its rate here. Read the rate as a
floor.

The worked example, which is also the case the gate was built for: 164 findings
over 4,412 nodes is 3.72%.

### What counts as a finding

When a rule's `check` throws, the engine synthesizes a placeholder entry rather
than letting one malformed workflow kill the run. Those are not defects a rule
found, so they are counted separately as **crashes** and excluded from every
finding count in this document.

A crash is identified by a structural flag the engine stamps on every finding it
emits (`crashed: true` on the synthesized entry, `false` on everything a rule
genuinely reported), not by severity and not by matching its message. Both of
those looked sufficient and were not:

- **Severity cannot tell.** A crash is always downgraded to `info`, so for a rule
  already *declared* `info` a crash and a genuine finding carry the same
  severity. Two registry rules are `info`, and one of them carries 62% of the
  suite's output, so this blind spot sat directly underneath the largest number
  here.
- **A message marker cannot guarantee.** Keying off the text the engine writes
  works until a rule author's own message happens to start with it, at which
  point every finding that rule produces is silently reclassified as a crash and
  nothing catches it. The marker is kept only as a fallback for a `Finding`
  deserialized from a report that predates the structural flag.

This run had **0 crashes**, and that zero is now measured rather than assumed.

---

## The gate

Each rule is judged against bounds set by its own severity. The bounds live in
`DEFAULT_THRESHOLDS` in `src/calibrate.ts` and are the single place they are
defined.

| severity | max rate | max absolute |
| --- | --- | --- |
| `error` | 0.5% of nodes scanned | 25 findings |
| `warning` | 5% of nodes scanned | none |
| `info` | 13.24% of nodes scanned | none |

**Why `error` is an order of magnitude tighter than `warning`.** An error is an
accusation the user is expected to act on: stop the build, open the workflow,
change something. Getting one wrong costs more than a wrong warning, because the
user spends real time discovering there was nothing to fix, and the second time
that happens they stop believing the first line of output. A warning invites a
look. An error demands work. The bound follows the cost.

**Why there is an absolute cap as well as a rate.** A low percentage of a large
corpus is still a large pile. 3.72% sounds tolerable; 164 wrong errors on first
install is how a linter gets uninstalled before its second run. The cap makes the
bound bite on the number the user actually sees. On this corpus the two error
bounds land in the same region by design - 0.5% of 4,412 is about 22 findings
against a cap of 25 - and a unit test asserts they stay in the same region, so a
corpus change that pulls them apart is caught rather than discovered.

**Why `info` is looser but no longer exempt.** An advisory asks the user to look,
not to act, so it earns more room. It does not earn unlimited room: a rule firing
on a large share of every workflow buries the errors that matter regardless of
what severity it carries. The `info` bound is derived from the corpus rather than
chosen for roundness. The loudest legitimate advisory rule measured here
(`http-parallel-unbatched`) fires on 6.618% of scanned nodes and is right to, so
the bound is set at **twice that**: 13.24%. The known-good rule keeps a 2x
margin, and a runaway rule accusing 40% of nodes - two in every five - fails.
Tying it to a measurement means that if the corpus changes and 6.618% moves, the
derivation moves with it and the bound gets revisited, where a round 20% would
just quietly accumulate slack.

`info` gets no absolute cap, for the reason `error` has one: 25 wrong accusations
is 25 wrong accusations whatever the corpus size, but an advisory count scales
with how much you scanned and costs a glance. Capping it would fail the gate for
scanning more workflows.

**A rule that fires zero times does not fail the gate.** It is reported as
`never fired`, because a rule that never fires cannot be a false-positive
problem. Whether it is a rare defect or a rule that cannot fire as written is a
different question, answered separately - see the limits below.

The gate is a CI step. Exit code 0 when it passes, 1 when a rule is over bound,
2 on bad usage or an unreadable corpus.

---

## Results

Measured on 2026-08-27, over the full corpus, with the thresholds above.

| metric | value |
| --- | --- |
| files scanned | 479 |
| files unreadable / skipped | 0 |
| workflows scanned | 479 |
| nodes scanned | 4,412 |
| rules run | 19 |
| findings, total | 474 |
| - `error` | 22 |
| - `warning` | 160 |
| - `info` | 292 |
| rule crashes | 0 |
| rules over bound | 0 |
| rules that never fired | 8 |
| **gate** | **PASS** |

Per rule, sorted by rate:

| rule | severity | findings | rate | workflows | verdict |
| --- | --- | ---: | ---: | ---: | --- |
| `http-parallel-unbatched` | info | 292 | 6.618% | 144 | OK |
| `sheets-url-literal-space` | warning | 63 | 1.428% | 39 | OK |
| `paired-item-lineage-broken` | warning | 54 | 1.224% | 32 | OK |
| `execute-workflow-passthrough-ignores-mapping` | warning | 33 | 0.748% | 16 | OK |
| `http-json-body-inline-expression` | error | 20 | 0.453% | 13 | OK |
| `code-first-drops-items` | warning | 5 | 0.113% | 5 | OK |
| `if-not-true-operator` | warning | 3 | 0.068% | 3 | OK |
| `expression-adjacent-close-braces` | error | 1 | 0.023% | 1 | OK |
| `http-raw-body` | warning | 1 | 0.023% | 1 | OK |
| `mutually-exclusive-fan-in` | warning | 1 | 0.023% | 1 | OK |
| `set-include-other-fields` | error | 1 | 0.023% | 1 | OK |
| `execute-workflow-input-dropped` | error | 0 | 0.000% | 0 | never fired |
| `execute-workflow-missing-mapping-mode` | error | 0 | 0.000% | 0 | never fired |
| `execute-workflow-source-not-database` | warning | 0 | 0.000% | 0 | never fired |
| `if-v2-missing-left-value` | error | 0 | 0.000% | 0 | never fired |
| `merge-combine-all-empty-input` | warning | 0 | 0.000% | 0 | never fired |
| `parallel-ifs-should-be-switch` | info | 0 | 0.000% | 0 | never fired |
| `sheets-user-entered-for-data` | warning | 0 | 0.000% | 0 | never fired |
| `switch-options-placement` | error | 0 | 0.000% | 0 | never fired |

The number to look at is the error line. **The entire rule suite produces 22
error findings across 479 production workflows** - 0.499% of scanned nodes. The
three rules that fired at error severity did so on 13, 1 and 1 workflows, so at
most 15 of the 479 workflows contain an error finding at all: **at least 96.9% of
the corpus comes back error-clean.** That is a volume a user can work through
rather than dismiss, which is the whole claim.

The `warning` and `info` tiers are louder on purpose, and are what the severity
flags on the CLI are for.

---

## The gate's proof of work

A gate nothing has ever failed is a decoration. This one has a case, and it is
the reason the bounds are what they are.

`http-json-body-inline-expression` used to produce **164 error findings across 95
workflows** on this corpus - 166 of the suite's 166 errors, and 3.72% of nodes.
Pulling the flagged values showed they were almost all correct, working code. The
rule had two wrong premises. It assumed a value starting with `=` must be a
single expression, so any literal `{` before the first `{{` was a defect, when in
fact such a value is an expression *template* and interpolating inside a JSON
string is the idiomatic working shape. And after that was narrowed, 85 of the
remaining 88 findings were holes already wrapped in `JSON.stringify()` - which is
precisely the fix the rule's own suggestion recommends. It was reporting the
remedy as the disease.

Narrowing it took the suite from **166 errors to 22**, and that rule from **164
findings to 20**, over 13 workflows, spot-checked as genuine defects that break as
soon as the expression resolves to a string.

The relevant part is not that a rule was wrong. It is that **164 mostly-benign
errors cleared the old flat 5%-of-nodes threshold at 3.72%.** The threshold said
this was fine. That is what the current bounds are calibrated against: the same
behaviour now fails the `error` rate bound by more than sevenfold (3.72% against
0.5%) and breaches the absolute cap by 6.5x (164 against 25). Both failures are
encoded as unit tests, so the gate cannot regress back to permitting it.

---

## Known-tight rules

Rules with little margin, named here so that a future red gate is expected rather
than mysterious.

### `http-json-body-inline-expression` - error, 20 findings, 0.453%

This is the rule from the section above, and it sits closest to its bound. At
today's corpus size it passes at up to 22 findings and fails on the 23rd
(0.5% of 4,412 is 22.06). Roughly two findings of headroom.

**Decision: the headroom is accepted. Neither the rule nor the bound is being
changed.** The tightness is the gate doing its job, not a defect to engineer
away. This is the exact rule the bound was calibrated against; moving the bound
to give it comfort would undo the discipline that produced the number, and
widening the rule is what the discipline exists to prevent. The cost of being
wrong here is a red CI run on a maintainer's machine, which is cheap and loud.
The cost of a loose bound is a user's first impression, which is neither.

Two things about how it would actually go red, because the naive reading
overstates the risk:

- **Corpus growth does not automatically flip it.** The denominator grows too.
  Adding *N* nodes containing *k* new findings only breaches the bound when
  `k > 2.06 + 0.005N` - that is, when the incoming workflows carry this defect at
  a *higher* density than the corpus already has. Re-pulling more of the same
  kind of work will not do it. A small batch of unusually bad workflows will.
- **Past about 5,000 nodes the binding bound swaps.** 0.5% of 5,000 is 25, which
  is exactly the absolute cap; beyond that the cap binds first and the rule fails
  at 26 findings regardless of corpus size. The corpus is 588 nodes away from
  that crossover. If it is crossed, the cap - not the rate - is the number to
  reason about.

### `http-parallel-unbatched` - info, 292 findings, 6.618%

Not tight, but load-bearing, and worth naming for the opposite reason. It
produces **62% of everything the tool reports** (292 of 474) across 144 of 479
workflows. It passes comfortably at `info`, where it has a 2x margin under the
13.24% bound by construction. It would fail immediately at `warning` (6.618%
against 5%) and by an order of magnitude at `error`. **Its severity is
load-bearing, not incidental.** If promoting it is ever proposed, the gate is the
reason not to.

---

## Limits

The honest weaknesses of everything above.

**1. These numbers are reported, not reproducible by you.** The corpus is real
client work. It is gitignored, it is not in the package, and it will not be
published. Nothing in this document, in the harness's output, or in any committed
test contains a workflow name, node name, URL, webhook path or credential id -
that is enforced deliberately and verified, not assumed. The consequence is that
you cannot re-run this exact measurement. You can run the harness against your
own directory of workflows (`node scripts/calibrate.mjs --corpus <dir>`) and get
the same table for your own material, which is the check that actually matters to
you, but the 479/4,412 figures here you have to take on the record of them.

**2. Eight of nineteen rules have no corpus evidence at all.** 42% of the
registry never fired once on 479 real workflows, and **five of the eight are
`error` severity**. Each has passing unit tests against synthetic fixtures, so
they can fire in principle. What is not established is that they fire on real
workflows, or that they would be right when they did. A rule with no corpus
evidence has not passed the bar the other eleven passed - it has only avoided
being measured. Zero-firing is deliberately not a gate failure, because a silent
rule cannot be a false-positive problem, but it is also not a pass.

**An audit of those eight is planned and has not been run yet.** Until it has,
treat the calibration record as covering eleven rules, not nineteen. The eight
are:

| rule | severity |
| --- | --- |
| `execute-workflow-input-dropped` | error |
| `execute-workflow-missing-mapping-mode` | error |
| `if-v2-missing-left-value` | error |
| `switch-options-placement` | error |
| `execute-workflow-source-not-database` | warning |
| `merge-combine-all-empty-input` | warning |
| `sheets-user-entered-for-data` | warning |
| `parallel-ifs-should-be-switch` | info |

**3. The rate is a floor, not a false-positive rate.** Restating the method
point, because it is the easiest number here to over-read. A rule scoring 0.453%
did not get 99.5% of its judgements right. It accused 0.453% of all scanned
nodes. Its share of the nodes it actually inspects is higher, and unmeasured.

**4. A passing gate is not proof the findings are correct.** The gate bounds
volume. It cannot tell a correct finding from a wrong one, and a rule that is
wrong quietly - firing rarely and being wrong every time - passes it easily. What
caught `http-json-body-inline-expression` was volume plus a human reading the
flagged values. The gate narrows where that reading has to happen; it does not
replace it.

**5. One corpus, one moment.** 479 workflows from a limited set of sources, and
one snapshot in time. n8n's node types version and change shape. A rule that is
well calibrated today can drift as the platform moves, and the corpus does not
represent every way people build.

**6. `workflowsAffected` counts distinct workflow names.** Every workflow in this
corpus has a unique name, so the counts above are exact, but the figure would
undercount if two workflows shared a name. It is reported, never gated.

---

## Reproducing

```
npm run calibrate                          # builds, then scans ./corpus
node scripts/calibrate.mjs --corpus <dir>  # scan any directory of workflow JSON
```

Exit code 0 when the gate passes, 1 when a rule is over bound, 2 on bad usage or
an unreadable corpus.

The harness prints aggregates only - rule ids, counts, rates, percentages - and
nothing else. That is a hard constraint on anything added to it.

`docs/calibration-2026-08-27.md` is the raw verbatim output of the run recorded
here, kept as a dated snapshot. Its threshold table predates the `info` bound;
this document is the current record.
