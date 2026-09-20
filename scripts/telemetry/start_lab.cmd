@echo off
setlocal
cd /d "%~dp0..\.."
title FH6 Telemetry Lab launcher
rem The ONE way to start the stack is scripts\lab_up.ps1: it starts the telemetry daemon (UDP 9876 -> http
rem 8765), the dashboard (8000) and the rebuild service (8001), each from the checkout lab_up.ps1 itself lives
rem in, and REFUSES to start from the master checkout (scripts\lab_root.py). This .cmd is only a double-click
rem wrapper around it -- run it from a lab worktree. (History: this file used to start a v1 dashboard on 8643
rem from the main checkout, so frames landed in master's stale data; that is exactly what lab_up.ps1 prevents.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%cd%\scripts\lab_up.ps1"
if errorlevel 1 (
  echo.
  echo [FH6] lab_up.ps1 did not start the stack -- see the message above ^(most likely this is the master
  echo       checkout, which is refused; launch from a lab worktree instead^).
  echo.
  pause
  exit /b 1
)
start "" "http://localhost:8000/v2/"
echo.
echo [FH6] dashboard  http://localhost:8000/v2/
echo [FH6] daemon     http://localhost:8765/health   ^(UDP in on 9876^)
echo [FH6] in game:   Settings ^> HUD ^& Gameplay ^> Telemetry: Data Out = On, IP 127.0.0.1, Port 9876
echo.
echo Close this window any time; the three services keep running in their own hidden processes.
timeout /t 8 >nul
