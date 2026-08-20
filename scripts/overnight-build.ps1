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
$maxIter = 12
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

$prompt = @"
You are running UNATTENDED (headless, no human present) in the n8n-audit repository, on branch $branch.

Read the implementation plan at $plan and the spec it references at docs/specs/2026-08-20-n8n-audit-design.md.

SCOPE LIMIT FOR THIS RUN: only Tasks 1 through 5 (Phase 1 - Foundation) are in scope.
If every step of Tasks 1-5 is already ticked, print 'FOUNDATION COMPLETE' and exit immediately.
Do NOT start Task 6 or anything later - the rule set is under review and may change.

Find the FIRST task in Tasks 1-5 whose step checkboxes are not all ticked. Implement ONLY that one task:
  - Follow its steps in order. It is a TDD plan: write the failing test first, watch it fail, then implement.
  - Honour the Global Constraints section. It applies to every task.
  - Rule tasks (6-29) follow the 'Rule Task Protocol' section verbatim, including BOTH fixtures.
  - Run 'npm run check' before committing. If it fails, fix it. Do not commit failing code.
  - Commit with the conventional-commit message the task specifies, staging EXPLICIT paths only.
    Never 'git add .' and never 'git add -A'.
  - Then tick that task's checkboxes in $plan and commit the plan file.
  - Then STOP. Do not start the next task.

Hard rules:
  - Never read, copy, print, or commit anything from corpus/ - it is private client work. It is
    gitignored; keep it that way. Calibration reports counts only, never workflow names.
  - Never touch secrets, .env, or .mcp.json.
  - Never run 'npm publish', never 'git push', never switch branches, never touch master.
  - Make best-judgment decisions per the plan. Do NOT ask questions - nobody is there to answer.
"@

$iter = 0
$fails = 0
while ($true) {
  if ($iter -ge $maxIter)          { Write-Log "STOP: max iterations ($maxIter)"; break }
  if ((Get-Date) -ge $deadline)    { Write-Log 'STOP: deadline reached'; break }
  if ($fails -ge 3)                { Write-Log 'STOP: 3 consecutive failures'; break }

  # Plan complete when no unticked checkbox remains.
  # Count unticked steps in the foundation phase only (everything before '## Phase 2').
  $planText = Get-Content (Join-Path $repo $plan) -Raw
  $foundation = $planText.Substring(0, [Math]::Max(0, $planText.IndexOf('## Phase 2')))
  $remaining = ([regex]::Matches($foundation, '(?m)^\s*-\s\[ \]')).Count
  if ($remaining -eq 0) { Write-Log 'STOP: foundation complete'; break }

  $iter++
  Write-Log "--- iteration $iter (unticked steps remaining: $remaining) ---"
  Set-Content -Path $status -Value "RUNNING iteration $iter, $remaining steps left" -Encoding utf8

  $before = (& git rev-parse HEAD)
  & $claude -p $prompt --model opus --dangerously-skip-permissions *>> $log
  $code = $LASTEXITCODE
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

