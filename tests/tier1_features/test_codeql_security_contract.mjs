import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const codeql = fs.readFileSync(path.join(PROJECT_ROOT, '.github/workflows/codeql.yml'), 'utf8');
  const easy = fs.readFileSync(path.join(PROJECT_ROOT, '.github/workflows/easy-launch-ci.yml'), 'utf8');
  suite.test('CodeQL runs on main and PR heads with pinned scanner actions and SARIF permissions', () => {
    assert(codeql.includes('push:') && codeql.includes('pull_request:') &&
      (codeql.match(/      - main/g) || []).length === 2, 'Both PR and main must trigger code scanning');
    assert(codeql.includes('security-events: write'), 'Scanner must be allowed to publish SARIF results');
    assert(codeql.includes('languages: javascript-typescript') && codeql.includes('build-mode: none'));
    assert(codeql.includes('github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2'));
    assert(codeql.includes('github/codeql-action/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2'));
    assert(codeql.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}'));
  });
  suite.test('Easy-launch cross-platform gate checks exact SHA without persistent checkout credentials', () => {
    assert((easy.match(/actions\/checkout@[0-9a-f]{40}/g) || []).length === 2);
    assert((easy.match(/persist-credentials: false/g) || []).length === 2);
    assert((easy.match(/git rev-parse HEAD/g) || []).length === 2);
    assert(!easy.includes('checkout@v4'));
    assert(easy.includes("- '.github/workflows/easy-launch-ci.yml'"), 'Launcher CI must test its own workflow modifications');
  });
}
