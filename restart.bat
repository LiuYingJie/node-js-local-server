@echo off
cd /d "%~dp0"

echo Restarting server...
call "%~dp0stop.bat" silent
timeout /t 1 /nobreak >nul
start "File Server" cmd /k "%~dp0start.bat"
echo Started in a new window.
pause
