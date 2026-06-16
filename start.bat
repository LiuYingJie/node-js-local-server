@echo off
cd /d "%~dp0"
title File Server

echo ========================================
echo   Starting file server...
echo   Open: http://127.0.0.1^:3000
echo   Stop: close this window or press Ctrl+C
echo ========================================
echo.

node app.js
if errorlevel 1 goto failed
goto end

:failed
echo.
echo Start failed. Port may already be in use.
echo Run stop.bat first, then try again.
pause

:end
