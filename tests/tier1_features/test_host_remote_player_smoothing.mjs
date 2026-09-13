import fs from 'fs';
import path from 'path';
import {
  addOrUpdateRemotePlayer,
  removeRemotePlayer,
  updateRemotePlayerPresentation,
} from '../../game-web/src/gameplay/remotePlayerRegistry.ts';
import { assert, assertCloseTo } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Host remote samples stay buffered instead of snapping the rendered robot', () => {
    const id = 'host-smoothing-regression';
    const t0 = performance.now();
    const remote = addOrUpdateRemotePlayer(
      id,
      0,
      0,
      0,
      0,
      '#00F0FF',
      'assalto',
      1,
      { snapshotTimestamp: t0 },
    );

    addOrUpdateRemotePlayer(
      id,
      6,
      0,
      0,
      Math.PI / 2,
      '#00F0FF',
      'assalto',
      1,
      {
        snapExistingTransform: false,
        snapshotTimestamp: t0 + 100,
      },
    );

    assertCloseTo(remote.group.position.x, 0, 1e-6, 'Fresh host packet must not snap presentation immediately');
    assertCloseTo(remote.group.rotation.y, 0, 1e-6, 'Fresh host yaw must wait for presentation sampling');

    updateRemotePlayerPresentation(t0 + 50);
    assertCloseTo(remote.group.position.x, 3, 1e-6, 'Presentation should interpolate halfway between host samples');
    assertCloseTo(remote.group.rotation.y, Math.PI / 4, 1e-6, 'Yaw should interpolate on the presentation timeline');

    removeRemotePlayer(id);
  });

  suite.test('Host sync applies the 90 ms delay once and keeps authority data separate from presentation', () => {
    const hostSync = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'net', 'hostRemoteSync.ts'), 'utf8');
    const registry = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'remotePlayerRegistry.ts'), 'utf8');
    const engine = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'engine.ts'), 'utf8');

    assert(hostSync.includes('snapExistingTransform: false'), 'Host sync must not mutate the rendered transform on packet arrival');
    assert(hostSync.includes('snapshotTimestamp: now'), 'Host samples must use the local arrival/presentation clock without pre-subtracting delay');
    assert(registry.includes('if (options.snapExistingTransform !== false)'), 'Registry must preserve explicit snap behavior for non-buffered callers');
    assert(engine.includes('updateRemotePlayerPresentation(performance.now() - 90)'), 'Render loop remains the single owner of the 90 ms interpolation delay');
    assert(!hostSync.includes('snapshotTimestamp: now - 90'), 'Host sync must not double-apply interpolation delay');
  });
}
