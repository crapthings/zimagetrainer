@echo off
setlocal EnableExtensions
title Z-Image Trainer - Install
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 (
  echo.
  echo Installation did not complete. See the error above and run this file again after fixing it.
  pause
  exit /b 1
)

echo.
echo Installation complete. Double-click start-dev.bat to launch Z-Image Trainer.
pause
