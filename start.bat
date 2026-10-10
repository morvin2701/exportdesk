@echo off
title ExportDesk - Invoice Generator
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js is not installed. Please install it from https://nodejs.org (LTS) and run this file again.
  pause
  exit /b 1
)
if not exist server\node_modules (
  echo Installing dependencies, please wait...
  cd server
  call npm install --omit=dev
  cd ..
)
start "" http://localhost:4000
node server\index.js
pause
