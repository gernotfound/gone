import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const minimapPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'ui', 'minimap.ts');
  const runtimePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'runtime', 'startClientRuntime.ts');
  const liveMapPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'liveMapOverlay.ts');
  const legacyMarkersPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'mapSpawnMarkers.ts');
  const minimap = fs.readFileSync(minimapPath, 'utf8');
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  const liveMap = fs.readFileSync(liveMapPath, 'utf8');

  suite.test('Tactical map renders the canonical maze wall geometry', () => {
    assert(
      minimap.includes("import { MAZE_WALLS } from '../world/mazeLayout.ts';"),
      'minimap must consume the same canonical maze wall source as gameplay collision',
    );
    assert(
      minimap.includes('for (const wall of MAZE_WALLS)'),
      'minimap must render every canonical maze wall footprint',
    );
    assert(
      minimap.includes('drawMazeOverlay(minimapCtx, width, height);'),
      'maze overlay must be part of the live map render path',
    );
  });

  suite.test('Obsolete map ping marker layer is removed from runtime', () => {
    assert(
      !runtime.includes('mapSpawnMarkers'),
      'runtime must not register the extra map marker/ping layer',
    );
    assert(
      !fs.existsSync(legacyMarkersPath),
      'obsolete marker module must remain removed rather than dormant',
    );
  });

  suite.test('Tactical map has no place-name or landmark marker layer', () => {
    assert(!liveMap.includes('addLandmark('), 'live map must not create named landmark markers');
    assert(!liveMap.includes('map-landmark-'), 'live map must not retain landmark marker DOM ids');
    assert(!liveMap.includes('NUCLEO ZERO · SPAWN'), 'live map must not label the spawn location');
    assert(!liveMap.includes('CRATERE DEL SEGNALE'), 'live map must not label world locations');
  });

  suite.test('Map terrain keeps a higher-resolution relief pass under the maze', () => {
    assert(
      minimap.includes('const SAMPLE_SIZE = 256;'),
      'global map should retain the higher-resolution terrain sample',
    );
    assert(
      minimap.includes('const relief = Math.max('),
      'global map should retain directional hillshade for terrain readability',
    );
  });
}
