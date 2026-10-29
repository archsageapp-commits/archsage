@echo off
rem Build the app and open it in the Electron window
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run app
if errorlevel 1 pause
