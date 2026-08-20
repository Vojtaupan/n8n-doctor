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
$maxIter = 45
$deadline = (Get-Date).Date.AddDays(1).AddHours(8)   # hard stop 08:00 tomorrow

function Write-Log($m) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $m"
  Add-Content -Path $log -Value $line
}

Set-Location $repo
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

Find the FIRST task in the plan whose step checkboxes are not all ticked. Implement ONLY that one task:
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
  $remaining = (Select-String -Path (Join-Path $repo $plan) -Pattern '^\s*-\s\[ \]' -AllMatches).Count
  if ($remaining -eq 0) { Write-Log 'STOP: plan complete - no unticked steps'; break }

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
