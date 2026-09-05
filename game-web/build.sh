#!/bin/bash
echo "Installing wasm32 target for Rust..."
rustup target add wasm32-unknown-unknown

echo "Installing wasm-pack..."
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

echo "Building game-core (WASM)..."
cd ../game-core
wasm-pack build --target web --out-dir ../game-web/pkg

echo "Building game-web (Vite)..."
cd ../game-web
npm install
npm run build
