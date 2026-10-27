@echo off
setlocal EnableExtensions
title FB Bur -> Supabase Storage Sync

set "SYNC_DIR=%LOCALAPPDATA%\FB-Bur\sync"
set "BASE_URL=https://raw.githubusercontent.com/vladimirlevitin/pumpkin-latte-collector/bur/supabase-json-importer-v0.1/tools"
set "WATCHER_LOG=%LOCALAPPDATA%\FB-Bur\watcher-launch.log"

if not exist "%SYNC_DIR%" mkdir "%SYNC_DIR%"
if not exist "%LOCALAPPDATA%\FB-Bur" mkdir "%LOCALAPPDATA%\FB-Bur"

echo Updating FB Bur sync tools...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "Invoke-WebRequest -UseBasicParsing -Uri '%BASE_URL%/import_bur_json.py' -OutFile '%SYNC_DIR%\import_bur_json.py';" ^
  "Invoke-WebRequest -UseBasicParsing -Uri '%BASE_URL%/watch_bur_downloads.py' -OutFile '%SYNC_DIR%\watch_bur_downloads.py'"

if errorlevel 1 (
  echo.
  echo ERROR: Could not download the sync tools.
  pause
  exit /b 1
)

set "PYTHON_CMD="
where py >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
  where python >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  echo.
  echo ERROR: Python 3 was not found on this computer.
  echo Install Python 3 and run this file again.
  pause
  exit /b 1
)

cd /d "%SYNC_DIR%"

:run
%PYTHON_CMD% watch_bur_downloads.py
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" goto :done

echo.
echo Watcher exited unexpectedly with code %RC%.
echo It will restart in 5 seconds.
>>"%WATCHER_LOG%" echo [%DATE% %TIME%] watcher exited with code %RC%
timeout /t 5 /nobreak >nul
goto :run

:done
echo.
pause
