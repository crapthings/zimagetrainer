@echo off
setlocal EnableExtensions
title Z-Image Trainer - Development
cd /d "%~dp0"

where uv >nul 2>nul
if errorlevel 1 goto :not_installed

where corepack >nul 2>nul
if errorlevel 1 goto :not_installed

if not exist ".venv\Scripts\python.exe" goto :not_installed
if not exist "node_modules\concurrently" goto :not_installed
if not exist "web\node_modules" goto :not_installed

echo Starting Z-Image Trainer development services...
echo UI:  http://localhost:5173
echo API: http://localhost:8000
echo.
call corepack pnpm dev

if errorlevel 1 (
  echo.
  echo Development services stopped with an error. See the output above.
  pause
)
exit /b %errorlevel%

:not_installed
echo.
echo Dependencies are not installed yet.
echo Double-click install.bat first, wait for it to finish, then start this file again.
pause
exit /b 1
