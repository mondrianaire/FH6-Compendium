@echo off
title FH6 Telemetry Lab stop
taskkill /FI "WINDOWTITLE eq FH6 telemetry daemon*" /T /F >nul 2>&1 && echo [daemon] stopped || echo [daemon] not running
taskkill /FI "WINDOWTITLE eq FH6 dashboard*" /T /F >nul 2>&1 && echo [dashboard] stopped || echo [dashboard] not running
timeout /t 3 >nul
