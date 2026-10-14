import { TROOP_TYPES, type SideId } from "../../types";
import { createThreeQueueScheduler, allocateThreeQueueTroops,
  type ThreeQueueScheduler, type ThreeQueueMode, type ThreeQueueSchedulerType } from "../../scenario";
import { getValidationThreeQueues, type ValidationBattleInput, type ValidationSideInput, type ValidationQueueConfig } from "../../validationUi";
import { normalizeIceFireReportLineage, captureQueueReportBaseline } from "../../validationUi/queueReportLineage";
import { queueConversionSide } from "../../validationUi/queueConversion";
import { isIceFireInput } from "../../validationUi/iceFireContext";
import { rescaleTroop } from "../troopAllocation";
import { optimizerHeadWeaponLevels } from "../heroPools";
import type { ThreeQueueOptimizationState, ThreeQueueCandidateQueue } from "../threeQueueOptimizer";
import { createCriterionTemplate } from "./compiler";
import { innerEarthEnemyCounts } from "../../innerEarth/config";
import { criterionBattle } from "./solver";
import type { CriterionTemplate, Triple } from "./types";
import { createTheoryTemplateBuilder } from "../theory/templateBuilder";
import { defaultTheoryOptions, type TheoryTemplate } from "../theory/types";
import { estimateDeterministicBattle } from "../theory/deterministicBattleEstimator";
const keys={A:"sideA",B:"sideB"} as const;
export interface CriterionQueueAudit {
  readonly schedulerRule:ThreeQueueScheduler["rule"]; readonly schedulerStatus:ThreeQueueScheduler["ruleStatus"];
  readonly threeQueueMode: ThreeQueueMode;
  readonly schedulerType: ThreeQueueSchedulerType;
  readonly queueCursorA: number | null;
  readonly queueCursorB: number | null;
  readonly cursorHistoryA: readonly (number | null)[];
  readonly cursorHistoryB: readonly (number | null)[];
  readonly matchSequence: readonly string[];
  readonly pairwiseMargins: readonly (readonly number[])[];
  readonly battles: readonly { aQueue:number;bQueue:number;beforeA:Triple;beforeB:Triple;afterA:Triple;afterB:Triple;winner:SideId }[];
  readonly winner:SideId;readonly remainingA:readonly Triple[];readonly remainingB:readonly Triple[];readonly uncertainty:number;
}
function queueSide(side:ValidationSideInput,queue:ValidationQueueConfig,selected:ThreeQueueCandidateQueue,input:ValidationBattleInput,sideId:SideId):ValidationSideInput {
  void side;
  const source = captureQueueReportBaseline(queue);
  const converted = queueConversionSide(input, sideId, { ...source, leaderHeroIds: selected.leaderHeroIds,
    weaponLevels: selected.headWeaponLevels ?? optimizerHeadWeaponLevels(input,selected.leaderHeroIds,sideId) });
  return { ...converted,
    troops:Object.fromEntries(TROOP_TYPES.map((t)=>{
      const troop={...converted.troops[t],count:10000};
      delete troop.levelComposition;troop.levelMode="single";
      if(queue.troopLevelCompositions?.[t]){troop.levelComposition=queue.troopLevelCompositions[t];troop.levelMode="mixed";}
      return [t,rescaleTroop(troop,10000)];
    })) as ValidationSideInput["troops"]} as ValidationSideInput;
}
export function currentCriterionQueueState(input:ValidationBattleInput,side:SideId):ThreeQueueOptimizationState {
  return {queues:getValidationThreeQueues(input[keys[side]]).map((q,index)=>({sourceQueueIndex:index,leaderHeroIds:q.leaderHeroIds,headWeaponLevels:q.weaponLevels??input[keys[side]].simulationWeaponLevels??{},
    ratiosBp:{shield:q.ratios.shield*100,lancer:q.ratios.lancer*100,marksman:q.ratios.marksman*100}})) as unknown as ThreeQueueOptimizationState["queues"]};
}
/** Pair templates are shared over ratios and scheduler seeds. Remaining counts
 * are passed to the shared CriterionBattle on every duel, never reset after wins. */
export function createCriterionThreeQueueEvaluator(input:ValidationBattleInput, kernel: "criterion" | "theory" = "criterion") {
  input = normalizeIceFireReportLineage(input);
  if(input.scenarioType==="ICE_FIRE_LEAGUE")input={...input,threeQueueMode:"ICE_FIRE_LEAGUE"};
  const queuesA=getValidationThreeQueues(input.sideA),queuesB=getValidationThreeQueues(input.sideB), cache=new Map<string,CriterionTemplate>(), matchups=new Map<string,readonly (readonly number[])[]>();
  const theoryCache = new Map<string, TheoryTemplate>();
  const duelCache = new Map<string, ReturnType<typeof criterionBattle>>();
  const headKeys = new WeakMap<ThreeQueueCandidateQueue, string>();
  const headKey = (queue: ThreeQueueCandidateQueue) => {
    let key = headKeys.get(queue);
    if (key === undefined) { key = JSON.stringify([queue.sourceQueueIndex, queue.leaderHeroIds, queue.headWeaponLevels]); headKeys.set(queue, key); }
    return key;
  };
  const buildTheory = kernel === "theory" ? createTheoryTemplateBuilder({ ...defaultTheoryOptions(), deterministicRounds: Math.min(64,input.maxRounds) }) : undefined;
  const pair=(a:ThreeQueueCandidateQueue,b:ThreeQueueCandidateQueue,ai:number,bi:number)=>{
    const key=`${ai}/${bi}/${headKey(a)}/${headKey(b)}`;let template=cache.get(key);
    if(!template){template=createCriterionTemplate({...input,scenarioType:"SINGLE",battleContext:"challenge",attributeInputMode: isIceFireInput(input) ? "prediction" : input.attributeInputMode ?? "finalReport",
      sideA:queueSide(input.sideA,queuesA[a.sourceQueueIndex ?? ai]!,a,input,"A"),sideB:queueSide(input.sideB,queuesB[b.sourceQueueIndex ?? bi]!,b,input,"B")});cache.set(key,template);}
    return template;
  };
  const initial=(state:ThreeQueueOptimizationState,side:ValidationSideInput)=>state.queues.map((q)=>{
    const count=input.innerEarth&&side===input.sideB
      ?innerEarthEnemyCounts(input.innerEarth.enemy.shared.capacity,input.innerEarth.enemy.shared.troopRatioPreset)
      :allocateThreeQueueTroops(side.deploymentCapacity??TROOP_TYPES.reduce((n,t)=>n+side.troops[t].count,0),q.ratiosBp);
    return TROOP_TYPES.map((t)=>count[t]) as unknown as Triple;});
  const duel = (a:ThreeQueueCandidateQueue,b:ThreeQueueCandidateQueue,ai:number,bi:number,beforeA:Triple,beforeB:Triple) => {
    if (buildTheory === undefined) {
      const key = `${ai}/${bi}/${headKey(a)}/${headKey(b)}/${beforeA.join()}/${beforeB.join()}`;
      const cached = duelCache.get(key);
      if (cached !== undefined) return cached;
      const result = criterionBattle(pair(a,b,ai,bi),beforeA,beforeB);
      duelCache.set(key,result);
      if (duelCache.size > 20000) duelCache.delete(duelCache.keys().next().value!);
      return result;
    }
    const key = JSON.stringify([ai,bi,headKey(a),headKey(b)]);
    let template = theoryCache.get(key);
    if (template === undefined) {
      template = buildTheory({ ...input, scenarioType: "SINGLE", battleContext: "challenge", attributeInputMode: isIceFireInput(input) ? "prediction" : input.attributeInputMode ?? "finalReport",
        sideA: queueSide(input.sideA,queuesA[a.sourceQueueIndex ?? ai]!,a,input,"A"), sideB: queueSide(input.sideB,queuesB[b.sourceQueueIndex ?? bi]!,b,input,"B") });
      theoryCache.set(key,template);
    }
    const totalA = beforeA.reduce((n,v)=>n+v,0), totalB = beforeB.reduce((n,v)=>n+v,0);
    const result = estimateDeterministicBattle({ ...template,
      sideA: { ...template.sideA, counts: beforeA, total: totalA },
      sideB: { ...template.sideB, counts: beforeB, total: totalB } }, beforeA.map((v)=>v * 100 / Math.max(1,totalA)));
    return { predictedWinner: result.horizonReached ? "unresolved" as const : result.score > 0 ? "A" as const : "B" as const,
      margin: result.score, uncertainty: result.horizonReached ? .6 : .2,
      aRemaining: Object.fromEntries(TROOP_TYPES.map((t,i)=>[t,result.counts[0]![i]!])) as Record<typeof TROOP_TYPES[number],number>,
      bRemaining: Object.fromEntries(TROOP_TYPES.map((t,i)=>[t,result.counts[1]![i]!])) as Record<typeof TROOP_TYPES[number],number> };
  };
  return { cache, theoryCache,
    matchup:(a:ThreeQueueCandidateQueue,b:ThreeQueueCandidateQueue,ai:number,bi:number)=>duel(a,b,ai,bi,initial({queues:[a,a,a]},input.sideA)[0]!,initial({queues:[b,b,b]},input.sideB)[0]!),
    run:(a:ThreeQueueOptimizationState,b:ThreeQueueOptimizationState,seed:number,activeACount=3,activeBCount=3):CriterionQueueAudit=>{
      const remainingA=initial(a,input.sideA),remainingB=initial(b,input.sideB), aliveA=[0,1,2].slice(0,activeACount),aliveB=[0,1,2].slice(0,activeBCount), scheduler=createThreeQueueScheduler(seed,input.threeQueueMode,
        {attacker:["0","1","2"],defender:["0","1","2"]}), battles:CriterionQueueAudit["battles"][number][]=[];
      const cursorHistoryA:(number|null)[]=[scheduler.queueCursorA??null],cursorHistoryB:(number|null)[]=[scheduler.queueCursorB??null];
      for (let index = activeACount; index < 3; index++) remainingA[index] = [0,0,0];
      for (let index = activeBCount; index < 3; index++) remainingB[index] = [0,0,0];
      const matrixKey=JSON.stringify([a,b]);let pairwiseMargins=matchups.get(matrixKey);
      if(!pairwiseMargins){pairwiseMargins=kernel === "theory" ? [] : a.queues.map((q,ai)=>b.queues.map((r,bi)=>duel(q,r,ai,bi,remainingA[ai]!,remainingB[bi]!).margin));matchups.set(matrixKey,pairwiseMargins);
        if(matchups.size>2048)matchups.delete(matchups.keys().next().value!);}

      let uncertainty=0;
      while(aliveA.length&&aliveB.length&&battles.length<5){
        const pick=scheduler.pick(aliveA.map(String),aliveB.map(String)),ai=Number(pick.attackerQueueId),bi=Number(pick.defenderQueueId), beforeA=remainingA[ai]!,beforeB=remainingB[bi]!;
        const result=duel(a.queues[ai]!,b.queues[bi]!,ai,bi,beforeA,beforeB);
        const winner=result.predictedWinner==="A"?"A":result.predictedWinner==="B"?"B":result.margin>0?"A":"B";
        uncertainty=Math.max(uncertainty,result.uncertainty+(result.predictedWinner==="unresolved"?.1:0));
        remainingA[ai]=TROOP_TYPES.map((t)=>result.aRemaining[t]) as unknown as Triple;remainingB[bi]=TROOP_TYPES.map((t)=>result.bRemaining[t]) as unknown as Triple;
        if(winner==="A"){aliveB.splice(aliveB.indexOf(bi),1);remainingB[bi]=[0,0,0];}else{aliveA.splice(aliveA.indexOf(ai),1);remainingA[ai]=[0,0,0];}
        battles.push({aQueue:ai,bQueue:bi,beforeA,beforeB,afterA:remainingA[ai]!,afterB:remainingB[bi]!,winner});
        cursorHistoryA.push(scheduler.queueCursorA??null);cursorHistoryB.push(scheduler.queueCursorB??null);
      }
      return {schedulerRule:scheduler.rule,schedulerStatus:scheduler.ruleStatus,
        threeQueueMode:scheduler.threeQueueMode!,schedulerType:scheduler.schedulerType!,
        queueCursorA:scheduler.queueCursorA??null,queueCursorB:scheduler.queueCursorB??null,
        cursorHistoryA,cursorHistoryB,
        matchSequence:battles.map((row)=>`A${row.aQueue+1}-B${row.bQueue+1}`),
        pairwiseMargins,battles,winner:aliveA.length?"A":"B",remainingA,remainingB,uncertainty:Math.min(1,uncertainty)};
    }
  };
}
