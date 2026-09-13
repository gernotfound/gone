import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const web = path.join(PROJECT_ROOT, 'game-web');
  const pwa = fs.readFileSync(path.join(web, 'src', 'pwa', 'pwaRuntime.ts'), 'utf-8');
  const worker = fs.readFileSync(path.join(web, 'public', 'gone-cache-sw.js'), 'utf-8');
  const pkg = fs.readFileSync(path.join(web, 'package.json'), 'utf-8');
  const vercel = fs.readFileSync(path.join(web, 'vercel.json'), 'utf-8');
  const generator = fs.readFileSync(path.join(web, 'scripts', 'generate_build_version.mjs'), 'utf-8');
  const resume = fs.readFileSync(path.join(web, 'src', 'mobile', 'mobileSessionResume.ts'), 'utf-8');
  const main = fs.readFileSync(path.join(web, 'src', 'main.ts'), 'utf-8');

  suite.test('Build pipeline emits a commit-derived PWA version beacon', () => {
    assert(pkg.includes('"prebuild": "node scripts/generate_build_version.mjs"'), 'production build must generate version metadata first');
    assert(generator.includes('VERCEL_GIT_COMMIT_SHA') && generator.includes('GITHUB_SHA'), 'build id must use deployment/CI commit SHA');
    assert(generator.includes('public') && generator.includes('version.json'), 'generator must write the public version beacon');
    assert(generator.includes('src') && generator.includes('generated') && generator.includes('buildVersion.ts'), 'generator must write the client build id module');
  });

  suite.test('PWA polls deployment version without browser caches and defers reload during gameplay', () => {
    assert(pwa.includes("cache: 'no-store'"), 'version beacon fetch must bypass browser caches');
    assert(pwa.includes('UPDATE_CHECK_MS = 45_000'), 'PWA must poll for deploy changes on a bounded cadence');
    assert(pwa.includes("document.addEventListener('visibilitychange'") && pwa.includes("window.addEventListener('online'") && pwa.includes("window.addEventListener('focus'"), 'PWA must recheck after foreground/network resume');
    assert(pwa.includes('remoteBuildId === BUILD_ID'), 'PWA must compare remote and embedded build ids');
    assert(pwa.includes('registerWorkerForBuild(remoteBuildId)'), 'new deploy must register a worker keyed to the remote build');
    assert(pwa.includes('liveGameplayActive()') && pwa.includes('safeToReload()'), 'reload must be guarded by active gameplay state');
    assert(pwa.includes('NUOVA VERSIONE PRONTA'), 'in-match update must expose a non-destructive ready notice');
  });

  suite.test('Service worker caches are build-scoped and retain prior generations for open matches', () => {
    assert(worker.includes('gone-pwa-shell-${safeVersion}') && worker.includes('gone-pwa-runtime-${safeVersion}'), 'PWA caches must be keyed by build version');
    assert(worker.includes('MAX_PWA_CACHE_GENERATIONS'), 'worker must retain bounded previous cache generations');
    assert(worker.includes("cache: 'no-store'"), 'navigation refresh must prefer the deployed shell');
    assert(worker.includes('self.skipWaiting()') && worker.includes('self.clients.claim()'), 'worker update must activate promptly');
  });

  suite.test('Vercel disables caching for update-critical PWA files', () => {
    assert(vercel.includes('"source": "/version.json"') && vercel.includes('"source": "/gone-cache-sw.js"'), 'version beacon and worker need explicit response headers');
    assert((vercel.match(/no-store, max-age=0/g) || []).length >= 2, 'both update-critical resources must be no-store');
    assert(vercel.includes('Service-Worker-Allowed'), 'worker scope header must remain explicit');
  });

  suite.test('Mobile resume restarts safe session cadence after background or network transitions', () => {
    for (const hook of ["visibilitychange", "pageshow", "online", "offline", "focus"]) {
      assert(resume.includes(hook), `mobile resume must handle ${hook}`);
    }
    assert(resume.includes('client.startStateTick?.(30)') && resume.includes('client.sendCurrentState?.()'), 'guest cadence must restart and send immediate state');
    assert(resume.includes('host.startSnapshotTick') && resume.includes('goneNetworkQuality'), 'host cadence must resume at the adaptive snapshot rate');
    assert(resume.includes('bindP2PClientNetworking') && resume.includes('onWorldSnapshot'), 'missing client rendering callback must be repairable');
    assert(resume.includes('gone-reconnect-requested'), 'closed mobile sessions must publish a reconnect request instead of silently failing');
    assert(resume.includes('resetInputState()'), 'background/offline transitions must clear held combat/movement input');
  });

  suite.test('Mobile resume starts only after the game runtime exists', () => {
    const client = main.indexOf('startClientRuntime();');
    const resumeStart = main.indexOf("safeStart('mobileSessionResume', startMobileSessionResume);");
    assert(client >= 0 && resumeStart > client, 'mobile session repair must start after goneGame/network runtime initialization');
  });
}
