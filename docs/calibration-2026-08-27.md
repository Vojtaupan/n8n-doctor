# Calibration run - 2026-08-27

Produced by `npm run calibrate` (`scripts/calibrate.mjs`) over the validation
corpus of real, in-production n8n workflows.

The corpus is client work and is gitignored. **Only aggregates appear in this
file** - counts, rates and rule ids. No workflow name, node name, URL, webhook
path or credential id is recorded here or printed by the harness.

## What the gate checks

Each rule is judged against bounds set by its own severity
(`DEFAULT_THRESHOLDS` in `src/calibrate.ts`):

| severity | max rate | max absolute |
| --- | --- | --- |
| `error` | 0.5% of nodes scanned | 25 findings |
| `warning` | 5% of nodes scanned | none |
| `info` | exempt | none |

An `error` is an accusation the user is expected to act on, so it earns a bound
an order of magnitude tighter than a `warning`, plus an absolute cap because a
low percentage of a large corpus is still a large pile of noise. On this corpus
the two error bounds bite in the same region: 0.5% of 4,412 nodes is ~22
findings against a cap of 25.

**The rate denominator is the total nodes scanned in the run**, the same for
every rule. The `Rule` interface does not report how many nodes a given rule
inspected, so a per-rule denominator would be invented rather than measured.
A rule's rate therefore answers "how much of the corpus did this rule accuse",
not "how often was it wrong about the nodes it looked at".

When a rule check throws, the engine synthesizes a placeholder finding rather
than letting one malformed workflow kill the run. Those are not defects the rule
found, so they are counted as crashes and excluded from every number above. This
run had **0 crashes**. They are identified by the marker the engine writes, not
by severity: a crash is always downgraded to `info`, so for a rule already
declared `info` a severity comparison cannot see one.

A rule with zero findings is reported as `never fired`. It is not a gate
failure - a rule that never fires cannot be a false-positive problem - but it
does need a separate judgement about whether it is dead weight.

## Result

```
n8n-lint calibration
====================

files scanned:     479
workflows scanned: 479
nodes scanned:     4412
rules run:         19

findings: 474 total - 22 error, 160 warning, 292 info

thresholds: error <= 0.500% of nodes and <= 25 findings; warning <= 5.000%; info exempt
rate denominator: total nodes scanned (4412), the same for every rule

rule                                          severity  findings      rate   wfs  verdict
-----------------------------------------------------------------------------------------
http-parallel-unbatched                       info           292    6.618%   144  OK
sheets-url-literal-space                      warning         63    1.428%    39  OK
paired-item-lineage-broken                    warning         54    1.224%    32  OK
execute-workflow-passthrough-ignores-mapping  warning         33    0.748%    16  OK
http-json-body-inline-expression              error           20    0.453%    13  OK
code-first-drops-items                        warning          5    0.113%     5  OK
if-not-true-operator                          warning          3    0.068%     3  OK
expression-adjacent-close-braces              error            1    0.023%     1  OK
http-raw-body                                 warning          1    0.023%     1  OK
mutually-exclusive-fan-in                     warning          1    0.023%     1  OK
set-include-other-fields                      error            1    0.023%     1  OK
execute-workflow-input-dropped                error            0    0.000%     0  never fired
execute-workflow-missing-mapping-mode         error            0    0.000%     0  never fired
execute-workflow-source-not-database          warning          0    0.000%     0  never fired
if-v2-missing-left-value                      error            0    0.000%     0  never fired
merge-combine-all-empty-input                 warning          0    0.000%     0  never fired
parallel-ifs-should-be-switch                 info             0    0.000%     0  never fired
sheets-user-entered-for-data                  warning          0    0.000%     0  never fired
switch-options-placement                      error            0    0.000%     0  never fired

GATE: PASS - 0 rule(s) over bound, 8 rule(s) never fired```

## Reading of the run

**The gate passes.** No rule exceeds its severity's bounds. The whole suite
produces 22 errors across 479 real production workflows - roughly one error per
22 workflows, which is a rate a user can act on rather than dismiss.

This gate was written to catch a specific failure: `http-json-body-inline-expression`
producing 164 error findings, 3.72% of nodes, which cleared the old flat 5%
threshold. That rule was narrowed in commit `7eceb5f` (2026-08-21) before this
harness existed, taking the suite from 166 errors to 22. The gate now formalises
the bound that would have caught it: at 3.72% against a 0.5% error bound it
fails by more than sevenfold, and it also breaches the absolute cap at 164
against 25.

Three things the run says that the pass/fail line does not:

1. **`http-json-body-inline-expression` has almost no margin.** At 20 findings
   and 0.453% it sits about two findings below the rate bound (0.5% of 4,412 is
   ~22). Any corpus growth or any widening of that rule pushes it over. It is
   the rule to watch.

2. **Eight of nineteen rules never fired** - 42% of the registry has no
   evidence behind it from this corpus. Five of those are `error` severity.
   Zero-firing is deliberately not a gate failure, but each one needs a
   verdict: genuinely rare defect, or a rule that cannot fire as written.

3. **`http-parallel-unbatched` carries 62% of all findings** (292 of 474) and
   fires on 144 of 479 workflows at 6.618% of nodes. It passes only because
   `info` is exempt from the rate bound. If it were ever promoted to `warning`
   it would fail immediately, and at `error` it would fail by an order of
   magnitude. Its severity is load-bearing, not incidental.

## Reproducing

```
npm run calibrate                          # builds, then scans ./corpus
node scripts/calibrate.mjs --corpus <dir>  # scan a different corpus
```

Exit code 0 when the gate passes, 1 when it fails, 2 on bad usage or an
unreadable corpus - so it can be a CI step.
