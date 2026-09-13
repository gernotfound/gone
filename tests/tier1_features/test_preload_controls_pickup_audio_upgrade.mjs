import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  suite.test('Performance pack uses one deterministic build identity and includes menu music', () => {
    const manifest = source('game-web', 'src', 'performance', 'performancePackManifest.ts');
    const pack = source('game-web', 'src', 'performance', 'performancePack.ts');
    const integrity = source('game-web', 'src', 'performance', 'cacheIntegrity.ts');
    const sw = source('game-web', 'public', 'gone-cache-sw.js');

    assert(manifest.includes("import { BUILD_ID }"), 'performance pack identity must derive from generated BUILD_ID');
    assert(manifest.includes("'/Colossus March.mp3'"), 'menu music must be explicitly included in the preload pack');
    assert(!manifest.includes("performance.getEntriesByType('resource')"), 'required pack assets must not depend on late Resource Timing entries');
    assert(pack.includes('gone-cache-sw.js?v=${encodeURIComponent(BUILD_ID)}'), 'performance preload must use the same build-id service worker as PWA runtime');
    assert(pack.includes('if (result.failed > 0)'), 'a partial cache must never be marked ready');
    assert(pack.includes("gone-performance-pack-complete"), 'preload completion must have an explicit event boundary');
    assert(pack.includes("settingsButton.insertAdjacentElement('afterend', wrapper)"), 'preload control must sit below settings');
    assert(integrity.includes("gone-performance-pack-complete"), 'integrity validation must react to actual transaction completion');
    assert(!integrity.includes('setTimeout(runValidation, 1500)'), 'integrity must not race preload with arbitrary timers');
    assert(sw.includes('cacheName:') || sw.includes('requestedCacheName'), 'worker must accept the canonical performance cache name');
  });

  suite.test('Main menu exposes a complete controls legend above volume', () => {
    const legend = source('game-web', 'src', 'ui', 'controlsLegend.ts');
    const menu = source('game-web', 'src', 'ui', 'menu.ts');
    for (const token of ['W A S D / Frecce', 'Click sinistro', 'Click destro', "['R'", "['E'", "['Shift'", "['Spazio'", "['C / Ctrl'", '1 · 2 · 3 · 4 · 5', "['M'", "['Esc'"]) {
      assert(legend.includes(token), `controls legend must document ${token}`);
    }
    assert(legend.includes("insertBefore(button, musicButton)"), 'COMANDI button must be inserted above VOLUME');
    assert(menu.includes('startControlsLegend()'), 'menu owner must initialize the controls legend');
  });

  suite.test('Supply pickups require explicit E/touch intent instead of proximity auto-collection', () => {
    const input = source('game-web', 'src', 'controls', 'playerInput.ts');
    const pickup = source('game-web', 'src', 'gameplay', 'craterSupplyPickups.ts');
    const css = source('game-web', 'src', 'gameplay', 'craterSupplyPickups.css');

    assert(input.includes("case 'KeyE'"), 'keyboard input must expose E as pickup action');
    assert(input.includes("gone-pickup-requested"), 'E must translate to a shared pickup intent');
    assert(pickup.includes("window.addEventListener('gone-pickup-requested', collectNearbySupply)"), 'pickup owner must consume the explicit intent');
    assert(pickup.includes("button.id = 'mc-pickup'") && pickup.includes("button.textContent = 'TAKE'"), 'smartphone must receive a contextual TAKE action');
    assert(pickup.includes('findNearestCollectible'), 'proximity must select a candidate without collecting it');
    const frameStart = pickup.indexOf('function frame(');
    const frameEnd = pickup.indexOf('function attachPoolsWhenSceneReady', frameStart);
    const frame = pickup.slice(frameStart, frameEnd);
    assert(!frame.includes('tryCollect('), 'animation/proximity loop must not auto-collect supplies');
    assert(css.includes('#mc-pickup.is-hidden'), 'contextual touch pickup must disappear when no item is available');
  });

  suite.test('Application weapon audio layers transient, body, LFE, mechanics and bounded tails', () => {
    const enhanced = source('game-web', 'src', 'audio', 'enhancedWeaponAudio.ts');
    const index = source('game-web', 'src', 'audio', 'index.ts');

    for (const layer of ['HEAD:', 'BODY:', 'LFE:', 'MECHANICAL:', 'TAIL:']) {
      assert(enhanced.includes(layer), `enhanced weapon audio must include ${layer}`);
    }
    assert(enhanced.includes('variation: 0.035') && enhanced.includes('variation: 0.055'), 'repeat shots must use bounded micro-variation');
    assert(enhanced.includes('tailMs: 72') && enhanced.includes('tailMs: 38'), 'AR/SMG tails must remain short enough for automatic fire clarity');
    assert(enhanced.includes('tailMs: 360') && enhanced.includes('tailMs: 280'), 'sniper/shotgun must retain longer weight/decay');
    assert(index.includes('enhancedWeaponAudio as soundSynth'), 'application singleton must route through enhanced audio while preserving base synth exports');
    assert(enhanced.includes('this.base.playWeaponSound'), 'verified procedural synth must remain the base weapon signature');
  });
}
