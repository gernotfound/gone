#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

NODE_VERSION="22.23.2"
RUNTIME_ROOT="$(pwd)/.gone-runtime"
FORCE_LOCAL="${GONE_FORCE_LOCAL_NODE:-0}"
BOOTSTRAP_ONLY="${GONE_BOOTSTRAP_ONLY:-0}"

use_system_node=0
if [ "$FORCE_LOCAL" != "1" ] && command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [ "$node_major" -ge 22 ] 2>/dev/null; then
    use_system_node=1
  fi
fi

if [ "$use_system_node" = "1" ]; then
  NODE_BIN="$(command -v node)"
  NPM_BIN="$(command -v npm)"
else
  os="$(uname -s)"
  machine="$(uname -m)"
  case "$os" in
    Linux) platform="linux" ;;
    Darwin) platform="darwin" ;;
    *) echo "[G.O.N.E.] Sistema non supportato automaticamente: $os"; exit 1 ;;
  esac
  case "$machine" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "[G.O.N.E.] Architettura non supportata automaticamente: $machine"; exit 1 ;;
  esac

  runtime_name="node-v${NODE_VERSION}-${platform}-${arch}"
  runtime_dir="$RUNTIME_ROOT/$runtime_name"
  NODE_BIN="$runtime_dir/bin/node"
  NPM_BIN="$runtime_dir/bin/npm"

  if [ ! -x "$NODE_BIN" ] || [ ! -x "$NPM_BIN" ]; then
    command -v curl >/dev/null 2>&1 || { echo "[G.O.N.E.] curl non disponibile."; exit 1; }
    command -v tar >/dev/null 2>&1 || { echo "[G.O.N.E.] tar non disponibile."; exit 1; }
    mkdir -p "$RUNTIME_ROOT"
    archive="$RUNTIME_ROOT/${runtime_name}.tar.xz"
    url="https://nodejs.org/dist/v${NODE_VERSION}/${runtime_name}.tar.xz"
    echo "[G.O.N.E.] Node.js non presente: scarico runtime locale ${NODE_VERSION} (${platform}-${arch})..."
    curl -fL --retry 3 "$url" -o "$archive"
    rm -rf "$runtime_dir"
    tar -xJf "$archive" -C "$RUNTIME_ROOT"
    rm -f "$archive"
  fi
fi

echo "[G.O.N.E.] Runtime Node pronto: $($NODE_BIN --version)"
echo "[G.O.N.E.] Preparazione client web..."
"$NPM_BIN" ci --prefix game-web
"$NPM_BIN" run build --prefix game-web

echo "[G.O.N.E.] Preparazione host locale..."
"$NPM_BIN" install --prefix gone-host --ignore-scripts

if [ "$BOOTSTRAP_ONLY" = "1" ]; then
  echo "[G.O.N.E.] Bootstrap completato."
  exit 0
fi

echo "[G.O.N.E.] Avvio server sul tuo PC..."
exec "$NODE_BIN" gone-host/server.mjs
