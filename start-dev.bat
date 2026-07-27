@echo off
setlocal
title Z-Image Trainer - Development
cd /d "%~dp0"

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
