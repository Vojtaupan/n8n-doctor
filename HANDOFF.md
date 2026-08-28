# Handoff - n8n-lint v0.1.0

Status: build complete on `build/v1`, up to and including the release surface
(scrub gate, CI config, verified tarball). **Nothing has been pushed. Nothing
has been published.** Everything below "Vojtech's remaining steps" needs his
2FA or his judgment call and was deliberately left undone.

## What is actually true right now

- **Tests: 108 passing**, across 23 test files (`npm run test`, run via
  `npm run check`). `npm run check` (typecheck + lint + test) is green.
- **Calibration: GATE PASS.** 18 rules, run over the full local corpus (479
  workflows, 4,412 nodes): 605 findings total - 22 `error`, 291 `warning`, 292
  `info`. 6 rules never fired (audited and accounted for in
  `docs/calibration.md`, not a gate failure). Thresholds: `error` <= 0.5% of
  nodes and <= 25 absolute, `warning` <= 5%, `info` <= 13.24%. 0 rules over
  bound. These are the exact numbers in `docs/calibration.md`'s "current
  record" table - this run reproduced it, it did not change it.
- **Scrub gate: written, wired, and proven to fail.** `scripts/scrub-check.sh`
  (`npm run scrub`) greps the tracked tree via `git grep` for: an Anthropic key
  shape (`sk-ant-...`), PEM private-key headers, the private vault name, the
  business name, and any real path *into* `corpus/` (a bare mention of the
  directory, as in `.gitignore` or the docs describing the constraint, is not
  flagged; an actual filename is). It also independently checks that no file
  under `corpus/` is ever tracked by git. A gitignored
  `scripts/scrub-patterns.local`, read only if present, is the place for
  anything more private/client-specific than that list - none exists yet.

  **Proven to fail, not just written.** A file containing a string shaped
  like an Anthropic key (`sk-ant-` followed by a fake suffix - not reproduced
  verbatim in this paragraph, on purpose: committing that literal shape into
  a permanent, tracked document would trip this exact gate forever, which is
  the same self-inflicted-failure trap the README's em-dash code block avoids
  by a different route; see this task's report for the literal string) was
  created, `git add`-ed, and the gate was run against it. Observed output
  (the planted value is elided below for the same reason):

  ```
  scrub-check: FAIL - forbidden pattern 'sk-ant-[A-Za-z0-9_-]+' found:
      scrub-plant-test.ts:1:const leaked = '[elided - see task report]';
  scrub-check: refusing to publish
  ```
  (exit code 1). The file was then removed and unstaged; `npm run scrub`
  returned `scrub-check: clean` (exit 0) immediately after, and
  `git status --porcelain` showed the planted file gone with no trace.

  One deliberate scope decision: em dashes are **not** scrubbed for. The
  README's sample CLI-output block legitimately contains them - the reporter
  itself emits `${f.nodeName} — ` as its finding separator
  (`src/report/text.ts:56`) - so any em-dash grep would have to exclude fenced
  code blocks or it would flag that block forever. Rather than build fence-
  aware parsing into a shell script for a purely stylistic check, this gate
  does not scan for em dashes at all. Prose style (plain hyphens) is enforced
  by author discipline, not this gate. Flagging this explicitly per the brief:
  it is not silently unchecked, it is a considered omission.

- **CI: written, matrix-complete, has never run.** `.github/workflows/ci.yml`
  runs `npm ci` + `npm run check` on the 3x3 matrix (ubuntu / windows / macos
  x Node 20 / 22 / 24), plus a separate `scrub` job on ubuntu
  (`fetch-depth: 0`) running `npm run scrub`. **The calibration job
  deliberately does not exist in this workflow** - `corpus/` is 479 real,
  gitignored client workflows that will never exist on a GitHub Actions
  runner, and the workflow file says so in a comment so nobody "fixes" its
  absence later. **This has never executed on GitHub Actions, because nothing
  has been pushed and no repo exists yet. Do not read the matrix as passing -
  it has not run once.**

- **Platforms verified locally vs. only configured in CI.** Only ONE of the 9
  CI matrix cells was actually exercised, on this machine:
  Windows (MINGW64/Git Bash) with Node v24.14.0, npm 11.9.0. `npm run check`,
  `npm run calibrate`, and `npm run scrub` all ran and passed there. Ubuntu,
  macOS, Windows-in-CI, and Node 20/22 are **configured, not verified** - they
  exist only as matrix entries in `ci.yml` and have not executed anywhere.

- **Tarball: built and verified.**
  ```
  npm run build && npm pack && tar -tzf n8n-lint-0.1.0.tgz
  ```
  produced exactly: `dist/*` (cli.js, index.js, calibrate.js, chunks, .d.ts
  files), `docs/rules/*.md` (all 18), `docs/calibration.md`, `README.md`,
  `LICENSE`, `CHANGELOG.md`, `package.json`. 32 files, 58.8 kB packed / 187.8
  kB unpacked. **Not present:** `corpus/`, `test/`, `src/`, `scripts/`,
  `.github/`, `docs/calibration-2026-08-27.md` (the superseded snapshot),
  `docs/plans/`, `docs/specs/`. Installed into a clean scratch directory
  (`npm install <tarball path>`), `npx n8n-lint --help` printed usage, and
  `npx n8n-lint test/fixtures/set-include-other-fields.bad.json` (a synthetic
  fixture with a known defect) reported the expected `error` finding and
  exited 1. The tarball and the scratch install directory were deleted
  afterward; none of that is part of this commit.

  `package.json`'s `files` array was changed from
  `["dist", "docs/rules", "README.md", "LICENSE"]` to
  `["dist", "docs/rules", "docs/calibration.md", "README.md", "LICENSE", "CHANGELOG.md"]`.
  The README links `docs/calibration.md` four times as the actual evidence for
  the tool's central claim; without shipping the file, that evidence would not
  exist inside the published package at all.

  **No `repository` field was added to `package.json`.** Without it, npm's
  package page cannot rewrite the README's relative links
  (`docs/calibration.md`, etc.) into working URLs, so on npmjs.com that link
  will 404 even though the file is now shipped. This was deliberate: no GitHub
  repo exists yet and nothing has been pushed, so any URL I put in `repository`
  would be a guess I could not verify, and the brief was explicit that a
  guessed URL is worse than a missing one. Shipping the file (verifiable now)
  was chosen over guessing the URL (not verifiable now). Once the repo exists
  and this branch is pushed, add
  `"repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" }`
  with the real URL - that one edit fixes the npm-page link. Until then,
  anyone who installs the package still gets the file locally at
  `node_modules/n8n-lint/docs/calibration.md`; only the *rendered npm.js page*
  link is affected.

- **Four README wording fixes from the Task 4 review, applied:**
  1. Line crediting the calibration gate with cutting a rule now correctly
     attributes the cut to the zero-firing audit, not the gate's bounds.
  2. "none of them has meaningful adoption" (an unfalsifiable universal) ->
     "none appears to have meaningful adoption."
  3. The bolded pull-quote "**Measured false positives: zero.**" is no longer
     bolded and no longer stands alone as something that reads well lifted out
     of context ("Measured false positives in that sample: zero.").
  4. (See tarball/`files` note above - this is the `package.json` fix.)

- **`git remote -v` is empty.** Confirmed at the end of this task. Nothing has
  ever been pushed from this repo.

- **No new runtime dependencies were added.** `dependencies` in `package.json`
  is unchanged (`fast-glob`, `picocolors`). The scrub script is `bash` +
  `git grep`; CI uses only `actions/checkout` and `actions/setup-node`.

## What is NOT true, so nobody assumes it by accident

- CI has **never run**. Not once, on any commit, on any platform. It cannot
  have - there is no remote and no GitHub repo.
- `npm publish` has **not been run**. The only artifact that ever existed,
  `n8n-lint-0.1.0.tgz`, was built, inspected, and deleted as part of this
  verification. Nothing has been uploaded to the npm registry.
- The package is not installable from anywhere but a local tarball right now.

## Vojtech's remaining steps (need his 2FA / his call, in order)

1. Create the GitHub repo (public, MIT - matches `LICENSE`).
2. `git remote add origin <url>` and push `build/v1` (then decide whether it
   merges to a `main`/`master` default branch or the repo is created with
   `build/v1` as the default - your call).
3. Watch the Actions tab. This is the **first time** `ci.yml` will ever
   execute - expect to actually look at all 9 `check` matrix runs plus the
   `scrub` job, not just glance at a green checkmark. If anything in the
   Windows or macOS legs fails while ubuntu passes, that is real information
   this task could not obtain (only ubuntu/Windows-local, one Node version,
   was exercised here).
4. Once the repo exists, add the `repository` field to `package.json` (see
   above) so the npm page's `docs/calibration.md` links resolve. Small PR,
   easy to forget.
5. `npm login` (or confirm the existing login) and `npm publish` when ready -
   this needs npm's 2FA/OTP, which is his account.
6. The LinkedIn post. Also his.
7. Optional, not blocking: decide whether `docs/calibration-2026-08-27.md`
   (the superseded dated snapshot) should be deleted from the repo now that
   `docs/calibration.md` supersedes it, or kept as a dated historical record.
   It is tracked but not shipped in the package either way.

## Files touched by this task

- `scripts/scrub-check.sh` (new)
- `.github/workflows/ci.yml` (new)
- `package.json` (`files` array + `scrub` script added)
- `README.md` (the four wording fixes above)
- `HANDOFF.md` (this file, new)

This file is committed, not gitignored - it is the release record for this
task, not scratch output.
