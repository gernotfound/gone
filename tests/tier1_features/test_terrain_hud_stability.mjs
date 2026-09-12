import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const style = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'style.css'), 'utf8');
  const mobile = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'competitiveTouchControls.css'), 'utf8');
  const chunks = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'world', 'chunkManager.ts'), 'utf8');
  const config = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'world', 'worldConfig.ts'), 'utf8');
  const scene = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'rendering', 'scene.ts'), 'utf8');
  const terrain = fs.readFileSync(path.join(PROJECT_ROOT, 'game-core', 'src', 'lib.rs'), 'utf8');

  suite.test('Health HUD is centered at the bottom on desktop and smartphone', () => {
    assert(style.includes('left: 50% !important;'), 'desktop health HUD must use the horizontal center');
    assert(style.includes('transform: translateX(-50%)'), 'desktop health HUD must compensate its own width');
    assert(mobile.includes('html.gone-smartphone #health-hud'), 'smartphone profile must own a centered health override');
    assert(mobile.includes('translateX(-50%) scale(.56)'), 'smartphone health HUD must stay centered while compact');
  });

  suite.test('Terrain keeps its existing color contract while border normals use halo samples', () => {
    assert(terrain.includes('let color_inv_len ='), 'terrain color slope must stay separate from seam-normal calculation');
    assert(terrain.includes('get_terrain_height(world_x - cell, world_z)'), 'left border normal must sample outside the chunk');
    assert(terrain.includes('get_terrain_height(world_x + cell, world_z)'), 'right border normal must sample outside the chunk');
    assert(terrain.includes('colors.push((2.0 + (30.0 - 2.0) * t)'), 'red terrain palette endpoints must remain unchanged');
    assert(terrain.includes('colors.push((6.0 + (41.0 - 6.0) * t)'), 'green terrain palette endpoints must remain unchanged');
    assert(terrain.includes('colors.push((15.0 + (59.0 - 15.0) * t)'), 'blue terrain palette endpoints must remain unchanged');
  });

  suite.test('Static terrain skips redundant local matrix recomputation', () => {
    assert(chunks.includes('mesh.matrixAutoUpdate = false'), 'static chunk meshes must disable automatic local matrix updates');
    assert(chunks.includes('mesh.updateMatrix()'), 'static chunk mesh matrix must be committed once after positioning');
  });

  suite.test('Expensive terrain builds are paced instead of running back-to-back', () => {
    assert(config.includes('TERRAIN_BUILD_SOFT_BUDGET_MS'), 'terrain soft frame budget must be configured');
    assert(config.includes('TERRAIN_BUILD_MAX_COOLDOWN_MS'), 'terrain cooldown cap must be configured');
    assert(chunks.includes('nextTerrainBuildAt'), 'chunk manager must track the next safe terrain build time');
    assert(chunks.includes('pendingTerrainIds.size === 0'), 'detail builds must wait until terrain generation settles');
  });

  suite.test('Renderer resize path rejects zero-sized viewports and avoids CSS layout writes', () => {
    assert(scene.includes('Math.max(1, Math.round'), 'renderer dimensions must be clamped to at least one pixel');
    assert(scene.includes('safeWidth === this.renderWidth && safeHeight === this.renderHeight'), 'duplicate resize work must be skipped');
    assert(scene.includes('this.renderer.setSize(safeWidth, safeHeight, false)'), 'drawing-buffer resize must not rewrite canvas CSS size');
  });
}
