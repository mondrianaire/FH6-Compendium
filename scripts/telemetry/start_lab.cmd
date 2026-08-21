@echo off
setlocal
cd /d "%~dp0..\.."
title FH6 Telemetry Lab launcher
echo [FH6] starting backend from %cd%
netstat -ano | findstr ":8765 " | findstr LISTENING >nul && (echo [daemon]    already running on 8765) || (start "FH6 telemetry daemon (UDP 9876 -^> SSE 8765)" python scripts\telemetry\fh6_live_daemon.py)
netstat -ano | findstr ":8643 " | findstr LISTENING >nul && (echo [dashboard] already served on 8643) || (start "FH6 dashboard (http 8643)" python -m http.server 8643 --directory dashboard)
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:8643/#lab-live"
echo.
echo [FH6] dashboard  http://localhost:8643/#lab-live
echo [FH6] daemon     http://localhost:8765/health   (UDP in on 9876)
echo [FH6] in game:   Settings ^> HUD ^& Gameplay ^> Telemetry: Data Out = On, IP 127.0.0.1, Port 9876
echo.
echo Close this window any time; the daemon and dashboard keep running in their own windows.
echo To stop everything: scripts\telemetry\stop_lab.cmd
timeout /t 8 >nul
