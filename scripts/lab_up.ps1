# The ONE way to start the lab. Run from anywhere:
#     powershell -File scripts\lab_up.ps1            (from the checkout that holds the data)
# Starts, in order, the telemetry daemon (UDP 9876 -> http 8765), the dashboard server (8000) and the
# rebuild service (8001), each from THIS checkout, each refusing to start from the main checkout
# (scripts/lab_root.py). Prints the three URLs and what /health says it is serving.
#
# Why this exists: on 2026-09-05 the stack was started by hand three different ways from two
# different checkouts, and half an hour of telemetry landed in the stale mirror. One script, one
# checkout, one place to look.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Resolve-Python {
    # Bare "python" on this box resolves to the WindowsApps stub (%LOCALAPPDATA%\Microsoft\WindowsApps\
    # python.exe), which no-ops instead of binding -- that is what left duplicate stub+real processes on
    # 2026-09-12 and would make a headless (Task Scheduler) start silently fail. Pin a REAL interpreter.
    $cands = @(
        "C:\Users\mondr\AppData\Local\Python\pythoncore-3.14-64\python.exe",
        "C:\Users\mondr\AppData\Local\Python\bin\python.exe"
    )
    foreach ($c in $cands) { if (Test-Path $c) { return $c } }
    $cmd = Get-Command python -ErrorAction SilentlyContinue |
           Where-Object { $_.Source -notlike "*\WindowsApps\*" } | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    throw "No real Python interpreter found (only the WindowsApps stub). Install Python or fix the candidates in lab_up.ps1."
}
$PY = Resolve-Python

function Listening($port) {
    # LISTENING only: a just-killed service leaves TIME_WAIT lines on its port for a minute, and those
    # must not read as "already up" (they did, 2026-09-05, and the restart silently did nothing).
    return [bool](netstat -ano | Select-String -Pattern ("TCP\s+127\.0\.0\.1:{0}\s.*LISTENING" -f $port) -Quiet)
}

$jobs = @(
    @{ name = "daemon";    port = 8765; args = @("scripts\telemetry\fh6_live_daemon.py") },
    @{ name = "dashboard"; port = 8000; args = @("scripts\serve_dashboard.py", "8000") },
    @{ name = "rebuild";   port = 8001; args = @("scripts\rebuild_service.py", "8001") }
)
$logdir = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force $logdir | Out-Null

foreach ($j in $jobs) {
    if (Listening $j.port) {
        Write-Host ("{0,-10} already listening on {1} -- left as is" -f $j.name, $j.port)
        continue
    }
    $out = Join-Path $logdir ("{0}.log" -f $j.name)
    $err = Join-Path $logdir ("{0}.err" -f $j.name)
    Start-Process -FilePath $PY -ArgumentList $j.args -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
    $t0 = Get-Date
    while (-not (Listening $j.port) -and ((Get-Date) - $t0).TotalSeconds -lt 15) { Start-Sleep -Milliseconds 300 }
    if (Listening $j.port) {
        Write-Host ("{0,-10} up on {1}   (log {2})" -f $j.name, $j.port, $out)
    } else {
        Write-Host ("{0,-10} FAILED to bind {1} -- see {2}" -f $j.name, $j.port, $err) -ForegroundColor Red
        if (Test-Path $err) { Get-Content $err -Tail 5 | ForEach-Object { "    " + $_ } }
    }
}

Write-Host ""
Write-Host "dashboard v2   http://localhost:8000/v2/"
Write-Host "dashboard v1   http://localhost:8000/"
Write-Host "daemon health  http://localhost:8765/health"
Write-Host "rebuild status http://localhost:8001/status"
try {
    $h = Invoke-RestMethod -Uri "http://localhost:8765/health" -TimeoutSec 3
    Write-Host ""
    Write-Host ("daemon serves  {0}  (branch {1})" -f $h.lab.root, $h.lab.branch)
    if (-not $h.receiving) { Write-Host "telemetry      not receiving yet -- FH6 > Settings > HUD and Gameplay > Data Out = On, 127.0.0.1:9876" }
} catch {
    Write-Host "daemon health  not answering yet" -ForegroundColor Yellow
}
