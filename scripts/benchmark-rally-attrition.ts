import {writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {rallyHeadSearchFixture,OLD_HEAD} from "../src/pvp/tests/fixtures/rallyHeadSearch";
import {runRallyOptimization,defaultOptimizationConfig,createEnemyQualityMetric,createEngineCandidateRunner,createStageSeeds} from "../src/pvp/optimizer";
const input=rallyHeadSearchFixture(),metric=createEnemyQualityMetric(input);
const common={...defaultOptimizationConfig(91),constraints:{fixedLeaders:OLD_HEAD,fixedBodyExact:true,fixedMemberSkillIds:[]},topN:3,
 jointPipeline:{criterionKeep:1,criterionFineKeep:1,theoryKeep:1,formalRatioKeep:1,
 formalStages:[{trials:20,keep:1},{trials:50,keep:1},{trials:100,keep:1},{trials:300,keep:1}]}};
const output=[];
for(const objectiveMode of ["singleWin","enemyAttrition"] as const){
 const start=performance.now(),result=runRallyOptimization(input,{...common,objectiveMode});
 const wallMs=performance.now()-start;
 const best=result.singleWaveTop[0]!;
 const seeds=createStageSeeds(291024,500,2700000);
 const heldout=createEngineCandidateRunner(input)(best.candidate,seeds);
 output.push({objectiveMode,wallMs,calls:result.performance.simulatedTrials,candidate:best.candidate,
  verificationWinRate:best.winRate,verificationQuality:best.enemyRemainingQuality?.mean,
  heldoutWinRate:heldout.filter(row=>row.outcome==="A").length/heldout.length,
  heldoutEnemyQuality:heldout.reduce((sum,row)=>sum+metric.score(row.enemy),0)/heldout.length});
 process.stdout.write(`${objectiveMode} complete\n`);
}
writeFileSync(new URL("../examples/rally-attrition-benchmark-2026-10-24.json",import.meta.url),JSON.stringify({
 provenance:"Fixed old heads/empty body, real full-rule engine, fixed defender. Same search budgets and 1000 independent final trials; external shared 500-seed holdout. Bounded fixture, no global-optimality claim.",output},null,2));
process.stdout.write(JSON.stringify(output,null,2)+"\n");
