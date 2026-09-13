import { BUILD_ID } from '../generated/buildVersion.ts';

export const PERFORMANCE_PACK_SCHEMA = 3;
export const PERFORMANCE_STORAGE_PREFIX = 'gone-performance-pack:';
export const PERFORMANCE_CACHE_PREFIX = 'gone-performance-pack-';

/**
 * Stable pack assets. Keep this list deterministic: integrity must not depend on
 * Resource Timing entries that can appear after startup and create false
 * "missing one asset" states.
 */
export const PERFORMANCE_STATIC_ASSETS = [
  '/assets/modello.glb',
  '/assets/assalto.glb',
  '/assets/cecchino.glb',
  '/assets/pompa.glb',
  '/assets/mitraglietta.glb',
  '/assets/coltello.glb',
  '/favicon.svg',
  '/icons.svg',
  '/Colossus March.mp3',
] as const;

export function performancePackToken(): string {
  return `${BUILD_ID}-p${PERFORMANCE_PACK_SCHEMA}`;
}

export function performanceStorageKey(): string {
  return `${PERFORMANCE_STORAGE_PREFIX}${performancePackToken()}`;
}

export function performanceCacheName(): string {
  const safe = performancePackToken().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return `${PERFORMANCE_CACHE_PREFIX}${safe}`;
}

function sameOriginAsset(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return null;
    if (!/\.(?:js|css|wasm)$/i.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

/**
 * Deterministic manifest for the current HTML/build. Vite's hashed entry JS/CSS
 * are read from the DOM; game models and menu music are explicit above.
 */
export function collectPerformancePackAssets(): string[] {
  const urls = new Set<string>(PERFORMANCE_STATIC_ASSETS);
  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((element) => {
    const asset = sameOriginAsset(element.src);
    if (asset) urls.add(asset);
  });
  document.querySelectorAll<HTMLLinkElement>('link[href]').forEach((element) => {
    const asset = sameOriginAsset(element.href);
    if (asset) urls.add(asset);
  });
  return [...urls].sort();
}
