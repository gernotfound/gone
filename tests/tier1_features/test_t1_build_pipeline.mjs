// tests/tier1_features/test_t1_build_pipeline.mjs
// Tier 1 Feature Coverage: Build Pipeline Hardening & Asset Readiness (F-17)

import fs from 'fs';
import path from 'path';
import { assert, assertEqual, assertGreaterThan, assertGreaterThanOrEqual } from '../helpers/assertions.mjs';
import { inspectGlbAsset, PROJECT_ROOT, ASSET_SOURCES } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('F-17: game-web/build.sh exists and contains target installation commands', () => {
    const buildShPath = path.join(PROJECT_ROOT, 'game-web', 'build.sh');
    assert(fs.existsSync(buildShPath), 'build.sh must exist in game-web');
    const content = fs.readFileSync(buildShPath, 'utf-8');
    assert(content.includes('wasm32-unknown-unknown'), 'build.sh must install wasm32 target');
    assert(content.includes('wasm-pack'), 'build.sh must configure wasm-pack');
    assert(content.includes('npm run build'), 'build.sh must build Vite frontend');
  });

  suite.test('F-17: game-web/package.json exists with Vite, Three.js and build scripts', () => {
    const pkgPath = path.join(PROJECT_ROOT, 'game-web', 'package.json');
    assert(fs.existsSync(pkgPath), 'package.json must exist in game-web');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    assert(pkg.scripts && pkg.scripts.build, 'package.json must define build script');
    assert(pkg.dependencies && pkg.dependencies.three, 'package.json must have three.js dependency');
  });

  suite.test('F-17: game-core/Cargo.toml exists with cdylib and wasm-bindgen dependencies', () => {
    const cargoPath = path.join(PROJECT_ROOT, 'game-core', 'Cargo.toml');
    assert(fs.existsSync(cargoPath), 'Cargo.toml must exist in game-core');
    const content = fs.readFileSync(cargoPath, 'utf-8');
    assert(content.includes('crate-type = ["cdylib"'), 'Cargo.toml must specify cdylib crate-type');
    assert(content.includes('wasm-bindgen'), 'Cargo.toml must depend on wasm-bindgen');
    assert(content.includes('serde'), 'Cargo.toml must depend on serde');
  });

  suite.test('F-17: All 6 GLB model files exist in game-web/public/assets/', () => {
    const assetKeys = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello', 'modello'];
    for (const key of assetKeys) {
      const info = inspectGlbAsset(key);
      assert(info.exists, `GLB asset file for ${key} must exist at ${info.path}`);
      assertGreaterThan(info.size, 50000, `GLB asset for ${key} must exceed 50KB (actual: ${info.size} bytes)`);
    }
  });

  suite.test('F-17: GLB files conform to binary glTF 2.0 header format (magic: 0x46546C67)', () => {
    const assetKeys = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello', 'modello'];
    for (const key of assetKeys) {
      const glbPath = path.join(PROJECT_ROOT, 'game-web', 'public', 'assets', `${key}.glb`);
      const buffer = fs.readFileSync(glbPath);
      assertGreaterThanOrEqual(buffer.length, 12, 'GLB header must be at least 12 bytes');
      assertEqual(buffer.readUInt32LE(0), 0x46546c67, `GLB asset ${key} must have valid glTF magic header`);
      assertEqual(buffer.readUInt32LE(4), 2, `GLB asset ${key} must be glTF version 2`);
      assertEqual(buffer.readUInt32LE(8), buffer.length, `GLB asset ${key} header length matches actual file size`);
    }
  });

  suite.test('F-17: Combined size of all 6 GLB assets exceeds 800KB', () => {
    const assetKeys = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello', 'modello'];
    const totalSize = assetKeys.reduce((sum, key) => sum + inspectGlbAsset(key).size, 0);
    assertGreaterThan(totalSize, 800000, `Combined GLB size must exceed 800KB (actual: ${totalSize} bytes)`);
  });

  suite.test('F-17: Architectural specifications define weapon TTK balance rationale in AGENTS.md / PROJECT.md', () => {
    const agentsPath = path.join(PROJECT_ROOT, 'AGENTS.md');
    assert(fs.existsSync(agentsPath), 'AGENTS.md must exist at project root');
    const content = fs.readFileSync(agentsPath, 'utf-8');
    assert(content.includes('Architecture discipline') && content.includes('Browser FPS'), 'AGENTS.md must specify the current browser/runtime architecture');

    const projectPath = path.join(PROJECT_ROOT, 'PROJECT.md');
    assert(fs.existsSync(projectPath), 'PROJECT.md must exist at project root');
    const projContent = fs.readFileSync(projectPath, 'utf-8');
    assert(projContent.includes('TTK'), 'PROJECT.md must document TTK balance');
  });

  suite.test('F-17: Canonical procedural model sources are versioned in the repository', () => {
    const uniqueSources = [...new Set(Object.values(ASSET_SOURCES))];
    assertEqual(uniqueSources.length, 2, 'Robot and weapon procedural sources should be canonicalized into two builders');
    for (const sourcePath of uniqueSources) {
      assert(fs.existsSync(sourcePath), `Versioned procedural source must exist: ${sourcePath}`);
      assertGreaterThan(fs.statSync(sourcePath).size, 5000, `Procedural source must be substantive: ${sourcePath}`);
    }
  });

  suite.test('F-17: docs/weapons_balance.md exists and documents all 5 weapons with TTK balance rationale', () => {
    const docsPath = path.join(PROJECT_ROOT, 'docs', 'weapons_balance.md');
    assert(fs.existsSync(docsPath), 'docs/weapons_balance.md must exist');
    const content = fs.readFileSync(docsPath, 'utf-8');
    assert(content.includes('AR-42 Viper'), 'docs must document AR-42 Viper');
    assert(content.includes('SR-99 Railphantom'), 'docs must document SR-99 Railphantom');
    assert(content.includes('SG-12 Havoc'), 'docs must document SG-12 Havoc');
    assert(content.includes('SMG-7 Neon Hornet'), 'docs must document SMG-7 Neon Hornet');
    assert(content.includes('CB-01 Shadowfang'), 'docs must document CB-01 Shadowfang');
    assert(content.includes('TTK'), 'docs must document the TTK balance rationale');
  });
}
