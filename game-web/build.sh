#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Installing wasm32 target for Rust..."
rustup target add wasm32-unknown-unknown || true

echo "Installing wasm-pack..."
if ! command -v wasm-pack &> /dev/null; then
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

echo "Building game-core (WASM)..."
cd "$REPO_ROOT/game-core"
wasm-pack build --target web --out-dir "$REPO_ROOT/game-web/pkg"

echo "Building game-web (Vite)..."
cd "$REPO_ROOT/game-web"
npm install
npm run build
