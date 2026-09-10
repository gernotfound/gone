@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-gone-host.ps1"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo [G.O.N.E.] Il launcher si e' chiuso con errore %ERR%.
  pause
)
exit /b %ERR%
