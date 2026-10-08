import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';
import {
  collectRelativeDependencies,
  findUnreachableModules,
  unsafeSourcePatterns,
} from '../../scripts/check_source_health.mjs';
import { createRequire } from 'node:module';

const requireFromWeb = createRequire(path.join(PROJECT_ROOT, 'game-web', 'package.json'));
const ts = requireFromWeb('typescript');
const parse = (source) => ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);

export async function run(suite) {
  suite.test('Graph includes static imports, reexports and literal dynamic imports', () => {
    const imports = collectRelativeDependencies(parse(
      "import './a.ts'; export { thing } from './b.ts'; void import('./c.ts');",
    ));
    assert(imports.length === 3 && imports.includes('./a.ts') && imports.includes('./b.ts') && imports.includes('./c.ts'));
  });

  suite.test('Graph identifies orphan modules rather than ignoring unreachable files', () => {
    const graph = new Map([['main', ['used']], ['used', []], ['orphan', []]]);
    const unreachable = findUnreachableModules(graph, ['main']);
    assert(unreachable.length === 1 && unreachable[0] === 'orphan');
  });

  suite.test('Static checker rejects eval and Function-constructor source', () => {
    const findings = unsafeSourcePatterns(parse("eval('1'); new Function('return 1');"));
    assert(findings.length === 2);
    assert(unsafeSourcePatterns(parse("const value = 1 + 1;")).length === 0);
  });

  suite.test('Mobile runtime reconciles through typed owner, not window facade', () => {
    const main = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web/src/main.ts'), 'utf8');
    const owner = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web/src/mobile/pubgTouchControls.ts'), 'utf8');
    assert(main.includes('reconcile: reconcilePubgTouchControls'), 'typed owner must compose runtime reconciliation');
    assert(!main.includes('gonePubgTouchControls?.rebind'), 'global facade must not be an internal dependency');
    assert(owner.includes('export function reconcilePubgTouchControls()'), 'owner must export explicit operation');
    assert(owner.includes('rebind: attachWhenAvailable'), 'public facade compatibility must remain');
  });

  suite.test('Rescue CI includes mandatory static source-health gate', () => {
    const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github/workflows/rescue-ci.yml'), 'utf8');
    const contract = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts/check_ci_contract.mjs'), 'utf8');
    assert(workflow.includes('node scripts/check_source_health.mjs'));
    assert(contract.includes('Static source health gate must run'));
  });
}
