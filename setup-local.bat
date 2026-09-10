@echo off
title AHD LiveStream - Local Server
cd /d "%~dp0"

echo.
echo  AHD LiveStream Overlay - Local Setup
echo  =====================================
echo.

:: Check Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Install from https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo  Node.js %%i detected

:: Create .env from example if it doesn't exist
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo.
        echo  Created .env from .env.example
        echo  ** Edit .env with your Traccar credentials before starting **
        echo.
        notepad ".env"
        pause
    )
)

:: Install dependencies
echo.
echo  Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] npm install failed
    pause
    exit /b 1
)

:: Start the server
echo.
echo  Starting local server...
echo  Press Ctrl+C to stop.
echo.
node server.js

pause
