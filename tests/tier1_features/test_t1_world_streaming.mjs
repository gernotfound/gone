import {
  CHUNK_SIZE,
  chunkCoordToWorld,
  isChunkInLoadRadius,
  worldToChunkCoord,
} from '../../game-web/src/world/worldConfig.ts';
import { assert, assertEqual } from '../helpers/assertions.mjs';
import { generate_chunk } from '../../game-web/pkg/game_core.js';

export async function run(suite) {
  suite.test('World streaming: centered chunk coordinates match tile geometry', () => {
    assertEqual(CHUNK_SIZE, 400);
    assertEqual(worldToChunkCoord(0), 0);
    assertEqual(worldToChunkCoord(199.999), 0);
    assertEqual(worldToChunkCoord(200), 1);
    assertEqual(worldToChunkCoord(-200), 0);
    assertEqual(worldToChunkCoord(-200.001), -1);
    assertEqual(worldToChunkCoord(1200), 3);
    assertEqual(worldToChunkCoord(1399.999), 3);
    assertEqual(worldToChunkCoord(1400), 4);
    assertEqual(chunkCoordToWorld(3), 1200);
  });

  suite.test('World streaming: load radius stays bounded and circular-ish', () => {
    assertEqual(isChunkInLoadRadius(0, 0), true);
    assertEqual(isChunkInLoadRadius(2, 0), true);
    assertEqual(isChunkInLoadRadius(2, 1), true);
    assertEqual(isChunkInLoadRadius(2, 2), false);
    assertEqual(isChunkInLoadRadius(3, 0), false);
  });

  suite.test('World streaming: chunk payload ships cached normals and compact colors', () => {
    const chunk = generate_chunk(0, 0, 0, 0, CHUNK_SIZE, 8);
    try {
      const heights = chunk.get_heights();
      const normals = chunk.get_normals();
      const colors = chunk.get_colors();
      assert(normals instanceof Float32Array, 'Normals must be a Float32Array');
      assert(colors instanceof Uint8Array, 'Colors must use compact Uint8 storage');
      assertEqual(normals.length, heights.length * 3);
      assertEqual(colors.length, heights.length * 3);
    } finally {
      chunk.free();
    }
  });

}
