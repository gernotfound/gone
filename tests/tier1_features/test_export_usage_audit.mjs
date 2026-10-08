import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';
import { auditExportUsage } from '../../scripts/audit_export_usage.mjs';

export async function run(suite) {
  suite.test('Unused export audit distinguishes imported public symbols from orphan named exports', () => {
    const root = path.resolve('/virtual/gone/game-web/src');
    const file = path.join(root, 'feature.ts');
    const sources = new Map([
      [path.join(root, 'main.ts'), "import { active } from './feature.ts'; void active;"],
      [file, 'export const active = 1; export const orphan = 2;'],
    ]);
    const findings = auditExportUsage(sources, root);
    assert(findings.length === 1 && findings[0].name === 'orphan', 'Only unreferenced symbol is a candidate');
  });

  suite.test('Test harness imports and namespace consumers protect intentional external APIs', () => {
    const root = path.resolve('/virtual/gone/game-web/src');
    const moduleFile = path.join(root, 'feature.ts');
    const sources = new Map([
      [moduleFile, 'export const testApi = 1; export const namespaceApi = 2;'],
      [path.resolve('/virtual/gone/tests/test.mjs'), "import { testApi } from '../game-web/src/feature.ts';"],
      [path.join(root, 'main.ts'), "import * as features from './feature.ts'; console.log(features.namespaceApi);"],
    ]);
    assert(auditExportUsage(sources, root).length === 0, 'Public test imports and namespace use must be accounted for');
  });

  suite.test('Canonical CI publishes the full audit without weakening unused-module hard failures', () => {
    const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github/workflows/rescue-ci.yml'), 'utf8');
    const contract = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts/check_ci_contract.mjs'), 'utf8');
    assert(workflow.includes('node scripts/check_source_health.mjs'), 'Unreachable module gate remains mandatory');
    assert(workflow.includes('node scripts/audit_export_usage.mjs rescue-unused-exports.json'), 'Export audit must run');
    assert(workflow.includes('name: rescue-unused-exports'), 'Complete report must be available as artifact');
    assert(contract.includes('Export liveness audit must run'), 'CI contract must reject removing export audit');
  });
}
