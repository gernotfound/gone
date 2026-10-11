import init from '../../pkg/game_core.js';

let initialization: Promise<void> | null = null;

/**
 * WASM is shared by terrain generation, spawn authority and local physics.
 * A guest can join from the lobby before game preload, so both paths must
 * await the same initialization. Failures clear the promise for a real retry.
 */
export function ensureGameCoreInitialized(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      await init();
    })().catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}
