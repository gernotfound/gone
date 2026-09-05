// tests/e2e_runner.mjs
// Unified E2E Test Suite Runner for G.O.N.E. (Tiers 1 - 4)

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TESTS_ROOT = __dirname;

// CLI Arguments Parsing
const args = process.argv.slice(2);
let selectedTiers = [1, 2, 3, 4];
let verbose = false;

for (const arg of args) {
  if (arg.startsWith('--tier=')) {
    const val = arg.split('=')[1];
    selectedTiers = val.split(',').map((t) => parseInt(t.trim(), 10)).filter((t) => !isNaN(t));
  } else if (arg === '--verbose' || arg === '-v') {
    verbose = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
G.O.N.E. E2E Test Suite Runner
Usage:
  node tests/e2e_runner.mjs [options]

Options:
  --tier=1,2,3,4   Select specific tiers to run (e.g. --tier=1 or --tier=1,2)
  --verbose, -v    Display individual test results and assertion details
  --help, -h       Display this help message
`);
    process.exit(0);
  }
}

const TIER_CONFIGS = [
  {
    tierNum: 1,
    name: 'Tier 1: Feature Coverage',
    dir: path.join(TESTS_ROOT, 'tier1_features'),
    minThreshold: 85,
  },
  {
    tierNum: 2,
    name: 'Tier 2: Boundary & Corner Cases',
    dir: path.join(TESTS_ROOT, 'tier2_boundary'),
    minThreshold: 85,
  },
  {
    tierNum: 3,
    name: 'Tier 3: Cross-Feature Combinations',
    dir: path.join(TESTS_ROOT, 'tier3_combinations'),
    minThreshold: 20,
  },
  {
    tierNum: 4,
    name: 'Tier 4: Real-World Workloads & Scenarios',
    dir: path.join(TESTS_ROOT, 'tier4_workloads'),
    minThreshold: 5,
  },
];

class TestSuiteHarness {
  constructor(suiteName, filePath) {
    this.suiteName = suiteName;
    this.filePath = filePath;
    this.tests = [];
  }

  test(testName, testFn) {
    this.tests.push({ name: testName, fn: testFn });
  }
}

async function runTestFile(filePath, harness) {
  const fileUrl = pathToFileURL(filePath).href;
  const module = await import(fileUrl);
  if (typeof module.run !== 'function') {
    throw new Error(`File ${path.basename(filePath)} does not export a run(suite) function`);
  }
  await module.run(harness);
}

async function main() {
  console.log(`
================================================================================
          G.O.N.E. - E2E TEST SUITE RUNNER (4-TIER RIGOR)
================================================================================
Selected Tiers: [${selectedTiers.join(', ')}] | Verbose Mode: ${verbose ? 'ON' : 'OFF'}
`);

  const globalStartTime = Date.now();
  const tierResults = [];
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const failedTestDetails = [];

  for (const tier of TIER_CONFIGS) {
    if (!selectedTiers.includes(tier.tierNum)) {
      continue;
    }

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`>> Executing ${tier.name}`);
    console.log(`--------------------------------------------------------------------------------`);

    if (!fs.existsSync(tier.dir)) {
      console.error(`[ERROR] Directory not found: ${tier.dir}`);
      continue;
    }

    const files = fs
      .readdirSync(tier.dir)
      .filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))
      .sort();

    let tierTests = 0;
    let tierPassed = 0;
    let tierFailed = 0;
    const tierStartTime = Date.now();

    for (const file of files) {
      const fullPath = path.join(tier.dir, file);
      const harness = new TestSuiteHarness(file, fullPath);

      try {
        await runTestFile(fullPath, harness);
      } catch (importErr) {
        console.error(`  [IMPORT FAIL] ${file}: ${importErr.message}`);
        tierFailed++;
        totalFailed++;
        failedTestDetails.push({ tier: tier.tierNum, file, test: 'Import/Setup', error: importErr });
        continue;
      }

      if (verbose) {
        console.log(`\n  * File: ${file} (${harness.tests.length} tests)`);
      }

      for (const t of harness.tests) {
        tierTests++;
        totalTests++;
        const testStart = Date.now();

        try {
          await t.fn();
          tierPassed++;
          totalPassed++;
          const duration = Date.now() - testStart;
          if (verbose) {
            console.log(`    [PASS] ${t.name} (${duration}ms)`);
          }
        } catch (err) {
          tierFailed++;
          totalFailed++;
          const duration = Date.now() - testStart;
          console.error(`    [FAIL] ${t.name} (${duration}ms)`);
          console.error(`           ${err.message}`);
          failedTestDetails.push({ tier: tier.tierNum, file, test: t.name, error: err });
        }
      }

      if (!verbose) {
        const fileStatus = harness.tests.every(
          (t) => !failedTestDetails.some((f) => f.file === file && f.test === t.name)
        );
        const icon = fileStatus ? '✓' : '✗';
        console.log(`  ${icon} ${file.padEnd(36)} : ${harness.tests.length} tests passed`);
      }
    }

    const tierDuration = Date.now() - tierStartTime;
    tierResults.push({
      tier: `T${tier.tierNum}`,
      name: tier.name,
      total: tierTests,
      passed: tierPassed,
      failed: tierFailed,
      durationMs: tierDuration,
      minRequired: tier.minThreshold,
    });

    console.log(
      `>> Completed ${tier.name}: ${tierPassed}/${tierTests} passed (${tierDuration}ms)\n`
    );
  }

  const globalDuration = Date.now() - globalStartTime;

  // Print Summary Table
  console.log(`
================================================================================
                           FINAL E2E EXECUTION SUMMARY
================================================================================
Tier   Category                                 Total   Passed   Failed  Status
--------------------------------------------------------------------------------`);

  for (const r of tierResults) {
    const status = r.failed === 0 && r.total >= r.minRequired ? 'PASS' : 'FAIL';
    const tierCol = r.tier.padEnd(6);
    const nameCol = r.name.padEnd(40);
    const totCol = String(r.total).padStart(5);
    const passCol = String(r.passed).padStart(8);
    const failCol = String(r.failed).padStart(8);
    const statCol = status.padStart(7);
    console.log(`${tierCol} ${nameCol} ${totCol} ${passCol} ${failCol}  ${statCol}`);
  }

  console.log(`--------------------------------------------------------------------------------`);
  const requiredTotal = selectedTiers.length === 4
    ? 195
    : selectedTiers.reduce((acc, tNum) => {
        const cfg = TIER_CONFIGS.find((c) => c.tierNum === tNum);
        return acc + (cfg ? cfg.minThreshold : 0);
      }, 0);

  const totalStatus = totalFailed === 0 && totalTests >= requiredTotal ? 'PASSED (100%)' : 'FAILED';
  console.log(
    `TOTAL  Selected Tiers                       ${String(totalTests).padStart(5)} ${String(totalPassed).padStart(8)} ${String(totalFailed).padStart(8)}  ${totalStatus}`
  );
  console.log(`Total Execution Time: ${globalDuration}ms`);
  console.log(`================================================================================\n`);

  if (failedTestDetails.length > 0) {
    console.error(`FAILED TESTS BREAKDOWN (${failedTestDetails.length} failures):`);
    for (const f of failedTestDetails) {
      console.error(`  - [T${f.tier} | ${f.file}] ${f.test}`);
      console.error(`    Error: ${f.error.message}\n`);
    }
    process.exit(1);
  } else {
    console.log(`All ${totalTests} E2E tests PASSED successfully! [Exit Code 0]`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal Runner Error:', err);
  process.exit(1);
});
