#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[G.O.N.E.] Node.js 22 o superiore non trovato."
  exit 1
fi

echo "[G.O.N.E.] Preparazione client web..."
npm ci --prefix game-web
npm run build --prefix game-web

echo "[G.O.N.E.] Preparazione host locale..."
npm install --prefix gone-host --ignore-scripts

echo "[G.O.N.E.] Avvio server sul tuo PC..."
node gone-host/server.mjs
