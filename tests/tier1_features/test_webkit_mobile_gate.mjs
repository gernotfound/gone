import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Pinned Playwright browser gate exercises WebKit alongside Chromium', () => {
    const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github/workflows/rescue-ci.yml'), 'utf8');
    assert(workflow.includes('playwright@1.64.0'), 'Playwright version must be reproducibly pinned');
    assert(workflow.includes('playwright install --with-deps chromium webkit'), 'Both browser engines must be installed');
    assert(workflow.includes('run_smoke mobile_webkit_smoke.mjs rescue-mobile-webkit.log'), 'WebKit checks must be canonical');
    assert(workflow.includes('            rescue-mobile-webkit.log'), 'WebKit evidence must be retained');
  });
  suite.test('WebKit smoke validates real mobile controls rather than user-agent text alone', () => {
    const smoke = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web/scripts/mobile_webkit_smoke.mjs'), 'utf8');
    assert(smoke.includes('webkit.launch') && smoke.includes('hasTouch: true'), 'Smoke must actually run WebKit with touch');
    assert(smoke.includes('gonePubgTouchControls') && smoke.includes('fireInsideViewport'), 'FIRE must be operable in phone viewport');
    assert(smoke.includes('#btn-settings') && smoke.includes('#touch-control-settings'), 'WebKit must exercise settings interactions');
  });
}
