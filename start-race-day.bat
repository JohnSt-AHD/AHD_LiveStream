@echo off
title AHD LiveStream - Race day
cd /d "%~dp0"

echo.
echo  AHD LiveStream — race day local stack
echo  =====================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Install from https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo  Installing graphics dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo  [ERROR] npm install failed
        pause
        exit /b 1
    )
)

if exist "%~dp0..\cv-improvements\launch_cv.bat" (
    echo  Starting CV on http://127.0.0.1:8790
    start "Rowing CV" "%~dp0..\cv-improvements\launch_cv.bat"
) else (
    echo  [skip] CV folder not found at ..\cv-improvements
)

if exist "%~dp0..\traccar-overlay\apps\dji-cloud-telemetry\package.json" (
    echo  Starting DJI telemetry on http://127.0.0.1:5050
    start "DJI telemetry" /D "%~dp0..\traccar-overlay\apps\dji-cloud-telemetry" cmd /k "if not exist node_modules call npm install & npm start"
) else (
    echo  [skip] DJI telemetry app not found
)

echo  Opening hub in 2 seconds: http://localhost:3000
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

echo.
echo  Graphics hub:  http://localhost:3000
echo  CV:            http://127.0.0.1:8790/cv-hub.html
echo  DJI monitor:   http://127.0.0.1:5050/monitor
echo.
echo  Point vMix Web Browser inputs at the overlay cards on the hub.
echo  Press Ctrl+C in this window to stop graphics.
echo.

node server.js
pause
