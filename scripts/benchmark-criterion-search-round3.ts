import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { defaultOptimizationConfig,runRallyOptimization } from "../src/pvp/optimizer";
import { restorePersistedConfig } from "../src/storage";
import type { OptimizationInput, OptimizationConfig } from "../src/pvp/optimizer/types";
import { rallyHeadSearchFixture } from "../src/pvp/tests/fixtures/rallyHeadSearch";
function optimizerFingerprint(){
  const files:string[]=[];
  const visit=(directory:string)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())visit(path);else if(entry.name.endsWith(".ts"))files.push(path);}};
  visit("src/pvp/optimizer");files.sort();const hash=createHash("sha256");
  for(const path of files){hash.update(path);hash.update(readFileSync(path));}
  return {fileCount:files.length,sha256:hash.digest("hex")};
}
const base=rallyHeadSearchFixture(),head={shield:"hero.s10.gregory",lancer:"hero.s3.miya",marksman:"hero.s11.rufus"};
const syntheticInput={...base,availableHeroIds:[...Object.values(head),"hero.s11.eleonora","hero.s1.nataliya","hero.s11.lloyd","hero.s1.jinman"],rallyBodyPoolIds:["hero.s5.nuola","hero.s6.wuming","hero.s8.hengdelike","hero.body.shuyun"],
  sideA:{...base.sideA,leaderHeroIds:head,simulationWeaponLevels:Object.fromEntries(Object.values(head).map((id)=>[id,10]))},
  sideB:{...base.sideB,simulationWeaponLevels:Object.fromEntries(Object.values(base.sideB.leaderHeroIds!).map((id)=>[id,10]))}};
// --input accepts a console export or a previous benchmark's input/config pair.
// No supplied export: replay the documented prior-round synthetic fixture.
const inputIndex=process.argv.indexOf("--input"),inputPath=inputIndex<0?null:process.argv[inputIndex+1];
if(inputIndex>=0&&!inputPath)throw new Error("--input requires an export JSON path.");
const payload=inputPath?JSON.parse(readFileSync(inputPath,"utf8")):null;
const restored=payload?.schemaVersion?restorePersistedConfig(payload):null;
const input:OptimizationInput=restored?.input??payload?.input??syntheticInput;
const imported:OptimizationConfig=restored?.optimizationConfig??payload?.config??defaultOptimizationConfig(91);
const config={...imported,objectiveMode:"singleWin" as const,profiling:true},sourceBefore=optimizerFingerprint(),start=performance.now();let last=0;
const result=runRallyOptimization(input,config,(p)=>{if(performance.now()-last>15000||p.completed===p.total){process.stdout.write(`${p.stage}: ${p.completed}/${p.total}\n`);last=performance.now();}});
const wallMs=performance.now()-start;
const sourceAfter=optimizerFingerprint(),optimizerSourceSnapshot={before:sourceBefore,after:sourceAfter,unchanged:sourceBefore.sha256===sourceAfter.sha256};
const previousPath="examples/criterion-search-round2-benchmark.json";
const previous=existsSync(previousPath)?JSON.parse(readFileSync(previousPath,"utf8")) as {wallMs:number;formalRuns:number;profiling:{requestedBattles:number;executedBattles:number;reusedBattles:number};coverage:{stageCoverage:Record<string,{candidates:number;uniqueHeads:number;uniqueBodies:number}>};input:unknown}:null;
const audit=result.searchDiagnostics?.criterionAudit;
if(!audit)throw new Error("Criterion audit missing.");
const comparison=previous?{
  sameSyntheticInput:JSON.stringify(previous.input)===JSON.stringify(input),
  previousSynthetic:{wallMs:previous.wallMs,battleRunsRequested:previous.profiling.requestedBattles,battleRunsExecuted:previous.profiling.executedBattles,battleRunsReused:previous.profiling.reusedBattles,final:previous.coverage.stageCoverage.Final},
  round3:{wallMs,battleRunsRequested:audit.battleRunsRequested,battleRunsExecuted:audit.battleRunsExecuted,battleRunsReused:audit.battleRunsReused,finalCandidates:audit.finalCandidates,uniqueFinalHeads:audit.uniqueFinalHeads,uniqueFinalBodies:audit.uniqueFinalBodies},
  wallReductionPercent:100*(1-wallMs/previous.wallMs),
  formalExecutionReductionPercent:100*(1-reportRuns()/previous.formalRuns),
}:null;
function reportRuns(){return result.performance.simulatedTrials;}
const coreBaselinePath="examples/criterion-round3-core-hashes-before.json";
const coreBaseline=JSON.parse(readFileSync(coreBaselinePath,"utf8")) as Record<string,string>;
const coreChanges=Object.entries(coreBaseline).filter(([path,hash])=>createHash("sha256").update(readFileSync(path)).digest("hex")!==hash).map(([path])=>path);
const coreBoundary={checkedAt:new Date().toISOString(),baseline:coreBaselinePath,fileCount:Object.keys(coreBaseline).length,changedFiles:coreChanges,unchanged:coreChanges.length===0};
writeFileSync("examples/criterion-round3-core-boundary-audit.json",JSON.stringify(coreBoundary,null,2)+"\n");
const comparisonWithUserSummary={comparableSameInput:inputPath!==null,
  note:inputPath?"A supplied export was replayed; confirm its correspondence to the runtime summary.":"User exact export was not supplied. These numerical differences are not a same-config performance comparison.",
  baselineWallMs:182950,baselineExecuted:10465,wallDifferenceMs:wallMs-182950,executedDifference:audit.battleRunsExecuted-10465};
const report={inputPath,comparisonWithUserSummary,recordedAt:new Date().toISOString(),provenance:inputPath?"Supplied export replay, official BattleEngine, recorded cumulative budget and source fingerprints.":"Same prior-round synthetic equal panels, seven head / four body hero pool. Real official BattleEngine, final1000. This is NOT the user183s/fullpool configuration.",input,config,wallMs,
  formalRuns:reportRuns(),coverage:audit,integrity:result.searchDiagnostics?.searchIntegrityReport,profiling:result.searchPerformanceReport,top:result.singleWaveTop,current:result.currentEvaluation,comparison,coreBoundary,optimizerSourceSnapshot};
const encoded=JSON.stringify(report,null,2)+"\n";
writeFileSync(inputPath?"examples/criterion-search-round3-user-benchmark.json":"examples/criterion-search-round3-benchmark.json",encoded);
const summaryKeys=["allLegalHeadCount","effectiveHeroGeneration","recentGenerationWindow","recentEligibleHeadCount","rejectedByRecentGenerationCount","rawHeadRatioCount","retainedHeadRatioCount","headsAfterC0","headsFullyEliminatedAtC0","rawBodyCombinationCount","rejectedBySameEffectFamily","rejectedBySkillDominance","rejectedByProbabilityDominance","rejectedByParetoDominance","rejectedByLowMarginalStacking","preprocessedBodyCount","roughJointEvaluations","matrixCriterionCandidates","deterministicTheoryCandidates","battleEngineCandidates","battleRunsRequested","battleRunsExecuted","battleRunsReused","finalCandidates","uniqueFinalHeads","uniqueFinalBodies","known89StructureReachedFinal","headGenerationTime","headRatioCriterionTime","bodyPreprocessTime","bodyRoughScanTime","matrixCriterionTime","deterministicTheoryTime","battleEngineTime","totalWallTime","warnings"] as const;
process.stdout.write(JSON.stringify({wallMs,audit:Object.fromEntries(summaryKeys.map((key)=>[key,audit[key]])),comparison,best:report.top[0]?.winRate,current:report.current.winRate,coreBoundary},null,2)+"\n");
if(report.profiling!.totalBattleEngineCalls!==report.formalRuns)throw new Error("Profiler formal-call count differs from actual runs.");
if(audit.rawHeadRatioCount!==audit.recentEligibleHeadCount*audit.ratiosPerHead)throw new Error("C0 did not scan all recent-eligible heads and ratios.");
if(audit.headsAfterC0+audit.headsFullyEliminatedAtC0!==audit.recentEligibleHeadCount)throw new Error("C0 head survival accounting differs.");
if(audit.battleRunsExecuted!==report.formalRuns||audit.battleRunsRequested!==audit.battleRunsExecuted+audit.battleRunsReused)throw new Error("Formal request/execution/reuse accounting differs.");
if(!inputPath&&!audit.known89StructureReachedFinal)throw new Error("Known11 shield structure did not reach Final.");
if(report.top.some((c)=>c.trials!==config.verificationTrials)||audit.finalists.some((c)=>c.trials!==config.verificationTrials))throw new Error("Incomplete final verification.");
if(audit.candidatesEliminatedByConfidenceWith5Samples||audit.headsEliminatedByConfidenceWithLessThan20Samples||audit.highUncertaintyEliminatedWithLessThan40Samples)throw new Error("Confidence minimum sample gate violated.");
if(coreChanges.length)throw new Error("Formal battle core changed: "+coreChanges.join(", "));
if(!optimizerSourceSnapshot.unchanged)throw new Error("Optimizer source changed during the measurement; repeat with a stable source snapshot.");
