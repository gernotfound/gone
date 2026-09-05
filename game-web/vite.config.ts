import { defineConfig } from 'vite';

export default defineConfig({
  // Plugin non necessari per wasm-pack --target web
  build: {
    target: 'esnext'
  }
});
