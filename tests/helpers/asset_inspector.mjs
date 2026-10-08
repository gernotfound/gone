// tests/helpers/asset_inspector.mjs
// Portable inspection helpers for the versioned G.O.N.E. 3D sources/assets.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..', '..');

const WEAPON_BUILDERS_ROOT = path.join(PROJECT_ROOT, 'game-web', 'src', 'models', 'weapons');
const WEAPON_BUILDERS = {
  assalto: path.join(WEAPON_BUILDERS_ROOT, 'assaultRifle.ts'),
  cecchino: path.join(WEAPON_BUILDERS_ROOT, 'sniperRifle.ts'),
  pompa: path.join(WEAPON_BUILDERS_ROOT, 'shotgun.ts'),
  mitraglietta: path.join(WEAPON_BUILDERS_ROOT, 'smg.ts'),
  coltello: path.join(WEAPON_BUILDERS_ROOT, 'knife.ts'),
};
const ROBOT_BUILDER = path.join(PROJECT_ROOT, 'game-web', 'src', 'models', 'robotBuilder.ts');

// The original project tests pointed at C:\Users\...\Downloads\*.html, which
// made the test suite impossible to run anywhere except the author's PC.
// The canonical procedural model sources are the per-weapon TypeScript builders
// that are actually versioned and shipped with the game. Each weapon is inspected
// independently so one large facade cannot hide a missing or degraded builder.
export const ASSET_SOURCES = {
  ...WEAPON_BUILDERS,
  modello: ROBOT_BUILDER,
};

export const EXPECTED_FLUO_COMPONENTS = [
  'Nucleo centrale',
  'Visore ottico',
  'Reattore di sollevamento',
  'Propulsore manovra DX',
  'Propulsore manovra SX',
  'Zaino tubo DX',
  'Zaino tubo SX',
];

export const WEAPON_SOCKET_ANCHOR = {
  x: -1.15,
  y: 0.4,
  z: 0.85,
};

export const SCALE_FACTORS = {
  assalto: 0.15,
  cecchino: 0.15,
  pompa: 0.15,
  mitraglietta: 0.15,
  coltello: 0.08,
  modello: 0.67,
};

/**
 * Inspects the canonical procedural Three.js source used by the application.
 * The historical function name is preserved so older suites keep working.
 */
export function inspectHtmlModelSource(assetKey) {
  const filePath = ASSET_SOURCES[assetKey];
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Asset file not found for key ${assetKey}: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const size = fs.statSync(filePath).size;

  const hasThreeImport =
    content.includes("from 'three'") ||
    content.includes('from "three"') ||
    content.includes('three.min.js') ||
    content.includes('three.module.js') ||
    content.includes('three.js');

  // Robot uses addPart(); each weapon builder uses a local add() helper.
  const partRegex = assetKey === 'modello' ? /addPart\(/g : /\badd\(/g;
  const addPartCount = (content.match(partRegex) || []).length;

  const lower = content.toLowerCase();
  const hasNeonGreen = lower.includes('matneongreen') || lower.includes('0x39ff14') || lower.includes('robotfluoaccent');
  const hasNeonPink = lower.includes('matneonpink') || lower.includes('0xff00ff');
  const hasNeonCyan = lower.includes('matneoncyan') || lower.includes('0x00ffff');
  const hasOrange = lower.includes('matorange') || lower.includes('matenergyorange') || lower.includes('0xffaa00');

  const fluoMatches = [];
  if (assetKey === 'modello') {
    const canonicalFluoNames = [
      'chest_reactor',
      'optical_visor',
      'main_thruster_flame',
      'right_thruster_exhaust',
      'left_thruster_exhaust',
      'backpack_right_conduit',
      'backpack_left_conduit',
    ];
    EXPECTED_FLUO_COMPONENTS.forEach((component, index) => {
      if (lower.includes(component.toLowerCase()) || lower.includes(canonicalFluoNames[index])) {
        fluoMatches.push(component);
      }
    });
  }

  return {
    filePath,
    size,
    hasThreeImport,
    addPartCount,
    hasNeonGreen,
    hasNeonPink,
    hasNeonCyan,
    hasOrange,
    fluoMatches,
  };
}

/** Checks the checked-in binary glTF asset used by the browser build. */
export function inspectGlbAsset(assetKey, rootDir = PROJECT_ROOT) {
  const glbPath = path.join(rootDir, 'game-web', 'public', 'assets', `${assetKey}.glb`);
  const exists = fs.existsSync(glbPath);
  return {
    path: glbPath,
    exists,
    size: exists ? fs.statSync(glbPath).size : 0,
  };
}
