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

set "CV_LAUNCH="
if exist "%~dp0..\CV Improvements\launch_cv.bat" set "CV_LAUNCH=%~dp0..\CV Improvements\launch_cv.bat"
if not defined CV_LAUNCH if exist "%~dp0..\cv-improvements\launch_cv.bat" set "CV_LAUNCH=%~dp0..\cv-improvements\launch_cv.bat"
if defined CV_LAUNCH (
    echo  Starting CV on http://127.0.0.1:8790
    start "Rowing CV" "%CV_LAUNCH%"
) else (
    echo  [skip] CV folder not found at ..\CV Improvements
)

set "DJI_DIR="
if exist "%~dp0..\dji-cloud-telemetry\package.json" set "DJI_DIR=%~dp0..\dji-cloud-telemetry"
if not defined DJI_DIR if exist "%~dp0..\traccar-overlay\apps\dji-cloud-telemetry\package.json" set "DJI_DIR=%~dp0..\traccar-overlay\apps\dji-cloud-telemetry"
if defined DJI_DIR (
    echo  Starting DJI telemetry on http://127.0.0.1:5050
    start "DJI telemetry" /D "%DJI_DIR%" cmd /k "if not exist node_modules call npm install & npm start"
) else (
    echo  [skip] DJI telemetry app not found at ..\dji-cloud-telemetry
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
