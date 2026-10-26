@echo off
cd /d "%~dp0"
title Axiom Studia — Academic Operating System
echo ========================================================
echo   Launching Axiom Studia Academic Operating System...
echo ========================================================
echo.
py -3 --version >nul 2>&1
if not errorlevel 1 goto use_launcher
python --version >nul 2>&1
if not errorlevel 1 goto use_python
set "BUNDLED_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%BUNDLED_PYTHON%" goto use_bundled
echo Python is required to run this local website. Install Python 3, then run start.bat again.
goto end

:use_launcher
start "" "http://localhost:3000"
py -3 serve.py
goto end

:use_python
start "" "http://localhost:3000"
python serve.py
goto end

:use_bundled
start "" "http://localhost:3000"
"%BUNDLED_PYTHON%" serve.py

:end
pause
