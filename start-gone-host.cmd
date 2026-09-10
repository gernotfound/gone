@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-gone-host.ps1"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo [G.O.N.E.] Il launcher si e' chiuso con errore %ERR%.
  if not "%GONE_NO_PAUSE%"=="1" pause
)
exit /b %ERR%
