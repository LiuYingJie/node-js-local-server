@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

set PORT=3000
set FOUND=0

echo Stopping server on port %PORT%...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  set FOUND=1
  echo Kill PID %%p
  taskkill /PID %%p /F >nul 2>&1
)

if !FOUND!==0 (
  echo No running server found.
) else (
  echo Server stopped.
)

endlocal
if /i not "%~1"=="silent" pause
