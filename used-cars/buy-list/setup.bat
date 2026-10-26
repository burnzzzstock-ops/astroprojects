@echo off
setlocal
cd /d "%~dp0"
echo === Buy List setup ===
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js isn't installed yet. Opening the download page: install the "LTS" version,
  echo then double-click setup.bat again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
echo Installing (one time, a couple of minutes)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo npm install failed. Check the internet connection and run setup.bat again.
  pause
  exit /b 1
)
echo Downloading the browser it uses to read listings...
call npx playwright install chromium
if not exist config.json copy config.example.json config.json >nul
if not exist dealers.csv copy dealers.example.csv dealers.csv >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\install-shortcuts.ps1"
echo.
echo Done. The Buy List now starts on its own when you log in to this PC,
echo and there's a "Buy List" shortcut on the desktop.
echo Next: add dealer websites to dealers.csv (open it in Excel or Notepad).
echo Starting it now...
start "Buy List" /min "%~dp0start.bat"
timeout /t 5 >nul
start "" http://localhost:4400/
pause
