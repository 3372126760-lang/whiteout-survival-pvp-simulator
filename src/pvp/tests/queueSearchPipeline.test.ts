import {describe,expect,it} from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createDefaultInnerEarthConfig, normalizeInnerEarthInput } from "../innerEarth";
import { innerEarthOptimizerInput } from "../optimizer/innerEarthOptimizer";
import { createThreeQueueOptimizationWorkflow,defaultThreeQueueOptimizationOptions,type ThreeQueueOptimizationOptions } from "../optimizer/threeQueueOptimizer";
import { combineQueuePools,queueHeadsDisjoint } from "../optimizer/criterion/queueSearch";
import { IceFireThreeQueueCriterionRunner,ThreeQueueRandomCriterionRunner,sampleQueueCriterion } from "../optimizer/criterion/queueRunners";
import { currentCriterionQueueState } from "../optimizer/criterion/threeQueue";
import { runOptimizationWorkflow,emptyOptimizationPerformance,type EvaluationJob } from "../optimizer/execution";
import { createPersistedEnvelope,restorePersistedConfig } from "../../storage";
import type {ValidationBattleInput} from "../validationUi/types";
const options:ThreeQueueOptimizationOptions={...defaultThreeQueueOptimizationOptions(17),criterionCandidatesPerQueue:4,
  enemyPermutationMode:"fixedCurrent",fixedOwnQueueOrder:true,criterionPairLimit:8,criterionTripleLimit:8,criterionTheoryLimit:4,criterionSchedulerTrials:4,
  lockHeroes:[true,true,true],lockRatios:[true,true,true]};
function ice():ValidationBattleInput {const base=createDefaultValidationInput();return {...base,scenarioType:"ICE_FIRE_LEAGUE",attributeInputMode:"prediction",maxRounds:2,
  sideA:{...base.sideA,threeQueues:base.sideA.threeQueues!.map((q)=>({...q,leaderHeroIds:{},reportHeroByTroop:{},weaponLevels:{}})) as unknown as NonNullable<typeof base.sideA.threeQueues>},
  sideB:{...base.sideB,threeQueues:base.sideB.threeQueues!.map((q)=>({...q,leaderHeroIds:{},reportHeroByTroop:{},weaponLevels:{}})) as unknown as NonNullable<typeof base.sideB.threeQueues>}};}
describe("bounded three-queue search and scheduler strategies",()=>{
  it("bounds pair/triple materialization and rejects repeated generated heroes",()=>{
    const pool=Array.from({length:150},(_,i)=>({queue:{leaderHeroIds:{shield:`head-${i%12}`},ratiosBp:{shield:10000-i*10,lancer:i*10,marksman:0}},score:150-i,coverage:[i,i,i]}));
    const result=combineQueuePools([pool,pool,pool],90,45);
    expect(result.pairCandidates).toBeLessThanOrEqual(90);expect(result.candidates.length).toBeLessThanOrEqual(45);
    expect(result.candidates.length).toBeGreaterThan(0);expect(result.candidates.every((c)=>queueHeadsDisjoint(c.queues))).toBe(true);
    expect(queueHeadsDisjoint([{...pool[0]!.queue},{...pool[0]!.queue}])).toBe(false);
    expect(queueHeadsDisjoint([{...pool[0]!.queue},{...pool[0]!.queue}],[true,true])).toBe(true);
  });
  it("uses fixed cursors versus sampled random alive queues, carrying each troop's survivors",()=>{
    const input=ice(),state=currentCriterionQueueState(input,"A"),enemy=currentCriterionQueueState(input,"B");
    const cursor=IceFireThreeQueueCriterionRunner(input),random=ThreeQueueRandomCriterionRunner(input);
    const fixed=cursor.run(state,enemy,3);expect(fixed.schedulerType).toBe("IceFireLeagueScheduler");
    expect(fixed.battles.length).toBeLessThanOrEqual(5);expect(fixed.matchSequence[0]).toBe("A1-B1");
    for(const [i,duel] of fixed.battles.entries()){
      const next=fixed.battles.slice(i+1).find((d)=>duel.winner==="A"?d.aQueue===duel.aQueue:d.bQueue===duel.bQueue);
      if(next)expect(duel.winner==="A"?next.beforeA:next.beforeB).toEqual(duel.winner==="A"?duel.afterA:duel.afterB);
    }
    const sample=sampleQueueCriterion(random,state,enemy,"A",7,100);
    expect(sample.matchSequenceSamples.length).toBeGreaterThan(1);
    expect(sample.estimatedWinProbability).toBeGreaterThanOrEqual(0);expect(sample.estimatedWinProbability).toBeLessThanOrEqual(1);
    expect(sample.meanRemainingTroops).toBeGreaterThanOrEqual(0);expect(sample.twoQueueFinishRate).toBeLessThanOrEqual(1);
  });
  it.each(["ICE_FIRE_LEAGUE","HEART_OF_EARTH","HERO_LAND"] as const)("%s evaluates only numeric seeds before formal stages, retains baseline and exposes whole-match audit",(mode)=>{
    const input=mode==="ICE_FIRE_LEAGUE"?ice():innerEarthOptimizerInput(normalizeInnerEarthInput(createDefaultValidationInput(),createDefaultInnerEarthConfig(createDefaultValidationInput(),mode)));
    const before=structuredClone(input),jobs:EvaluationJob[]=[];
    const result=runOptimizationWorkflow(createThreeQueueOptimizationWorkflow(input,options),(job)=>{
      jobs.push(job);return {samples:{trials:job.seeds.length,requestedTrials:job.seeds.length,wins:job.seeds.length,losses:0,failedTrials:0,pruned:false,outcomes:[]},performance:{...emptyOptimizationPerformance(),simulatedTrials:job.seeds.length}};
    });
    expect(jobs[0]!.seeds.length).toBe(20);expect(result.formalStages!.map((s)=>s.trials)).toEqual([20,50,100,300,1000]);
    expect(result.topCandidates[0]!.winRate).toBeGreaterThanOrEqual(result.current.winRate);
    expect(result.topCandidates.every((row)=>row.trials===1000)).toBe(true);expect(result.current.isCurrent).toBe(true);
    expect(result.criterionAudit!.schedulerStrategy).toBe(mode==="ICE_FIRE_LEAGUE"?"ICE_FIRE_CURSOR":"RANDOM_ALIVE_QUEUE");
    expect(result.criterionAudit!.tripleCandidates).toBeLessThanOrEqual(8);expect(result.criterionAudit!.theoryTripleCandidates).toBeLessThanOrEqual(4);
    expect(result.criterionAudit!.finalWinRate).toBe(1);expect(input).toEqual(before);
  });
  it("preserves explicitly locked heads and persists all numeric search budgets",()=>{
    const input={...ice(),attributeInputMode:"finalReport" as const};
    const configured={...options,formalStageTrials:[20,100,300],formalStageKeeps:[4,3,2]};
    const restored=restorePersistedConfig(createPersistedEnvelope(input,1000,undefined,undefined,undefined,configured));
    expect(restored.input.attributeInputMode).toBe("finalReport");expect(restored.threeQueueOptimizerOptions).toMatchObject(configured);
    const jobs:EvaluationJob[]=[];
    const result=runOptimizationWorkflow(createThreeQueueOptimizationWorkflow(input,{...options,lockHeroes:[true,true,true]}),(job)=>{
      jobs.push(job);expect(job.input.sideA.threeQueues!.every((q)=>Object.values(q.leaderHeroIds).every((id)=>!id))).toBe(true);
      return {samples:{trials:job.seeds.length,requestedTrials:job.seeds.length,wins:0,losses:job.seeds.length,failedTrials:0,pruned:false,outcomes:[]},performance:emptyOptimizationPerformance()};
    });
    expect(result.current.trials).toBe(1000);expect(jobs.length).toBeGreaterThan(0);
  });
});
