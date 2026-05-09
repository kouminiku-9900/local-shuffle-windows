@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :err
)
call npm start
goto :eof

:err
echo.
echo npm install failed.
pause
