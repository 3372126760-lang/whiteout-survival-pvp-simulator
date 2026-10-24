import {expect,it} from "vitest";
import {createEnemyQualityMetric,compareEnemyAttrition,shouldSuggestEnemyAttrition} from "../optimizer/enemyAttrition";
import {rallyHeadSearchFixture,OPPONENT_HEAD} from "./fixtures/rallyHeadSearch";
import {TROOP_TYPES} from "../types";
import {defaultOptimizationConfig,createRallyOptimizationWorkflow,verifyRallyCandidate} from "../optimizer";
import {createEvaluationExecutor,runOptimizationWorkflow,emptyOptimizationPerformance} from "../optimizer/execution";
import {candidateKey} from "../optimizer/candidateGenerator";
import type {FastBattleResult} from "../battle/fastBattleMode";
import {createPersistedEnvelope,restorePersistedConfig} from "../../storage";
import type {CandidateEvaluation} from "../optimizer/types";

it("scores zero/full survivors and distinguishes equal counts with different combat quality",()=>{
 const input=rallyHeadSearchFixture(),before=JSON.stringify(input),metric=createEnemyQualityMetric(input);
 expect(metric.score({shield:0,lancer:0,marksman:0})).toBe(0);
 const types=[...TROOP_TYPES].sort((a,b)=>metric.weights[a]-metric.weights[b]);
 const count=(type:typeof TROOP_TYPES[number])=>({shield:0,lancer:0,marksman:0,[type]:10});
 expect(metric.score(count(types[2]!))).toBeGreaterThan(metric.score(count(types[0]!)));
 expect(metric.score({shield:18000,lancer:7200,marksman:10800})).toBeCloseTo(100);
 expect(JSON.stringify(input)).toBe(before);
});
it("makes remaining quality the primary objective even when win rate is lower",()=>{
 const row=(quality:number,winRate:number)=>({enemyRemainingQuality:{mean:quality},winRate,enemyRemaining:{total:{mean:100}}}) as CandidateEvaluation;
 expect(compareEnemyAttrition(row(10,0),row(50,.25))).toBeLessThan(0);
 expect(compareEnemyAttrition(row(10,.25),row(10,0))).toBeLessThan(0);
});
it("suggests only strictly below 30%, with no better baseline or alternate finalist",()=>{
 const value=(rates:number[])=>({selectedMode:"singleWin",singleWaveTop:rates.map(winRate=>({winRate}))});
 expect(shouldSuggestEnemyAttrition(value([.29,.2]))).toBe(true);
 expect(shouldSuggestEnemyAttrition(value([.3,.2]))).toBe(false);
 expect(shouldSuggestEnemyAttrition(value([.2,.4]))).toBe(false);
 expect(shouldSuggestEnemyAttrition({...value([.2]),currentEvaluation:{winRate:.4}})).toBe(false);
 expect(shouldSuggestEnemyAttrition({...value([.1]),selectedMode:"enemyAttrition"})).toBe(false);
 expect(shouldSuggestEnemyAttrition(value([]))).toBe(false);
});
it("preserves the new optional objective through storage",()=>{
 const result=restorePersistedConfig(createPersistedEnvelope(rallyHeadSearchFixture(),100,{...defaultOptimizationConfig(),objectiveMode:"enemyAttrition"}));
 expect(result.optimizationConfig.objectiveMode).toBe("enemyAttrition");
});
it("uses quality throughout formal screening and final ranking rather than just relabeling win rate",()=>{
 const input=rallyHeadSearchFixture(),execute=createEvaluationExecutor();let first="";
 const config={...defaultOptimizationConfig(91),objectiveMode:"enemyAttrition" as const,topN:3,
  constraints:{fixedLeaders:OPPONENT_HEAD,fixedBodyExact:true,fixedMemberSkillIds:[]},
  jointPipeline:{criterionKeep:1,criterionFineKeep:1,theoryKeep:1,formalRatioKeep:1,
  formalStages:[{trials:20,keep:1},{trials:50,keep:1},{trials:100,keep:1},{trials:300,keep:1}]}};
 const result=runOptimizationWorkflow(createRallyOptimizationWorkflow(input,config),job=>{
  if(job.kind!=="battle")return execute(job);
  first||=candidateKey(job.rallyCandidate!);
  const damageOnly=candidateKey(job.rallyCandidate!)!==first;
  const outcomes=job.seeds.map(seed=>{const win=!damageOnly&&seed%5===0;return {outcome:win?"A" as const:"B" as const,roundCount:10,
   remaining:{A:{shield:0,lancer:0,marksman:win?1:0},B:{shield:win?0:damageOnly?1:1000,lancer:0,marksman:0}}} as FastBattleResult;});
  return {samples:{trials:outcomes.length,requestedTrials:outcomes.length,wins:outcomes.filter(o=>o.outcome==="A").length,losses:outcomes.filter(o=>o.outcome==="B").length,failedTrials:0,pruned:false,outcomes},performance:{...emptyOptimizationPerformance(),simulatedTrials:outcomes.length}};
 });
 expect(result.selectedMode).toBe("enemyAttrition");
 expect(result.optimizationContext?.optimizationObjective).toBe("minEnemyRemainingQuality");
 expect(result.singleWaveTop[0]!.winRate).toBe(0);
 expect(result.singleWaveTop[0]!.enemyRemaining.shield.mean).toBe(1);
 expect(result.singleWaveTop.every(row=>Number.isFinite(row.enemyRemainingQuality?.mean))).toBe(true);
 expect(result.searchDiagnostics?.searchIntegrityReport?.final.screeningRuns).toBeGreaterThan(0);
},15000);
it("reverification reports quality from the same actual battle samples",()=>{
 const input={...rallyHeadSearchFixture(),maxRounds:2};
 const candidate={leaderHeroIds:OPPONENT_HEAD,memberSkillIds:[],ratios:{shield:50,lancer:20,marksman:30}};
 const result=verifyRallyCandidate(input,candidate,3,91,"A","enemyAttrition");
 const metric=createEnemyQualityMetric(input);
 const expected=100*TROOP_TYPES.reduce((n,t)=>n+result.enemyRemaining[t].mean*metric.weights[t],0)/metric.initial;
 expect(result.enemyRemainingQuality?.mean).toBeCloseTo(expected);
});
