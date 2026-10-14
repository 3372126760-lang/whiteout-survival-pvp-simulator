import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { defaultOptimizationConfig,runRallyOptimization } from "../src/pvp/optimizer";
import { rallyHeadSearchFixture } from "../src/pvp/tests/fixtures/rallyHeadSearch";
function optimizerFingerprint(){
  const files:string[]=[];
  const visit=(directory:string)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())visit(path);else if(entry.name.endsWith(".ts"))files.push(path);}};
  visit("src/pvp/optimizer");files.sort();const hash=createHash("sha256");
  for(const path of files){hash.update(path);hash.update(readFileSync(path));}
  return {fileCount:files.length,sha256:hash.digest("hex")};
}
const base=rallyHeadSearchFixture(),head={shield:"hero.s10.gregory",lancer:"hero.s3.miya",marksman:"hero.s11.rufus"};
const input={...base,availableHeroIds:[...Object.values(head),"hero.s11.eleonora","hero.s1.nataliya","hero.s11.lloyd","hero.s1.jinman"],rallyBodyPoolIds:["hero.s5.nuola","hero.s6.wuming","hero.s8.hengdelike","hero.body.shuyun"],
  sideA:{...base.sideA,leaderHeroIds:head,simulationWeaponLevels:Object.fromEntries(Object.values(head).map((id)=>[id,10]))},
  sideB:{...base.sideB,simulationWeaponLevels:Object.fromEntries(Object.values(base.sideB.leaderHeroIds!).map((id)=>[id,10]))}};
const config={...defaultOptimizationConfig(91),objectiveMode:"singleWin" as const,profiling:true},sourceBefore=optimizerFingerprint(),start=performance.now();let last=0;
const result=runRallyOptimization(input,config,(p)=>{if(performance.now()-last>15000||p.completed===p.total){process.stdout.write(`${p.stage}: ${p.completed}/${p.total}\n`);last=performance.now();}});
const wallMs=performance.now()-start;
const sourceAfter=optimizerFingerprint(),optimizerSourceSnapshot={before:sourceBefore,after:sourceAfter,unchanged:sourceBefore.sha256===sourceAfter.sha256};
const previousPath="examples/criterion-search-round1-benchmark.json";
const previous=existsSync(previousPath)?JSON.parse(readFileSync(previousPath,"utf8")) as {wallMs:number;formalRuns:number;profiling:{requestedBattles:number;executedBattles:number;reusedBattles:number};coverage:{stageCoverage:Record<string,{candidates:number;uniqueHeads:number;uniqueBodies:number}>};input:unknown}:null;
const audit=result.searchDiagnostics?.criterionAudit;
if(!audit)throw new Error("Criterion audit missing.");
const comparison=previous?{
  sameSyntheticInput:JSON.stringify(previous.input)===JSON.stringify(input),
  round1:{wallMs:previous.wallMs,battleRunsRequested:previous.profiling.requestedBattles,battleRunsExecuted:previous.profiling.executedBattles,battleRunsReused:previous.profiling.reusedBattles,final:previous.coverage.stageCoverage.Final},
  round2:{wallMs,battleRunsRequested:audit.battleRunsRequested,battleRunsExecuted:audit.battleRunsExecuted,battleRunsReused:audit.battleRunsReused,finalCandidates:audit.finalCandidates,uniqueFinalHeads:audit.uniqueFinalHeads,uniqueFinalBodies:audit.uniqueFinalBodies},
  wallReductionPercent:100*(1-wallMs/previous.wallMs),
  formalExecutionReductionPercent:100*(1-reportRuns()/previous.formalRuns),
}:null;
function reportRuns(){return result.performance.simulatedTrials;}
const coreBaselinePath="examples/criterion-round2-core-hashes-before.json";
const coreBaseline=JSON.parse(readFileSync(coreBaselinePath,"utf8")) as Record<string,string>;
const coreChanges=Object.entries(coreBaseline).filter(([path,hash])=>createHash("sha256").update(readFileSync(path)).digest("hex")!==hash).map(([path])=>path);
const coreBoundary={checkedAt:new Date().toISOString(),baseline:coreBaselinePath,fileCount:Object.keys(coreBaseline).length,changedFiles:coreChanges,unchanged:coreChanges.length===0};
writeFileSync("examples/criterion-round2-core-boundary-audit.json",JSON.stringify(coreBoundary,null,2)+"\n");
const report={recordedAt:new Date().toISOString(),provenance:"Synthetic equal panels, seven head heroes / four teammate body heroes. Real official BattleEngine, shared seeds, final1000. Includes both known manual structures; observed wins are NOT the user's 79.5/89.8 case.",input,config,wallMs,
  formalRuns:reportRuns(),coverage:audit,integrity:result.searchDiagnostics?.searchIntegrityReport,profiling:result.searchPerformanceReport,top:result.singleWaveTop,current:result.currentEvaluation,comparison,coreBoundary,optimizerSourceSnapshot};
const encoded=JSON.stringify(report,null,2)+"\n";
writeFileSync("examples/criterion-search-benchmark.json",encoded);writeFileSync("examples/criterion-search-round2-benchmark.json",encoded);
const summaryKeys=["allLegalHeadCount","effectiveHeroGeneration","recentGenerationWindow","recentEligibleHeadCount","rejectedByRecentGenerationCount","rawHeadRatioCount","retainedHeadRatioCount","headsAfterC0","headsFullyEliminatedAtC0","rawBodyCombinationCount","rejectedBySameEffectFamily","rejectedBySkillDominance","rejectedByProbabilityDominance","rejectedByParetoDominance","rejectedByLowMarginalStacking","preprocessedBodyCount","roughJointEvaluations","matrixCriterionCandidates","deterministicTheoryCandidates","battleEngineCandidates","battleRunsRequested","battleRunsExecuted","battleRunsReused","finalCandidates","uniqueFinalHeads","uniqueFinalBodies","known89StructureReachedFinal","headGenerationTime","headRatioCriterionTime","bodyPreprocessTime","bodyRoughScanTime","matrixCriterionTime","deterministicTheoryTime","battleEngineTime","totalWallTime","warnings"] as const;
process.stdout.write(JSON.stringify({wallMs,audit:Object.fromEntries(summaryKeys.map((key)=>[key,audit[key]])),comparison,best:report.top[0]?.winRate,current:report.current.winRate,coreBoundary},null,2)+"\n");
if(report.profiling!.totalBattleEngineCalls!==report.formalRuns)throw new Error("Profiler formal-call count differs from actual runs.");
if(audit.rawHeadRatioCount!==audit.recentEligibleHeadCount*231)throw new Error("C0 did not scan all recent-eligible heads and ratios.");
if(audit.headsAfterC0+audit.headsFullyEliminatedAtC0!==audit.recentEligibleHeadCount)throw new Error("C0 head survival accounting differs.");
if(audit.battleRunsExecuted!==report.formalRuns||audit.battleRunsRequested!==audit.battleRunsExecuted+audit.battleRunsReused)throw new Error("Formal request/execution/reuse accounting differs.");
if(!audit.known89StructureReachedFinal)throw new Error("Known11 shield structure did not reach Final.");
if(report.top.some((c)=>c.trials!==1000)||audit.finalists.some((c)=>c.trials!==1000))throw new Error("Incomplete final verification.");
if(coreChanges.length)throw new Error("Formal battle core changed: "+coreChanges.join(", "));
if(!optimizerSourceSnapshot.unchanged)throw new Error("Optimizer source changed during the measurement; repeat with a stable source snapshot.");
