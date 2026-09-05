#!/bin/bash
echo "Installing Rust..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

echo "Installing wasm-pack..."
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

echo "Building game-core (WASM)..."
cd ../game-core
wasm-pack build --target web --out-dir ../game-web/pkg

echo "Building game-web (Vite)..."
cd ../game-web
npm install
npm run build
