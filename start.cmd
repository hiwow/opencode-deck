@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo [deck] installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)

echo [deck] building frontend...
call npm run build
if errorlevel 1 goto :error

echo [deck] starting on http://127.0.0.1:5178
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 6; Start-Process 'http://127.0.0.1:5178/'"
call npm run serve
if errorlevel 1 goto :error
goto :eof

:error
echo.
echo [deck] failed. Read the messages above.
pause
