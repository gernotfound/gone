import { defineConfig } from 'vite';

export default defineConfig({
  // wasm-pack --target web does not need an additional Vite WASM plugin.
  build: {
    target: 'esnext',
    rolldownOptions: {
      output: {
        // Manual chunking can otherwise change side-effect order across chunks.
        // Stability is more important here than the small wrapper-size cost.
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: 'three-vendor',
              test: /node_modules[\\/]three[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
