<#
    Score the skidpad runs in the NEWEST capture.

    The drive-check-adjust loop wants one short command, not a path to the current capture -- which changes
    every session and is the last thing you want to look up with a controller in your hand.

    Run it from anywhere:
        .\scripts\skidpad_last.ps1
        .\scripts\skidpad_last.ps1 -Watch      # STAY RUNNING and re-score while you drive
        .\scripts\skidpad_last.ps1 -All        # every capture in the folder, not just the newest
        .\scripts\skidpad_last.ps1 -Captures "C:\...\captures"

    What to look for is `slip F/R`: the higher of the two is the limiting axle and it wants to read 0.9-1.2.
    Anything outside that gets a `!` and a line saying why. See docs/skidpad-protocol.md.
#>
[CmdletBinding()]
param(
    [string]$Captures,
    [switch]$All,
    # Stay running and re-score as you drive, so you can glance at the terminal between circles instead of
    # re-running this after every attempt. Ctrl-C to stop.
    [switch]$Watch,
    [double]$Every = 5
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# The captures live in whichever checkout the daemon runs from, which is not necessarily this one, so try
# this worktree first and then its siblings rather than assuming.
if (-not $Captures) {
    $candidates = @((Join-Path $root "captures"))
    $siblings = Split-Path -Parent $root
    if (Test-Path $siblings) {
        $candidates += (Get-ChildItem $siblings -Directory | ForEach-Object { Join-Path $_.FullName "captures" })
    }
    $Captures = $candidates | Where-Object { Test-Path $_ } |
        Sort-Object { (Get-ChildItem $_ -Filter *.csv -ErrorAction SilentlyContinue |
                       Measure-Object -Maximum LastWriteTime).Maximum } -Descending |
        Select-Object -First 1
}
if (-not $Captures -or -not (Test-Path $Captures)) {
    Write-Error "no captures directory found -- pass one with -Captures"
}

if ($Watch) {
    Write-Host "watching $Captures - Ctrl-C to stop" -ForegroundColor DarkGray
    # -u so the loop prints as it goes even when piped or redirected
    python -u (Join-Path $PSScriptRoot "analysis\skidpad.py") $Captures --watch $Every --pooled
    return
}

$files = Get-ChildItem (Join-Path $Captures "*.csv") | Sort-Object LastWriteTime -Descending
if (-not $files) { Write-Error "no .csv captures in $Captures" }
if (-not $All) { $files = $files | Select-Object -First 1 }

Write-Host ("reading {0} capture(s) from {1}" -f $files.Count, $Captures) -ForegroundColor DarkGray
foreach ($f in $files) { Write-Host ("  {0}  {1:yyyy-MM-dd HH:mm}" -f $f.Name, $f.LastWriteTime) -ForegroundColor DarkGray }

python (Join-Path $PSScriptRoot "analysis\skidpad.py") @($files.FullName) --pooled
