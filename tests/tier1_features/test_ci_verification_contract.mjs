import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';
import { validateRescueCiContract } from '../../scripts/check_ci_contract.mjs';
import { selectBuildIdentity } from '../../game-web/scripts/build_identity.mjs';

export async function run(suite) {
  const workflow=fs.readFileSync(path.join(PROJECT_ROOT,".github/workflows/rescue-ci.yml"),"utf8");
  const smokeScripts=fs.readdirSync(path.join(PROJECT_ROOT,"game-web/scripts")).filter(p=>p.endsWith("_smoke.mjs")).sort();
  suite.test("Full canonical Rescue CI contract is satisfied",()=>{
    const failures=validateRescueCiContract({workflow,smokeScripts});
    assert(failures.length===0,failures.join("; "));
  });
  suite.test("A PR synthetic-merge checkout fails the contract",()=>{
    const bad=workflow.replace("          ref: ${{ github.event.pull_request.head.sha || github.sha }}","          ref: ${{ github.sha }}");
    assert(validateRescueCiContract({workflow:bad,smokeScripts}).some(x=>x.includes("PR head")),"synthetic PR merge must not pass");
  });
  suite.test("A missing browser smoke fails the contract",()=>{
    const script=smokeScripts[0];
    const bad=workflow.split("\n").filter(line=>!line.includes("run_smoke "+script+" ")).join("\n");
    assert(validateRescueCiContract({workflow:bad,smokeScripts}).some(x=>x.includes(script)),"missing smoke must not pass");
  });
  suite.test("Missing Rust final quality requirement fails the contract",()=>{
    const bad=workflow.replace('test "${{ steps.rust_core.outcome }}" = "success"',"true");
    assert(validateRescueCiContract({workflow:bad,smokeScripts}).some(x=>x.includes("rust_core")),"missing Rust gate must not pass");
  });
  suite.test("PWA identity must represent deployed or actually checked-out commit",()=>{
    assert(selectBuildIdentity({vercelSha:"production",checkoutSha:"head",eventSha:"synthetic"})==="production","Vercel wins");
    assert(selectBuildIdentity({checkoutSha:"head",eventSha:"synthetic"})==="head","real PR head wins");
    assert(selectBuildIdentity({explicitBuildId:"override",checkoutSha:"head"})==="override","local override wins");
    assert(selectBuildIdentity({eventSha:"fallback"})==="fallback","event fallback remains");
  });
  suite.test("E2E runner rejects invalid or duplicated tier choices",()=>{
    for(const arg of ["--tier=999","--tier=","--tier=1,1"]){
      const result=spawnSync(process.execPath,["tests/e2e_runner.mjs",arg],{cwd:PROJECT_ROOT,encoding:"utf8",timeout:3000});
      assert(result.status===1,"Invalid "+arg+" must fail: "+result.stderr);
    }
  });
  suite.test("Tier thresholds and missing suite errors are fatal to E2E results",()=>{
    const source=fs.readFileSync(path.join(PROJECT_ROOT,"tests/e2e_runner.mjs"),"utf8");
    assert(source.includes("unmetThresholds.length > 0 || totalTests < requiredTotal"),"Tier coverage must control runner exit");
    assert(source.includes("Missing suite directory")&&source.includes("Empty test module"),"Empty or missing suite must fail");
  });
}
