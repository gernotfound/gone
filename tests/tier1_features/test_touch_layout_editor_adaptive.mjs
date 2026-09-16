import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const editor = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'touchLayoutEditor.ts'), 'utf8');
  const smoke = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'scripts', 'mobile_layout_editor_smoke.mjs'), 'utf8');

  suite.test('Touch layout persistence is viewport-normalized and migrates legacy pixel offsets', () => {
    assert(editor.includes("const STORAGE_KEY = 'gone-touch-layout-v2'"), 'adaptive layout editor must use versioned normalized storage');
    assert(editor.includes("const LEGACY_STORAGE_KEY = 'gone-touch-layout-v1'"), 'layout editor must preserve a legacy migration path');
    assert(editor.includes('Number(item.x) / width') && editor.includes('Number(item.y) / height'), 'legacy pixel offsets must normalize against the current viewport');
    assert(editor.includes('offset.x * Math.max(1, window.innerWidth)') && editor.includes('offset.y * Math.max(1, window.innerHeight)'), 'normalized offsets must scale back into current viewport pixels');
    assert(editor.includes('normalized: true'), 'diagnostics must expose normalized layout semantics');
    assert(!editor.includes('Math.max(-500') && !editor.includes('Math.min(500'), 'legacy fixed pixel clamps must not remain authoritative');
  });

  suite.test('Custom controls are re-clamped on viewport, orientation, handedness and safe-area changes', () => {
    assert(editor.includes('env(safe-area-inset-top)') && editor.includes('env(safe-area-inset-right)')
      && editor.includes('env(safe-area-inset-bottom)') && editor.includes('env(safe-area-inset-left)'), 'layout clamp must read all four safe-area insets');
    assert(editor.includes('keepInsideViewport') && editor.includes('const limit = bounds()'), 'applied translations must pass through safe viewport bounds');
    assert(editor.includes("window.addEventListener('resize', applyAll") && editor.includes("window.addEventListener('orientationchange', applyAll"), 'layout must reconcile on dynamic viewport changes');
    assert(editor.includes("window.addEventListener('gone-touch-preferences-changed', applyAll"), 'handedness/preference changes must re-clamp custom controls');
    assert(editor.includes('offsets[activeElement.id] = toUnit(applied)'), 'drag persistence must write normalized rather than raw pixel offsets');
  });

  suite.test('Weapon quick slots remain one editable group and browser smoke exercises migration plus reflow', () => {
    assert(editor.includes("element.closest('#mc-weapon-switcher')"), 'any quick-slot drag must resolve to the weapon switcher group');
    assert(!editor.includes("'mc-weapon-slot-0'"), 'individual quick slots must not become independently persisted editor targets');
    assert(smoke.includes("const LEGACY_KEY = 'gone-touch-layout-v1'"), 'browser smoke must seed a real legacy layout');
    assert(smoke.includes("const STORAGE_KEY = 'gone-touch-layout-v2'"), 'browser smoke must verify v2 persistence');
    assert(smoke.includes("dragSwitcherThroughSlot") && smoke.includes("!drag.snapshot.offsets['mc-weapon-slot-2']"), 'browser smoke must prove slot drag ownership stays grouped');
    assert(smoke.includes("Emulation.setDeviceMetricsOverride") && smoke.includes("left-handed edge case must exercise a non-destructive viewport clamp"), 'browser smoke must verify responsive scaling and mirrored-edge clamping');
    assert(smoke.includes("portrait clamp/reflow must not rewrite stored normalized layout"), 'browser smoke must preserve custom intent across orientation changes');
  });
}
