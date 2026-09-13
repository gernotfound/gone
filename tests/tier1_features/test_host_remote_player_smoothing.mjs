import fs from 'fs';
import path from 'path';
import { InterpolationBuffer } from '../../game-web/src/net/interpolationBuffer.ts';
import { assert, assertCloseTo } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Host remote presentation interpolates between buffered network samples', () => {
    const buffer = new InterpolationBuffer({
      renderDelayMs: 90,
      maxExtrapolationMs: 150,
      teleportThresholdMeters: 10,
    });

    buffer.pushSnapshot({
      timestamp: 1000,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
    });
    buffer.pushSnapshot({
      timestamp: 1100,
      x: 6,
      y: 0,
      z: 0,
      yaw: Math.PI / 2,
      pitch: 0,
    });

    const midpoint = buffer.sample(1050);
    assert(midpoint, 'Buffered remote state must be sampleable between host packets');
    assertCloseTo(midpoint.x, 3, 1e-6, 'Presentation should interpolate halfway between host samples');
    assertCloseTo(midpoint.yaw, Math.PI / 4, 1e-6, 'Yaw should interpolate on the shortest presentation arc');
  });

  suite.test('Host sync applies the 90 ms delay once and keeps authority data separate from presentation', () => {
    const hostSync = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'net', 'hostRemoteSync.ts'), 'utf8');
    const registry = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'remotePlayerRegistry.ts'), 'utf8');
    const engine = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'engine.ts'), 'utf8');

    assert(hostSync.includes('snapExistingTransform: false'), 'Host sync must not mutate the rendered transform on packet arrival');
    assert(hostSync.includes('snapshotTimestamp: now'), 'Host samples must use the local arrival/presentation clock without pre-subtracting delay');
    assert(registry.includes('if (options.snapExistingTransform !== false)'), 'Registry must preserve explicit snap behavior for non-buffered callers');
    assert(registry.includes('timestamp: snapshotTimestamp'), 'Registry must push the caller-provided presentation timestamp into the interpolation buffer');
    assert(engine.includes('updateRemotePlayerPresentation(performance.now() - 90)'), 'Render loop remains the single owner of the 90 ms interpolation delay');
    assert(!hostSync.includes('snapshotTimestamp: now - 90'), 'Host sync must not double-apply interpolation delay');
    assert(!hostSync.includes('remote.group.position.set('), 'Host sync must not directly snap remote position');
    assert(!hostSync.includes('remote.group.rotation'), 'Host sync must not directly snap remote rotation');
  });
}
