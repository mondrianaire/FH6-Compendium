# FH6 lab watchdog. Loops forever; every $interval seconds it checks that the daemon /health endpoint
# answers and the dashboard (8000) + rebuild (8001) ports are LISTENING. If anything is down it re-runs
# lab_up.ps1, which is idempotent (its Listening() guard starts only what is not already up). Transitions
# are appended to data\logs\watchdog.log.
#
# Why this exists: on 2026-09-12 the daemon was started once, stopped ~16 h later (clean exit, empty
# stderr -- terminated externally, not a crash), and nothing restarted it, so the dashboard ran feed-less
# for ~3.75 days before anyone noticed. Nothing supervised it. This does.
#
# NOTE: `receiving:false` from /health is NOT a failure -- it just means FH6's Data Out is off / the game
# is closed; the daemon is still healthy. We only treat a non-answering /health as "daemon down".
#
# Installed as the "FH6 Lab Watchdog" logon Scheduled Task by scripts\install_lab_watchdog.ps1
# (single-instance via the task's IgnoreNew policy). Stop it with:
#     schtasks /end /tn "FH6 Lab Watchdog"      (this run)   /   /delete /tn "FH6 Lab Watchdog" /f  (remove)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$log      = Join-Path $root "data\logs\watchdog.log"
$labUp    = Join-Path $root "scripts\lab_up.ps1"
$interval = 30

New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

function Log($m) {
    Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m)
}

# Single-instance guard: the watchdog can be launched two ways (started now + the logon shim). A
# session-scoped mutex lets only the first survive; later launches log and exit. Held for process life.
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "FH6LabWatchdog", [ref]$createdNew)
if (-not $createdNew) { Log "another watchdog instance already running -- exiting"; exit 0 }
function Listening($port) {
    return [bool](netstat -ano | Select-String -Pattern ("TCP\s+127\.0\.0\.1:{0}\s.*LISTENING" -f $port) -Quiet)
}
function DaemonAnswers {
    try { $null = Invoke-RestMethod -Uri "http://localhost:8765/health" -TimeoutSec 4; return $true }
    catch { return $false }
}

Log ("watchdog started (pid {0}), interval {1}s" -f $PID, $interval)
$wasDown = $false
while ($true) {
    $daemon = DaemonAnswers
    $dash   = Listening 8000
    $reb    = Listening 8001
    if (-not ($daemon -and $dash -and $reb)) {
        Log ("DOWN  daemon={0} dashboard={1} rebuild={2}  -- running lab_up.ps1" -f $daemon, $dash, $reb)
        # lab_up writes its own daemon.log/.err; discard its (UTF-16) host output so watchdog.log stays clean.
        try { & $labUp *> $null } catch { Log ("lab_up.ps1 error: {0}" -f $_) }
        Start-Sleep -Seconds 5
        if (DaemonAnswers) { Log "recovered: daemon healthy again" } else { Log "STILL DOWN after lab_up.ps1" }
        $wasDown = $true
    }
    elseif ($wasDown) {
        Log "all services healthy again"
        $wasDown = $false
    }
    Start-Sleep -Seconds $interval
}
