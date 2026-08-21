# n8n-audit — unattended overnight build runner.
#
# Executes docs/plans/2026-08-20-n8n-audit-v1.md ONE TASK PER ITERATION on branch build/v1.
# Each iteration is a fresh claude context; the plan file's checkboxes are the durable state,
# so the loop is resumable and a crashed iteration costs one task, not the night.
#
# Stops on: plan complete | deadline | max iterations | 3 consecutive failures.
# Never publishes, never pushes, never touches master.

$ErrorActionPreference = 'Continue'

$repo    = 'C:\Users\Lenovo\Documents\n8n-audit'
$plan    = 'docs/plans/2026-08-20-n8n-audit-v1.md'
$branch  = 'build/v1'
$log     = Join-Path $repo 'build-run.log'
$status  = Join-Path $repo 'build-status.txt'
$maxIter = 60
$deadline = (Get-Date).Date.AddDays(1).AddHours(8)   # hard stop 08:00 tomorrow

function Write-Log($m) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $m"
  Add-Content -Path $log -Value $line
}

Set-Location $repo

# --- Single-instance lock -------------------------------------------------
# Two runners on one branch would interleave commits. Refuse to start if a
# live one already holds the lock; take it over if the lock is stale.
$lockFile = Join-Path $repo '.build-runner.lock'
if (Test-Path $lockFile) {
  $held = Get-Content $lockFile -ErrorAction SilentlyContinue
  if ($held -and (Get-Process -Id $held -ErrorAction SilentlyContinue)) {
    Write-Log "ABORT: runner already active (pid $held)"
    exit 0
  }
}
Set-Content -Path $lockFile -Value $PID -Encoding utf8

# --- Keep the machine awake for this run only -----------------------------
# This box sleeps after 60 min on AC and uses S0 modern standby, which would
# suspend the build. ES_SYSTEM_REQUIRED holds it off; the assertion dies with
# this process, so no persistent power-plan change is left behind.
# Display sleep is deliberately NOT blocked - the screen may switch off.
Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
# NB: Windows PowerShell 5.1 parses 0x80000000 as a SIGNED Int32 (-2147483648), which
# cannot cast to uint32. Use the decimal literal, and cast the -bor result explicitly
# because the bitwise OR of two uint32 promotes to Int64.
$ES_CONTINUOUS      = [uint32]2147483648   # 0x80000000
$ES_SYSTEM_REQUIRED = [uint32]1            # 0x00000001
$awake = [Win32.Power]::SetThreadExecutionState([uint32]($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED))
if ($awake -eq 0) { Write-Log 'WARNING: keep-awake NOT armed - machine may sleep mid-build' }
else { Write-Log 'keep-awake armed (system stays up, display may sleep)' }

Write-Log "=== n8n-audit overnight build start ==="
Write-Log "deadline=$deadline maxIter=$maxIter"

# Resolve the claude CLI (prefer .cmd/.exe over the .ps1 shim under a non-interactive host).
$claude = $null
foreach ($p in @("$env:APPDATA\npm\claude.cmd", "$env:LOCALAPPDATA\Programs\claude\claude.exe")) {
  if (Test-Path $p) { $claude = $p; break }
}
if (-not $claude) { $claude = (Get-Command claude -ErrorAction SilentlyContinue).Source }
if (-not $claude) {
  Write-Log 'STATUS=FAILED (claude CLI not found)'
  Set-Content -Path $status -Value 'FAILED: claude CLI not found' -Encoding utf8
  exit 0
}
Write-Log "claude=$claude"

# Park on the build branch. Created off master if absent; reused on a resume.
& git rev-parse --verify $branch *> $null
if ($LASTEXITCODE -eq 0) { & git checkout $branch *>> $log }
else { & git checkout -b $branch *>> $log }
if ($LASTEXITCODE -ne 0) {
  Write-Log "STATUS=FAILED (could not checkout $branch)"
  Set-Content -Path $status -Value "FAILED: checkout $branch" -Encoding utf8
  exit 0
}

# NB: the prompt is passed on STDIN, never as an argv parameter. $claude resolves to
# claude.cmd, a batch shim, and cmd.exe truncates a multi-line argument at the first
# newline - the worker then received only the opening line, had no task, saw the
# controller's lock and stood down as an "intruder". Three of those tripped the valve.
# The here-string is single-quoted so backticks in the text stay literal rather than
# acting as PowerShell escapes; placeholders are substituted explicitly.
$promptTemplate = @'
You are running UNATTENDED (headless, no human present) in the n8n-audit repository, on branch __BRANCH__.

YOU ARE THE BUILD. The runner process that spawned you holds .build-runner.lock (containing ITS own
pid) and has written build-status.txt = "RUNNING iteration N". That is YOUR CONTROLLER, not a
competing agent session. Those files exist solely to stop a SECOND RUNNER from starting; they are
never a signal for you to stand down. The claude and node processes started moments ago are YOU.
Proceed and do the work. Stand down ONLY if you find uncommitted changes in src/ or test/ that you
did not make yourself.

Read the implementation plan at __PLAN__ and the spec it references at
docs/specs/2026-08-20-n8n-audit-design.md.

SCOPE LIMIT FOR THIS RUN: Tasks 1 through 23 (Phases 1-4) are in scope.
Phase 5 (Tasks 24-29, the universal production-readiness rules) is OUT OF SCOPE and must not be
started - those rules duplicate an existing npm package and are pending a positioning decision.
If every step of Tasks 1-23 is already ticked, print "PHASES 1-4 COMPLETE" and exit immediately.

Find the FIRST task in Tasks 1-23 whose step checkboxes are not all ticked. Implement ONLY that one task:
  - Follow its steps in order. It is a TDD plan: write the failing test first, watch it fail, then implement.
  - Honour the Global Constraints section. It applies to every task.
  - Rule tasks (6-23) follow the "Rule Task Protocol" section verbatim, including BOTH fixtures.
  - Run "npm run check" before committing. If it fails, fix it. Do not commit failing code.
  - Commit with the conventional-commit message the task specifies, staging EXPLICIT paths only.
    Never "git add ." and never "git add -A".
  - Then tick that task's checkboxes in __PLAN__ and commit the plan file.
  - Then STOP. Do not start the next task.

Hard rules:
  - Never read, copy, print, or commit anything from corpus/ - it is private client work. It is
    gitignored; keep it that way. Calibration reports counts only, never workflow names.
  - Never touch secrets, .env, or .mcp.json.
  - Never run "npm publish", never "git push", never switch branches, never touch master.
  - Make best-judgment decisions per the plan. Do NOT ask questions - nobody is there to answer.
'@
$prompt = $promptTemplate.Replace('__BRANCH__', $branch).Replace('__PLAN__', $plan)
$promptFile = Join-Path $env:TEMP 'n8n-lint-prompt.txt'
Set-Content -Path $promptFile -Value $prompt -Encoding utf8
Write-Log "prompt written to $promptFile ($(($prompt -split "`n").Count) lines)"

$iter = 0
$fails = 0
$waits = 0
while ($true) {
  if ($iter -ge $maxIter)          { Write-Log "STOP: max iterations ($maxIter)"; break }
  if ((Get-Date) -ge $deadline)    { Write-Log 'STOP: deadline reached'; break }
  if ($fails -ge 3)                { Write-Log 'STOP: 3 consecutive failures'; break }

  # Count unticked steps in Phase 1 only. NB: cut at '## Rule Task Protocol', NOT at
  # '## Phase 2' - the protocol section sits between them and its 9 checkboxes are a
  # reusable TEMPLATE that is never ticked, so cutting at Phase 2 can never reach zero.
  $planText = Get-Content (Join-Path $repo $plan) -Raw
  # In-scope region = everything before Phase 5, MINUS the Rule Task Protocol block
  # (its 9 checkboxes are a reusable template and are never ticked).
  $stop = $planText.IndexOf('## Phase 5')
  if ($stop -lt 0) { $stop = $planText.Length }
  $scope = $planText.Substring(0, $stop)
  $pStart = $scope.IndexOf('## Rule Task Protocol')
  $pEnd   = $scope.IndexOf('## Phase 2')
  if ($pStart -ge 0 -and $pEnd -gt $pStart) { $scope = $scope.Remove($pStart, $pEnd - $pStart) }
  $remaining = ([regex]::Matches($scope, '(?m)^\s*-\s\[ \]')).Count
  if ($remaining -eq 0) { Write-Log 'STOP: Phases 1-4 complete'; break }

  # A worker killed mid-task (usage-limit wait, /End, crash) leaves uncommitted files in
  # src/ and test/. The worker stand-down rule then fires for EVERY later worker - they
  # correctly refuse work they did not create - and the build deadlocks permanently.
  # The runner is single-threaded, so between iterations nothing legitimate is in flight:
  # anything uncommitted here is abandoned. Stash it (recoverable, unlike reset --hard)
  # so each worker starts from a clean tree.
  $dirty = & git status --porcelain
  if ($dirty) {
    $n = ($dirty | Measure-Object).Count
    & git stash push -u -m "abandoned-iteration-$iter" *>> $log
    Write-Log "stashed $n abandoned file(s) from a killed worker - tree reset to HEAD"
  }

  $iter++
  Write-Log "--- iteration $iter (unticked steps remaining: $remaining) ---"
  Set-Content -Path $status -Value "RUNNING iteration $iter, $remaining steps left" -Encoding utf8

  $before = (& git rev-parse HEAD)
  $iterOut = Join-Path $env:TEMP 'n8n-lint-iteration.txt'
  Get-Content $promptFile -Raw | & $claude -p --model opus --dangerously-skip-permissions *> $iterOut
  $code = $LASTEXITCODE
  if (Test-Path $iterOut) { Get-Content $iterOut | Add-Content -Path $log }
  $iterText = if (Test-Path $iterOut) { Get-Content $iterOut -Raw } else { '' }

  # A usage/session limit is transient. Counting it as a build failure trips the
  # 3-strike valve and ends the night for no reason - that is exactly what killed
  # the 2026-08-21 00:26 run. Wait for the window to reopen and retry the same task.
  if ($iterText -match 'session limit|usage limit|rate limit|resets \d') {
    $waits++
    if ($waits -gt 12) { Write-Log 'STOP: usage limit persisted beyond 12 waits'; break }
    Write-Log "usage limit hit - waiting 15 min (wait $waits/12), NOT counted as a failure"
    Set-Content -Path $status -Value "WAITING on usage limit (wait $waits/12)" -Encoding utf8
    Start-Sleep -Seconds 900
    $iter--
    continue
  }
  $after = (& git rev-parse HEAD)

  if ($code -eq 0 -and $before -ne $after) {
    $fails = 0
    Write-Log "iteration $iter OK (exit=$code, new commits)"
  } else {
    $fails++
    Write-Log "iteration $iter NO PROGRESS (exit=$code, head unchanged=$($before -eq $after)), consecutive failures=$fails"
  }
}

$remaining = (Select-String -Path (Join-Path $repo $plan) -Pattern '^\s*-\s\[ \]' -AllMatches).Count
$commits = (& git rev-list --count "master..$branch")
$summary = "DONE iterations=$iter commits=$commits untickedStepsLeft=$remaining branch=$branch"
Write-Log "=== $summary ==="
Set-Content -Path $status -Value $summary -Encoding utf8

[Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
Write-Log 'keep-awake released, lock cleared'

