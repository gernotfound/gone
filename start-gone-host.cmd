@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [G.O.N.E.] Node.js 22 o superiore non trovato.
  echo Installa Node.js, poi riapri questo file.
  pause
  exit /b 1
)

echo [G.O.N.E.] Preparazione client web...
call npm ci --prefix game-web
if errorlevel 1 goto :fail
call npm run build --prefix game-web
if errorlevel 1 goto :fail

echo [G.O.N.E.] Preparazione host locale...
call npm install --prefix gone-host --ignore-scripts
if errorlevel 1 goto :fail

echo [G.O.N.E.] Avvio server sul tuo PC...
node gone-host/server.mjs
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo [G.O.N.E.] Avvio fallito. Leggi l'errore sopra.
pause
exit /b 1
