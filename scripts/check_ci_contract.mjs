import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateRescueCiContract({workflow,smokeScripts}) {
  const problems=[];
  const need=(name,re)=>{if(!re.test(workflow))problems.push(name)};
  const triggers=workflow.split(/^jobs:\s*$/m)[0];
  if(!/^  pull_request:\s*$/m.test(triggers)||!/^      - main\s*$/m.test(triggers))problems.push("Pull requests to main must trigger Rescue CI");
  if(!/^  push:\s*$/m.test(triggers)||!/^      - main\s*$/m.test(triggers))problems.push("Pushes to main must trigger Rescue CI");
  if(/^\s*pull_request_target\s*:/m.test(workflow))problems.push("Privileged pull_request_target is forbidden");
  need("Checkout must pin immutable action SHA",/^\s+uses: actions\/checkout@[0-9a-f]{40}\b/m);
  need("Checkout must select PR head",/^          ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m);
  need("Checkout must drop credentials",/^          persist-credentials: false\s*$/m);
  need("Checkout must inspect real HEAD",/actual_sha="\$\(git rev-parse HEAD\)"/);
  need("Checkout must verify event SHA",/if \[ "\$\{actual_sha\}" != "\$\{EXPECTED_SHA\}" \]; then/);
  need("Expected SHA must bind PR head or push",/EXPECTED_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  need("CI contract checker must run",/run: node scripts\/check_ci_contract\.mjs/);
  need("Static source health gate must run",/run: node scripts\/check_source_health\.mjs/);
  need("Export liveness audit must run",/run: node scripts\/audit_export_usage\.mjs rescue-unused-exports\.json/);
  need("Full Vite+TS build must run",/npm run build --prefix game-web/);
  need("All E2E tiers must run",/node tests\/e2e_runner\.mjs/);
  need("Rust tests must run",/cargo test --manifest-path game-core\/Cargo\.toml/);
  need("npm ci must install locked web dependencies",/npm ci --prefix game-web/);
  need("High severity dependency audit must run",/npm audit --prefix game-web --audit-level=high/);
  need("Final quality gate runs on failures",/name: Final quality gate\s*\n\s*if: always\(\)/);
  for(const id of ["web_audit","legacy_e2e","browser_smoke","rust_core"]){
    if(!workflow.includes('test "${{ steps.'+id+'.outcome }}" = "success"')) problems.push("Final quality gate must require "+id);
  }
  for(const m of workflow.matchAll(/^\s*uses: (actions\/[\w-]+)@([^\s#]+)/gm)){
    if(!/^[0-9a-f]{40}$/.test(m[2]))problems.push("Unpinned GitHub Action "+m[1]);
  }
  const configured=[...workflow.matchAll(/^\s+run_smoke ([a-z0-9_]+\.mjs)\s+\S+/gm)].map(m=>m[1]);
  if(new Set(configured).size!==configured.length)problems.push("Duplicate smoke invocation");
  for(const script of smokeScripts)if(!configured.includes(script))problems.push("Missing smoke: "+script);
  for(const script of configured)if(!smokeScripts.includes(script))problems.push("Nonexistent smoke: "+script);
  need("Browser smoke must propagate exit status",/local status=\$\{PIPESTATUS\[0\]\}/);
  need("Browser smoke failures cannot be swallowed",/return "\$\{status\}"/);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const workflow = readFileSync(path.join(root, '.github/workflows/rescue-ci.yml'), 'utf8');
  const smokeScripts = readdirSync(path.join(root, 'game-web/scripts'))
    .filter(file => file.endsWith('_smoke.mjs')).sort();
  const problems = validateRescueCiContract({ workflow, smokeScripts });
  if (problems.length) {
    console.error('Rescue CI contract violations:');
    for (const problem of problems) console.error('- ' + problem);
    process.exitCode = 1;
  } else {
    console.log('Rescue CI contract OK: exact-SHA checkout and ' + smokeScripts.length + ' browser smoke suites.');
  }
}
