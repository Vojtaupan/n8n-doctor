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
  severity. One registry rule is declared `info`, and it carries 48% of the
  suite's output, so this blind spot sits directly underneath the largest number
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
| rules run | 18 |
| findings, total | 605 |
| - `error` | 22 |
| - `warning` | 291 |
| - `info` | 292 |
| rule crashes | 0 |
| rules over bound | 0 |
| rules that never fired | 6 |
| **gate** | **PASS** |

Per rule, sorted by rate:

| rule | severity | findings | rate | workflows | verdict |
| --- | --- | ---: | ---: | ---: | --- |
| `http-parallel-unbatched` | info | 292 | 6.618% | 144 | OK |
| `sheets-user-entered-for-data` | warning | 131 | 2.969% | 66 | OK |
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
| `switch-options-placement` | error | 0 | 0.000% | 0 | never fired |

The number to look at is the error line. **The entire rule suite produces 22
error findings across 479 production workflows** - 0.499% of scanned nodes. The
three rules that fired at error severity did so on 13, 1 and 1 workflows, so at
most 15 of the 479 workflows contain an error finding at all: **at least 96.8% of
the corpus comes back error-clean** (464 of 479). That is a volume a user can work through
rather than dismiss, which is the whole claim.

The `warning` and `info` tiers are louder on purpose, and are what the severity
flags on the CLI are for.

---

## The gate's proof of work

A gate nothing has ever failed is a decoration. This one has a case, and it is
the reason the bounds are what they are.

`http-json-body-inline-expression` used to produce **164 error findings across 95
workflows** on this corpus - 164 of the suite's 166 errors at the time, and
3.72% of nodes.
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
0.5%) and breaches the absolute cap by more than 6.5x (164 against 25). Both failures are
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
produces **48% of everything the tool reports** (292 of 605) across 144 of 479
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

**2. Six of eighteen rules have no corpus evidence at all.** 33% of the registry
never fires on 479 real workflows, and **four of the six are `error` severity**;
the other two are `warning`. Each has passing unit tests against synthetic
fixtures, so they can fire in principle. What is not established is that they
fire on real workflows, or that they would be right when they did. A rule with no
corpus evidence has not passed the bar the other twelve passed - it has only
avoided being measured. Zero-firing is deliberately not a gate failure, because a
silent rule cannot be a false-positive problem, but it is also not a pass.

**These six are what remains after the audit below**, which was run against the
whole registry's zero-firing set and established, for each one, why it is silent.
That is weaker than corpus evidence and stronger than nothing: the reason each is
silent here is now a stated, checkable claim rather than an open question. The
six are:

| rule | severity |
| --- | --- |
| `execute-workflow-input-dropped` | error |
| `execute-workflow-missing-mapping-mode` | error |
| `if-v2-missing-left-value` | error |
| `switch-options-placement` | error |
| `execute-workflow-source-not-database` | warning |
| `merge-combine-all-empty-input` | warning |

**3. The rate is a floor, not a false-positive rate.** Restating the method
point, because it is the easiest number here to over-read. A rule scoring 0.453%
did not get 99.5% of its judgements right. It accused 0.453% of all scanned
nodes. Its share of the nodes it actually inspects is higher, and unmeasured.

**4. `sheets-user-entered-for-data` fits inside its bound partly because it
under-detects.** This one is specific, it is large, and it is the most important
caveat on this page, so it is not going in a footnote.

The rule fires on a Sheets write that *sets* the cell-format option to
`USER_ENTERED`. But **from node typeVersion 4.1 onward, `USER_ENTERED` is the
platform default** - n8n's `cellFormatDefault` returns `RAW` below 4.1 and
`USER_ENTERED` at and above it. A write that sets no cell-format option at all is
therefore a `USER_ENTERED` write, and the rule does not see it.

**Basis for that version boundary:** it is read from n8n's source, not executed
against a running instance - two independent readings agreed, but unlike every
other number on this page it is inferred rather than measured. The corpus cannot
corroborate it: every Google Sheets node in it is at typeVersion 4.5 or 4.7, none
below 4.1, so any node here is trivially consistent with the boundary and cannot
discriminate it from "`USER_ENTERED` always."

In this corpus that is not an edge case. Of **172** Google Sheets write
operations (`append`, `update`, `appendOrUpdate`), **149 set no cell-format
option at all, and every one of those 149 is at typeVersion >= 4.1** (61 at 4.5,
88 at 4.7). Adding them to the 131 the rule reports gives a true corpus incidence
of about **280 nodes, 6.346%** - against a `warning` bound of 5%.

**The rule would breach its own bound if it detected its own defect properly.**
That is stated here rather than acted on, deliberately. Extending it would force
one of two things: moving the bound to fit the rule, which is precisely the
anti-pattern this gate exists to prevent, or re-deciding the rule's severity,
which is a product call and not a calibration one. Neither belongs in a
measurement pass. It is logged as the first item in
`docs/plans/v1.1-backlog.md`, with the question that has to be answered before
any code is written, where it can be decided on its merits.

Two smaller misses in the same rule, for completeness: one corpus node configures
the option through n8n's structured query-parameter form, where the option name
is a `name` field rather than a key or a string assignment; and a v2 Sheets node
that sets the inert `valueInputMode` to `RAW` while relying on the default would
be a `USER_ENTERED` write that stays silent (no corpus node does this today).

So read this rule's 2.969% as **what it catches, not what is there**. The gate
bounds noise. It has nothing to say about silence.

**5. A passing gate is not proof the findings are correct.** The gate bounds
volume. It cannot tell a correct finding from a wrong one, and a rule that is
wrong quietly - firing rarely and being wrong every time - passes it easily. What
caught `http-json-body-inline-expression` was volume plus a human reading the
flagged values. The gate narrows where that reading has to happen; it does not
replace it.

**6. One corpus, one moment.** 479 workflows from a limited set of sources, and
one snapshot in time. n8n's node types version and change shape. A rule that is
well calibrated today can drift as the platform moves, and the corpus does not
represent every way people build.

**7. `workflowsAffected` counts distinct workflow names.** Every workflow in this
corpus has a unique name, so the counts above are exact, but the figure would
undercount if two workflows shared a name. It is reported, never gated.

---

## The zero-firing audit

Run 2026-08-27, against the eight rules that produced nothing on the corpus at
the time. A rule that never fires has its fixtures as its only evidence, and a
fixture proves only that the rule matches a shape its own author wrote. So each
of the eight was put through the same three steps: read what n8n defect it
claims to catch, write a **synthetic** fixture reproducing that defect and check
the rule actually fires on it, then measure the corpus to establish *why* it is
silent - the pattern is genuinely absent, or the rule could not have caught it if
it were there.

The two explanations have opposite consequences, and the corpus separates them.
For each rule below, the deciding measurement is quoted.

| rule | severity | outcome | why |
| --- | --- | --- | --- |
| `sheets-user-entered-for-data` | warning | **fix** | Matched only `valueInputOption`, and only as a parameter key, double-quoted - a combination n8n never emits. It was blind to 131 real occurrences of the defect it describes. |
| `execute-workflow-input-dropped` | error | **fix** | Handled only the JSON-example way a sub-workflow declares its inputs. The field-list way whitelists identically, is n8n's default, and is the only one this corpus uses. |
| `parallel-ifs-should-be-switch` | info | **cut** | Required four parallel IFs on one output; the corpus maximum is one, across 3,937 outputs carrying an edge. It also counted IFs as a proxy for a harm it never checked. |
| `switch-options-placement` | error | **keep** | The defect breaks workflow *activation*, so a corpus of running workflows cannot contain it. None of its 35 Switch nodes nest `options` inside `rules`. |
| `if-v2-missing-left-value` | error | **keep** | The corpus validates the rule's version gate: 212 of 212 IF nodes at typeVersion 2.2+ carry the key; the 26 that lack it are all at 2.0, where it is not required. |
| `execute-workflow-missing-mapping-mode` | error | **keep** | n8n rejects the node at creation, so the defect never survives into an export. All 71 `workflowInputs` objects carry the key. |
| `merge-combine-all-empty-input` | warning | **keep** | The defect was hit in production, then eradicated by moving to `mode: "append"`. The corpus's 23 `append` merges and zero `combine` merges are that fix's fingerprint. |
| `execute-workflow-source-not-database` | warning | **keep** | The field is present and inspected on 48 nodes and correctly cleared on all 48; a non-database source is a deliberate, rare choice absent from this corpus. |

Three of these deserve their measurements written out, because they are the ones
where the outcome turned on the number.

### `sheets-user-entered-for-data` - the rule could not have fired

This rule looks for a Google Sheets write configured `USER_ENTERED`, which makes
Sheets re-parse every value as if it had been typed: phone numbers beginning `+`
or `-` evaluate as arithmetic, ISO timestamps coerce to Sheets dates that no
longer round-trip, leading zeros vanish.

It searched for the parameter **key** `valueInputOption`. That key appears **zero
times in 4,412 nodes**, and could not have appeared, for two independent reasons:

- The n8n Google Sheets node does not use the Google API's field name. It calls
  the option `cellFormat` or `valueInputMode`. Those carry `USER_ENTERED` on
  **20** nodes.
- Calling the Sheets API directly from an HTTP Request node *does* use
  `valueInputOption` - but inside the URL query string or a JSON body, where it
  is part of a **string value** and never a parameter key. **111** nodes carry it
  that way.

So a rule written from a real, documented data-corruption bug was structurally
incapable of reporting it, and its one fixture passed only because the fixture
had been written in the same wrong shape as the matcher. That is the failure mode
a zero-firing rule is most likely to be hiding, and it is why this audit checks
fixtures against the platform rather than against the rule.

Fixed to match all three names, as a key or as an assignment inside a string,
with either quote character - an n8n expression body is JavaScript, so the option
is single-quoted more often than not, and permitting only `"` missed the dominant
form. It now reports **131 findings across 66 workflows, 2.969%** - inside the 5%
warning bound with 1.7x of room.

The 120 findings this rule produced before the quote fix were then sampled
exhaustively against the corpus in review: **all 120 are true positives, and not
one of them stores a formula** - which is the only shape for which
`USER_ENTERED` would be the right choice. The 100 HTTP Request findings among
them are all `sheets.googleapis.com` cell writes (94 `values:append`, 5
`values/<range>` PUT, 1 `batchUpdate`). The 11 the quote fix added are 6 more
HTTP Request nodes building the same call in an expression and 5 Code nodes
assembling the batch payload. **Measured false positives: zero.**

The match requires the option name and `USER_ENTERED` **together**, and that
discrimination is measured too: **238** nodes assign one of the three option
names `RAW` - as a key or inside a string, matched symmetrically - and correctly
stay silent. (That count is nodes that pair the name with `RAW` and do not also
fire; it includes Code nodes assembling a request payload.)

**What it still misses is the more important number, and it is stated in the
limits section below.** One node configures the option through n8n's structured
query-parameter form (`queryParameters.parameters[]`, where the option name is a
`name` field rather than a key or a string assignment) and is not caught. That is
small. The large one is the platform default, and it is large enough that it
changes how this rule's rate should be read.

### `execute-workflow-input-dropped` - right defect, wrong half of it

A sub-workflow's trigger whitelists its inputs, and anything the parent maps that
the child does not declare is discarded at runtime with no error. The trigger
declares inputs two ways: a pasted JSON example, or an explicit field list. Both
whitelist identically. The field list is n8n's **default**.

The rule handled only the JSON example. In the corpus, of 98 parent-child links
that resolve to a loaded child, the child declares its inputs by **field list 14
times and by JSON example zero times** (76 are passthrough, which is a different
rule's defect, and 8 declare nothing). An `error`-severity rule was inspecting
none of the places its defect could occur.

Extended to the field-list mode, including the default case where `inputSource`
is omitted. It still reports **zero** findings: of those 14 links, 13 have a
parent mapping to compare against and all 13 are clean. That was measured before
the change and confirmed after it, so this closes a coverage hole rather than
producing evidence. It also now skips parents
on `autoMapInputData`, where the mapping is inert UI state and comparing it would
accuse a mapping n8n never applies.

### `parallel-ifs-should-be-switch` - cut

The rule fired when one output fanned out to four or more IF nodes, on the theory
that this is multi-way dispatch built by hand, and that a webhook answering with
`responseMode: "lastNode"` then returns whichever branch finished last. The
underlying trap is real and was observed in production.

It was cut anyway, on three counts:

- **The shape is not near-missing, it is absent.** Across the **3,937** node
  outputs in the corpus that carry at least one main edge (3,971 output slots
  exist; 34 are wired to nothing), the maximum number of IF nodes on any single
  output is **one**. Not one output reaches even two, against a threshold of
  four.
- **It did not check the mechanism it described.** The harm comes from the
  non-matching IFs' *false* outputs being wired onward under last-node response
  semantics. The rule inspected neither the false outputs nor the response mode,
  so it would fire on a correct four-way dispatch whose false outputs are dead
  ends - and tell that author their caller may receive the wrong branch.
- **It was the registry's only `info` rule of the eight**, the least actionable
  tier, so it carried the lowest value against that inaccuracy.

Cutting it takes the registry from 19 rules to 18. That is the point: 18 rules
each of which has either corpus evidence or a stated reason for having none is a
better number than 19 with an unexamined tail.

### What this changed in the numbers

| | before | after |
| --- | ---: | ---: |
| rules in the registry | 19 | 18 |
| rules with corpus evidence | 11 | 12 |
| rules that never fired | 8 | 6 |
| findings, total | 474 | 605 |
| - `error` | 22 | 22 |
| - `warning` | 160 | 291 |
| - `info` | 292 | 292 |
| gate | PASS | PASS |

Every one of those moves comes from the `sheets-user-entered-for-data` fix, which
added 131 warnings, and from the cut, which removed a rule contributing nothing.
**No error-severity count moved**, so the headline claim - 22 error findings
across 479 production workflows - is unchanged, and so is the margin on the rule
that sits closest to its bound.

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

`docs/calibration-2026-08-27.md` is the raw verbatim output of the run that
preceded the zero-firing audit, kept as the dated "before" snapshot. It is
**superseded**: it reports 19 rules and 474 findings. This document is the
current record.
