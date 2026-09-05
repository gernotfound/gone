// tests/helpers/asset_inspector.mjs
// Inspects 3D assets, source models, and Three.js hierarchy metadata for G.O.N.E.

import fs from 'fs';
import path from 'path';

export const ASSET_SOURCES = {
  assalto: 'C:\\Users\\gerar\\Downloads\\assalto.html',
  cecchino: 'C:\\Users\\gerar\\Downloads\\cecchino.html',
  pompa: 'C:\\Users\\gerar\\Downloads\\pompa.html',
  mitraglietta: 'C:\\Users\\gerar\\Downloads\\mitraglietta.html',
  coltello: 'C:\\Users\\gerar\\Downloads\\coltello.html',
  modello: 'C:\\Users\\gerar\\Downloads\\modello.html',
};

export const EXPECTED_FLUO_COMPONENTS = [
  'Nucleo centrale', // Torso core
  'Visore ottico', // Eye visor
  'Reattore di sollevamento', // Main lift thruster
  'Propulsore manovra DX', // Right maneuvering thruster
  'Propulsore manovra SX', // Left maneuvering thruster
  'Zaino tubo DX', // Backpack right energy conduit
  'Zaino tubo SX', // Backpack left energy conduit
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
 * Inspects an HTML model source file to verify procedural Three.js hierarchy.
 */
export function inspectHtmlModelSource(assetKey) {
  const filePath = ASSET_SOURCES[assetKey];
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Asset file not found for key ${assetKey}: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const size = fs.statSync(filePath).size;

  // Check for Three.js import
  const hasThreeImport = content.includes('three.min.js') || content.includes('three.module.js') || content.includes('three.js');

  // Count addPart invocations (rough count of child meshes)
  const addPartMatches = content.match(/addPart\(/g) || [];
  const addPartCount = addPartMatches.length;

  // Check for materials
  const hasNeonGreen = content.includes('matNeonGreen') || content.includes('0x39ff14');
  const hasNeonPink = content.includes('matNeonPink') || content.includes('0xff00ff');
  const hasNeonCyan = content.includes('matNeonCyan') || content.includes('0x00ffff');
  const hasOrange = content.includes('matOrange') || content.includes('0xffaa00');

  // Check fluo components in modello
  let fluoMatches = [];
  if (assetKey === 'modello') {
    for (const comp of EXPECTED_FLUO_COMPONENTS) {
      if (content.toLowerCase().includes(comp.toLowerCase()) || content.includes('matNeonGreen')) {
        fluoMatches.push(comp);
      }
    }
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

/**
 * Checks if exported GLB binary exists in game-web/public/assets/
 */
export function inspectGlbAsset(assetKey, rootDir = 'c:\\Users\\gerar\\Documents\\GitHub\\gone') {
  const glbPath = path.join(rootDir, 'game-web', 'public', 'assets', `${assetKey}.glb`);
  const exists = fs.existsSync(glbPath);
  let size = 0;
  if (exists) {
    size = fs.statSync(glbPath).size;
  }
  return {
    path: glbPath,
    exists,
    size,
  };
}
