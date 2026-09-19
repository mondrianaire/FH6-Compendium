# Installs the FH6 lab watchdog so it (a) runs now and (b) auto-starts at every logon.
#
# Two persistence paths, tried in order:
#   1. A "FH6 Lab Watchdog" Scheduled Task (robust: hidden, restart-on-fail, single-instance). Needs the
#      Task Scheduler service to accept the registration -- requires an ELEVATED shell on this machine.
#   2. Fallback (no admin needed): a .vbs launcher dropped in the per-user Startup folder, which runs the
#      watchdog hidden at logon. This is what installs when step 1 hits "Access denied".
#
# Either way the watchdog is also started immediately. The watchdog's own mutex keeps it single-instance,
# so "start now" + the logon launcher never double up.
#
# Remove:  schtasks /delete /tn "FH6 Lab Watchdog" /f     (if the task installed)
#          del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\fh6-lab-watchdog.vbs"  (if the shim did)
$ErrorActionPreference = "Stop"
$root     = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$wd       = Join-Path $root "scripts\lab_watchdog.ps1"
$taskName = "FH6 Lab Watchdog"
$psArgs   = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $wd

# --- 1. try a Scheduled Task ---
$installed = $null
try {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs -WorkingDirectory $root
    $trigger  = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -Description "Keeps the FH6 telemetry daemon + dashboard + rebuild alive (re-runs lab_up.ps1 when any is down)." `
        -Force -ErrorAction Stop | Out-Null
    $installed = "task"
    Write-Host "Autostart: registered Scheduled Task '$taskName' (runs at logon)."
} catch {
    Write-Host "Scheduled Task registration failed ($($_.Exception.Message.Trim())) -- using the Startup-folder shim instead." -ForegroundColor Yellow
}

# --- 2. fallback: per-user Startup-folder .vbs launcher ---
if ($installed -ne "task") {
    $startup = [Environment]::GetFolderPath('Startup')
    $vbs = Join-Path $startup "fh6-lab-watchdog.vbs"
    $vbsBody = 'CreateObject("WScript.Shell").Run "powershell.exe ' + ($psArgs -replace '"', '""') + '", 0, False'
    Set-Content -Path $vbs -Value $vbsBody -Encoding ASCII
    $installed = "startup"
    Write-Host "Autostart: installed logon launcher -> $vbs"
}

# --- start it now (mutex prevents a duplicate if one is already looping) ---
Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",$wd `
    -WorkingDirectory $root -WindowStyle Hidden
Write-Host "Watchdog started now (pid detached). Log: data\logs\watchdog.log"
