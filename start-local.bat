@echo off
cd /d "%~dp0"
title AHD LiveStream local overlays
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not on PATH. Install from https://nodejs.org then run this again.
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
)
echo Starting local overlays on http://127.0.0.1:8787
echo vMix Browser: http://127.0.0.1:8787/local.html
node server.mjs
pause
