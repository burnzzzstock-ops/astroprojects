@echo off
cd /d "%~dp0"
title Buy List - leave this window open (minimize it)
:run
node src\server.js
echo.
echo Buy List stopped. Restarting in 10 seconds (close this window to stop it for good)...
timeout /t 10 >nul
goto run
