@echo off
setlocal EnableExtensions
title FB Bur -> Supabase Storage Sync

set "SYNC_DIR=%LOCALAPPDATA%\FB-Bur\sync"
set "BASE_URL=https://raw.githubusercontent.com/vladimirlevitin/pumpkin-latte-collector/bur/supabase-json-importer-v0.1/tools"

if not exist "%SYNC_DIR%" mkdir "%SYNC_DIR%"

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

where py >nul 2>nul
if not errorlevel 1 (
  cd /d "%SYNC_DIR%"
  py -3 watch_bur_downloads.py
  goto :done
)

where python >nul 2>nul
if not errorlevel 1 (
  cd /d "%SYNC_DIR%"
  python watch_bur_downloads.py
  goto :done
)

echo.
echo ERROR: Python 3 was not found on this computer.
echo Install Python 3 and run this file again.

:done
echo.
pause
