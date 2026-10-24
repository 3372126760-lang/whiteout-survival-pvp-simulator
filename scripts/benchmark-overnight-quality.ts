import {writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {optimizeSimpleScenario,defaultSimpleScenarioOptimizationOptions,applySimpleScenarioCandidate} from "../src/pvp/optimizer/scenarioOptimizer";
import {runRallyOptimization,defaultOptimizationConfig,candidateToInput} from "../src/pvp/optimizer";
import {compileValidationBattle} from "../src/pvp/validationUi/adapter";
import {createStageSeeds} from "../src/pvp/optimizer/seedSet";
import {rallyHeadSearchFixture} from "../src/pvp/tests/fixtures/rallyHeadSearch";
import type {ValidationBattleInput} from "../src/pvp/validationUi/types";
import {rescaleTroop} from "../src/pvp/optimizer/troopAllocation";
const legacySimple=await import(new URL("../.tmp/overnight-baseline/src/pvp/optimizer/scenarioOptimizer.ts",import.meta.url).href);
const legacyRally=await import(new URL("../.tmp/overnight-baseline/src/pvp/optimizer/index.ts",import.meta.url).href);
const original=rallyHeadSearchFixture();
const fixture:ValidationBattleInput={...original,sideA:{...original.sideA,leaderHeroIds:original.sideB.leaderHeroIds!}};
const holdout=createStageSeeds(251024,500,1900000);
function validate(input:ValidationBattleInput){const battle=compileValidationBattle(input);let wins=0;for(const seed of holdout)if(battle.runFastTrial(seed).outcome==="A")wins++;return wins/holdout.length;}
const reports=[];
for(const seed of [91,203]){
 const troopCounts=(side:typeof fixture.sideA)=>({...side,troops:{shield:rescaleTroop(side.troops.shield,18000),lancer:rescaleTroop(side.troops.lancer,7200),marksman:rescaleTroop(side.troops.marksman,10800)}});
 const input:ValidationBattleInput={...fixture,sideA:troopCounts(fixture.sideA),sideB:troopCounts(fixture.sideB),maxRounds:80,scenarioType:"SINGLE",battleContext:"challenge",attributeInputMode:"prediction"};
 const options={...defaultSimpleScenarioOptimizationOptions(seed),fixedHeroes:true,coarseTrials:10,middleTrials:20,verificationTrials:1000,topN:2,
  basinSearch:{maxBasins:1,maxBasinsPerHead:1,maxClimbRounds:1,fineBasins:1,fineRadius:1},
  monteCarloStages:[{trials:5,keep:20},{trials:10,keep:8},{trials:20,keep:2}]};
 const start=performance.now(),old=legacySimple.optimizeSimpleScenario(input,options),oldMs=performance.now()-start;
 const next=performance.now(),current=optimizeSimpleScenario(input,options),newMs=performance.now()-next;
 reports.push({mode:"single",seed,oldMs,newMs,oldCalls:old.performance.simulatedTrials,newCalls:current.performance.simulatedTrials,
  oldWinRate:old.topCandidates[0].winRate,newWinRate:current.topCandidates[0]!.winRate,
  oldHoldout:validate(applySimpleScenarioCandidate(input,"A",old.topCandidates[0].candidate)),newHoldout:validate(applySimpleScenarioCandidate(input,"A",current.topCandidates[0]!.candidate)),
  oldCandidate:old.topCandidates[0].candidate,newCandidate:current.topCandidates[0]!.candidate});
 process.stdout.write(`single seed ${seed} complete\n`);
}
const rally={...fixture,maxRounds:80};
const config={...defaultOptimizationConfig(91),objectiveMode:"singleWin" as const,topN:2,constraints:{fixedBodyExact:true,fixedMemberSkillIds:[]},
 jointPipeline:{criterionKeep:20,criterionFineKeep:10,theoryKeep:6,formalRatioKeep:2,
 formalStages:[{trials:20,keep:4},{trials:50,keep:3},{trials:100,keep:2},{trials:300,keep:2}]},verificationTrials:1000};
const start=performance.now(),old=legacyRally.runRallyOptimization(rally,config),oldMs=performance.now()-start;
const next=performance.now(),current=runRallyOptimization(rally,config),newMs=performance.now()-next;
reports.push({mode:"rally",seed:91,oldMs,newMs,oldCalls:old.performance.simulatedTrials,newCalls:current.performance.simulatedTrials,
 oldWinRate:old.singleWaveTop[0].winRate,newWinRate:current.singleWaveTop[0]!.winRate,
 oldHoldout:validate(candidateToInput(rally,old.singleWaveTop[0].candidate)),newHoldout:validate(candidateToInput(rally,current.singleWaveTop[0]!.candidate)),
 oldCandidate:old.singleWaveTop[0].candidate,newCandidate:current.singleWaveTop[0]!.candidate});
writeFileSync(new URL("../.tmp/overnight-quality-balanced.json",import.meta.url),JSON.stringify({provenance:"Bounded synthetic fixtures, unchanged real engine. 500 shared heldout seeds outside all search budgets. Not a global optimality or full hero-domain benchmark.",reports},null,2));
process.stdout.write(JSON.stringify(reports.map(({mode,seed,oldMs,newMs,oldCalls,newCalls,oldHoldout,newHoldout})=>({mode,seed,oldMs,newMs,oldCalls,newCalls,oldHoldout,newHoldout})),null,2));
