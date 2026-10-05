export type BiomeId =
  | 'central_hub'
  | 'alpine_fissures'
  | 'flooded_lowlands'
  | 'ash_basin'
  | 'overgrown_ruins';

export type BiomeDefinition = {
  id: BiomeId;
  label: string;
  storyRole: string;
  landmark: string;
  anchor: { x: number; z: number };
  palette: {
    dark: readonly [number, number, number];
    light: readonly [number, number, number];
  };
};

export const CENTRAL_BIOME_RADIUS = 420;
export const CENTRAL_BIOME_BLEND = 80;

export const BIOMES: Record<BiomeId, BiomeDefinition> = {
  central_hub: {
    id: 'central_hub',
    label: 'Nucleo Zero',
    storyRole: 'spawn, orientamento e primo contatto con i sistemi del labirinto',
    landmark: 'Obelisco Zero',
    anchor: { x: 0, z: 0 },
    palette: { dark: [20, 34, 38], light: [72, 92, 94] },
  },
  alpine_fissures: {
    id: 'alpine_fissures',
    label: 'Faglie Alpine',
    storyRole: 'verticalita, osservazione e percorsi ad alto rischio',
    landmark: 'Osservatorio Fratturato',
    anchor: { x: -1500, z: -1500 },
    palette: { dark: [31, 39, 48], light: [118, 132, 142] },
  },
  flooded_lowlands: {
    id: 'flooded_lowlands',
    label: 'Bassopiani Allagati',
    storyRole: 'visibilita ridotta, percorsi lenti e infrastrutture sommerse',
    landmark: 'Stazione di Pompaggio 04',
    anchor: { x: 1200, z: -1200 },
    palette: { dark: [12, 38, 42], light: [57, 93, 86] },
  },
  ash_basin: {
    id: 'ash_basin',
    label: 'Bacino delle Ceneri',
    storyRole: 'zona d impatto, risorse rare e tracce dell evento che ha danneggiato il complesso',
    landmark: 'Cratere del Segnale',
    anchor: { x: 1200, z: 1200 },
    palette: { dark: [45, 27, 24], light: [112, 73, 56] },
  },
  overgrown_ruins: {
    id: 'overgrown_ruins',
    label: 'Rovine Verdi',
    storyRole: 'copertura fitta, deviazioni e strutture di ricerca riconquistate dalla vegetazione',
    landmark: 'Serre Sommerse',
    anchor: { x: -1200, z: 1200 },
    palette: { dark: [17, 39, 24], light: [67, 105, 62] },
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function outerBiomeAt(x: number, z: number): BiomeDefinition {
  if (x < 0 && z < 0) return BIOMES.alpine_fissures;
  if (x >= 0 && z < 0) return BIOMES.flooded_lowlands;
  if (x >= 0 && z >= 0) return BIOMES.ash_basin;
  return BIOMES.overgrown_ruins;
}

export function getBiomeAt(x: number, z: number): BiomeDefinition {
  if (Math.hypot(x, z) <= CENTRAL_BIOME_RADIUS) return BIOMES.central_hub;
  return outerBiomeAt(x, z);
}

function channelMix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function paletteColor(
  biome: BiomeDefinition,
  shade: number,
  altitude: number,
): readonly [number, number, number] {
  const t = clamp01(shade);
  let r = channelMix(biome.palette.dark[0], biome.palette.light[0], t);
  let g = channelMix(biome.palette.dark[1], biome.palette.light[1], t);
  let b = channelMix(biome.palette.dark[2], biome.palette.light[2], t);

  if (biome.id === 'alpine_fissures' && altitude > 0) {
    const snow = clamp01(altitude) * 0.38;
    r = channelMix(r, 214, snow);
    g = channelMix(g, 223, snow);
    b = channelMix(b, 228, snow);
  }
  return [r, g, b];
}

/**
 * Re-tints the canonical terrain slope shading into deterministic world biomes.
 * Geometry remains owned by Rust/WASM; this is deliberately a presentation
 * layer so future maze/POI work can iterate without forking terrain physics.
 */
export function applyBiomePaletteToChunk(
  colors: Uint8Array,
  heights: Float32Array,
  offsetX: number,
  offsetZ: number,
  size: number,
  resolution: number,
): Uint8Array {
  const verts = resolution + 1;
  const vertexCount = verts * verts;
  if (colors.length !== vertexCount * 3 || heights.length !== vertexCount) {
    throw new Error(
      `Biome palette buffer mismatch: colors=${colors.length}, heights=${heights.length}, vertices=${vertexCount}`,
    );
  }

  const half = size * 0.5;
  const central = BIOMES.central_hub;

  for (let index = 0; index < vertexCount; index += 1) {
    const row = Math.floor(index / verts);
    const col = index % verts;
    const x = offsetX + (col / resolution) * size - half;
    const z = offsetZ + (row / resolution) * size - half;
    const distance = Math.hypot(x, z);
    const outer = outerBiomeAt(x, z);

    const sourceMax = Math.max(
      colors[index * 3],
      colors[index * 3 + 1],
      colors[index * 3 + 2],
    );
    const shade = clamp01((sourceMax - 15) / 44);
    const altitude = clamp01((heights[index] - 120) / 320);

    const centralColor = paletteColor(central, shade, 0);
    const outerColor = paletteColor(outer, shade, altitude);
    const outerWeight = smoothstep(
      CENTRAL_BIOME_RADIUS - CENTRAL_BIOME_BLEND,
      CENTRAL_BIOME_RADIUS + CENTRAL_BIOME_BLEND,
      distance,
    );

    colors[index * 3] = channelMix(centralColor[0], outerColor[0], outerWeight);
    colors[index * 3 + 1] = channelMix(centralColor[1], outerColor[1], outerWeight);
    colors[index * 3 + 2] = channelMix(centralColor[2], outerColor[2], outerWeight);
  }

  return colors;
}
