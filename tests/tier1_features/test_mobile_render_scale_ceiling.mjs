import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const adaptive = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'performance', 'adaptiveRenderScale.ts'), 'utf8');
  const mobile = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'mobileRuntime.ts'), 'utf8');
  const smoke = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'scripts', 'mobile_pwa_smoke.mjs'), 'utf8');

  suite.test('Adaptive render quality shares the smartphone DPR ceiling instead of fighting the mobile runtime', () => {
    assert(adaptive.includes('const SMARTPHONE_MAX_DPR = 1.0'), 'adaptive quality must define the same 1.0 smartphone DPR ceiling');
    assert(adaptive.includes("classList.contains('gone-smartphone')") && adaptive.includes('Math.min(DESKTOP_MAX_DPR, SMARTPHONE_MAX_DPR)'), 'max DPR must resolve dynamically from the active smartphone profile');
    assert(adaptive.includes('const ceiling = maxDpr();') && adaptive.includes('currentDpr < ceiling - 0.01'), 'quality recovery must stop at the dynamic device ceiling');
    assert(adaptive.includes("setDpr(ceiling, 'LIMITE SMARTPHONE')"), 'adaptive quality must correct an over-ceiling renderer without waiting for mobileRuntime');
    assert(adaptive.includes('maxDpr: maxDpr()') && adaptive.includes('minDpr: minDpr()'), 'diagnostics must report the effective dynamic DPR bounds');
    assert(adaptive.includes("setDpr(maxDpr(), 'DISATTIVATO')"), 'disabling adaptive quality must restore only the device-safe maximum');
  });

  suite.test('Mobile runtime remains defense-in-depth and browser smoke proves actual renderer DPR stays <= 1', () => {
    assert(mobile.includes('Math.min(renderer.getPixelRatio(), window.devicePixelRatio || 1, 1.0)'), 'mobile runtime must retain its hard 1.0 renderer clamp');
    assert(mobile.includes("window.addEventListener('gone-render-scale-changed', clampMobileDpr"), 'mobile runtime must still guard adaptive render-scale changes');
    assert(smoke.includes('active.dpr === null || active.dpr <= 1.001'), 'real iPhone browser smoke must verify the effective renderer DPR ceiling');
  });
}
