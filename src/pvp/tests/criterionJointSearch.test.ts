import { createEvaluationExecutor } from "../optimizer/execution";
import { describe,expect,it } from "vitest";
import { createPeakJointWorkflow } from "../optimizer/jointPipeline/workflow";
import { knownRallyStructureReferences } from "../optimizer/jointPipeline/references";
import { resolveCriterionSearchOptions } from "../optimizer/criterion/searchTypes";
import { generateAllHeadFormations,generateBodyFormations } from "../optimizer/candidateGenerator";
import { defaultOptimizationConfig } from "../optimizer";
import { runOptimizationWorkflow,type EvaluationJobResult } from "../optimizer/execution";
import { createCriterionThreeQueueEvaluator,currentCriterionQueueState } from "../optimizer/criterion/threeQueue";
import { rallyHeadSearchFixture,OPPONENT_HEAD } from "./fixtures/rallyHeadSearch";
import { KNOWN_11_SHIELD_CASE } from "./fixtures/known11ShieldCase";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createPersistedEnvelope,restorePersistedConfig } from "../../storage";
import { initializeOptimizationHeroPool } from "../optimizer/heroPools";
import { runBodyAblation } from "../optimizer/criterion/bodyAblation";
const nora="hero-skill.nuola.multi-troop-combat",wuming="hero-skill.wuming.wind-shelter";
describe("Criterion joint search contracts",()=>{
  it("finds weak-default Head B + strong Body Q instead of locking the default-best head",()=>{
    const base=rallyHeadSearchFixture(),headA="hero.s10.gregory",headB="hero.s11.eleonora";
    const input={...base,availableHeroIds:[headA,headB,OPPONENT_HEAD.lancer,OPPONENT_HEAD.marksman],rallyBodyPoolIds:["hero.s5.nuola","hero.s6.wuming"]};
    const config={...defaultOptimizationConfig(19),constraints:{},criterion:{headRatioFraction:1,theoryCandidateFraction:1,theoryCandidateLimit:4000,formalCandidateFraction:1,formalCandidateLimit:4000,matrixBodiesPerRatio:16,fineRadius:0,finalHeadBasins:2,finalBodyBasinsPerHead:2},
      monteCarloStages:[{trials:5,keep:300},{trials:20,keep:80},{trials:50,keep:25}],verificationTrials:1000,verificationTop:1,topN:3};
    const entered=new Set<string>();
    const result=runOptimizationWorkflow(createPeakJointWorkflow(input,config),(job):EvaluationJobResult=>{
      if (job.kind === "jointPeak") return createEvaluationExecutor()(job);
      const c=job.rallyCandidate!,b=c.leaderHeroIds.shield===headB,q=c.memberSkillIds.filter((s)=>s===wuming).length===2&&c.memberSkillIds.filter((s)=>s===nora).length===2;
      entered.add(`${c.leaderHeroIds.shield}:${c.memberSkillIds.join("|")}`);
      // Head A wins 3/4; Head B default loses; only B+Q always wins.
      const outcomes=job.seeds.map((seed)=>{const win=b?q:seed%4!==0;
        const aRemaining={shield:win?100:0,lancer:0,marksman:0},bRemaining={shield:win?0:100,lancer:0,marksman:0},outcome=win?"A" as const:"B" as const;
        return {outcome,winner:outcome,failed:false,rounds:1,roundCount:1,remaining:{A:aRemaining,B:bRemaining},aRemaining,bRemaining,winnerRemaining:win?aRemaining:bRemaining};});
      const wins=outcomes.filter((r)=>r.outcome==="A").length;
      return {samples:{trials:outcomes.length,requestedTrials:outcomes.length,wins,losses:outcomes.length-wins,failedTrials:0,pruned:false,outcomes},performance:{simulatedTrials:outcomes.length,skippedTrials:0,prunedCandidates:0,templateBuilds:0,templateHits:0}};
    });
    expect([...entered].some((key)=>key.startsWith(headB+":")&&key.slice(headB.length+1).split("|").sort().join("|")===[wuming,wuming,nora,nora].sort().join("|"))).toBe(true);
    expect(result.top[0]!.candidate.leaderHeroIds.shield).toBe(headB);
    expect(result.top[0]!.candidate.memberSkillIds.slice().sort()).toEqual([wuming,wuming,nora,nora].sort());
    expect(result.top[0]!.winRate).toBe(1);expect(result.top[0]!.trials).toBe(1000);
    const audit=result.searchDiagnostics.criterionAudit!;
    expect(result.searchDiagnostics.jointPipeline!.peak.headCount).toBe(2);
    expect(result.searchDiagnostics.jointPipeline!.recallAudit!.perHeadUniqueCount).toBe(2);
    expect(result.searchDiagnostics.bodyEnumerationAudit!.canonical!.finalBodyCount).toBe(1);
    expect(result.top[0]!.winRate).toBeGreaterThanOrEqual(result.current.winRate);
    expect(audit.finalists.every((row)=>row.trials===1000)).toBe(true);
    expect(audit.finalists.filter((row)=>row.weaponLevelSource==="optimizerHeroPool").every((row)=>Object.values(row.headWeaponLevels).every((n)=>n===10))).toBe(true);
  },20_000);
  it("includes both real counterexample structures without pretending to reproduce their win rates",()=>{
    const base=rallyHeadSearchFixture(),ids=["hero.s10.gregory","hero.s11.eleonora","hero.s3.miya","hero.s11.rufus"];
    const input={...base,availableHeroIds:ids,rallyBodyPoolIds:["hero.s6.wuming","hero.s5.nuola"]};
    const refs=knownRallyStructureReferences(input,defaultOptimizationConfig());
    expect(KNOWN_11_SHIELD_CASE.observed.strongWins/KNOWN_11_SHIELD_CASE.observed.strongTrials).toBe(.898);
    expect(refs).toHaveLength(2);expect(refs.every((c)=>c.ratios.shield===57&&c.ratios.lancer===3&&c.ratios.marksman===40)).toBe(true);
    expect(refs.every((c)=>c.selectionReasons?.includes("protectedReference"))).toBe(true);
    expect(refs[1]).not.toHaveProperty("winRate");
    expect(generateAllHeadFormations(input,{})).toHaveLength(2);
    expect(generateBodyFormations(input,{equivalentMemberPositions:true},refs[0]!.leaderHeroIds)).toHaveLength(1);
  });
  it("retains the known 11/Miya/11 structure through every aggressive global cut, including equivalent body slots",()=>{
    const base=rallyHeadSearchFixture(),ids=["hero.s10.gregory","hero.s11.eleonora","hero.s3.miya","hero.s11.rufus"];
    const input={...base,availableHeroIds:ids,rallyBodyPoolIds:["hero.s6.wuming","hero.s5.nuola"]};
    const config={...defaultOptimizationConfig(19),constraints:{equivalentMemberPositions:true},
      criterion:{headRatioLimit:1,headRatioFraction:0,smallSpaceHeadRatioFloor:1,theoryCandidateLimit:1,theoryCandidateFraction:0,smallSpaceTheoryFloor:1,
        formalCandidateLimit:1,formalCandidateFraction:0,smallSpaceFormalFloor:1,fineRadius:0},monteCarloStages:[{trials:20,keep:1},{trials:40,keep:1}],verificationTrials:1000};
    const result=runOptimizationWorkflow(createPeakJointWorkflow(input,config),(job):EvaluationJobResult=>{
      if (job.kind === "jointPeak") return createEvaluationExecutor()(job);
      const outcomes=job.seeds.map(()=>({outcome:"A" as const,winner:"A" as const,failed:false,rounds:1,roundCount:1,
        remaining:{A:{shield:100,lancer:0,marksman:0},B:{shield:0,lancer:0,marksman:0}},aRemaining:{shield:100,lancer:0,marksman:0},bRemaining:{shield:0,lancer:0,marksman:0},winnerRemaining:{shield:100,lancer:0,marksman:0}}));
      return {samples:{trials:outcomes.length,requestedTrials:outcomes.length,wins:outcomes.length,losses:0,failedTrials:0,pruned:false,outcomes},performance:{simulatedTrials:outcomes.length,skippedTrials:0,prunedCandidates:0,templateBuilds:0,templateHits:0}};
    });
    const audit=result.searchDiagnostics.criterionAudit!;expect(result.searchDiagnostics.jointPipeline!.recallAudit!.finalistRecallSources.some((row) => row.recalledBy.includes("protectedReference"))).toBe(true);
    expect(result.searchDiagnostics.jointPipeline!.comparisonCandidates).toBeGreaterThanOrEqual(3);
    expect(Object.keys(audit.stageCoverage).some((stage) => stage.startsWith("Final 1000"))).toBe(true);
    expect(audit.finalists.every((r)=>r.trials===1000)).toBe(true);
  });
  it("persists optimizer weapon levels independently of actual levels and retains Criterion settings",()=>{
    const base=initializeOptimizationHeroPool(createDefaultValidationInput()),id="hero.s11.rufus";
    const input={...base,sideA:{...base.sideA,simulationWeaponLevels:{[id]:6}},optimizerHeroPool:{...base.optimizerHeroPool,A:{...base.optimizerHeroPool!.A,[id]:{enabled:true,weaponLevel:4}}}};
    const config={...defaultOptimizationConfig(),criterion:resolveCriterionSearchOptions({minimumHeadRuns:25,uncertainHeadRuns:45})};
    const restored=restorePersistedConfig(createPersistedEnvelope(input,1000,config));
    expect(restored.input.sideA.simulationWeaponLevels?.[id]).toBe(6);
    expect(restored.input.optimizerHeroPool?.A?.[id]?.weaponLevel).toBe(4);
    expect(restored.optimizationConfig.criterion).toEqual(config.criterion);
  });
  it("carries winner remaining counts into the next provisional queue duel",()=>{
    const base=createDefaultValidationInput();const troops={...base.sideA.troops,shield:{...base.sideA.troops.shield,attack:800,defense:800,penetration:800,life:800}};
    const attributes={shield:troops.shield,lancer:troops.lancer,marksman:troops.marksman};
    const input={...base,scenarioType:"THREE_QUEUE" as const,attributeInputMode:"prediction" as const,
      sideA:{...base.sideA,troops,threeQueues:base.sideA.threeQueues!.map((q)=>({...q,attributes,ratios:{shield:100,lancer:0,marksman:0}})) as unknown as NonNullable<typeof base.sideA.threeQueues>}};
    const before=JSON.stringify(input),evaluate=createCriterionThreeQueueEvaluator(input),runs=Array.from({length:16},(_,i)=>evaluate.run(currentCriterionQueueState(input,"A"),currentCriterionQueueState(input,"B"),i+1)),result=runs.find((r)=>r.battles.some((b,i)=>r.battles.slice(i+1).some((next)=>b.winner==="A"?next.aQueue===b.aQueue:next.bQueue===b.bQueue)))!;
    expect(result).toBeDefined();
    expect(result.schedulerStatus).toBe("confirmed");expect(result.battles.length).toBeLessThanOrEqual(5);
    let repeat=false;
    for(let i=0;i<result.battles.length;i++){const duel=result.battles[i]!;
      const next=result.battles.slice(i+1).find((r)=>duel.winner==="A"?r.aQueue===duel.aQueue:r.bQueue===duel.bQueue);
      if(next){repeat=true;expect(duel.winner==="A"?next.beforeA:next.beforeB).toEqual(duel.winner==="A"?duel.afterA:duel.afterB);}
      expect(duel.afterA.every((v,j)=>v<=duel.beforeA[j]!)).toBe(true);expect(duel.afterB.every((v,j)=>v<=duel.beforeB[j]!)).toBe(true);
    }
    expect(repeat).toBe(true);expect(JSON.stringify(input)).toBe(before);
  });
  it("body ablation fixes actual weapons, head and ratio with paired nonzero-width intervals",()=>{
    const base=rallyHeadSearchFixture(),id=OPPONENT_HEAD.marksman;
    const input={...base,sideA:{...base.sideA,leaderHeroIds:OPPONENT_HEAD,simulationWeaponLevels:{[id]:6}}};
    const head={leaderHeroIds:OPPONENT_HEAD,memberSkillIds:[],ratios:{shield:57,lancer:3,marksman:40}};
    const before=JSON.stringify(input),result=runBodyAblation(input,head,[
      {label:"control",memberSkillIds:[nora,nora,wuming,wuming]},
      {label:"identical",memberSkillIds:[nora,nora,wuming,wuming]}],24);
    expect(result.headWeaponLevels[id]).toBe(6);expect(result.headHeroIds).toEqual(OPPONENT_HEAD);expect(result.ratios).toEqual(head.ratios);
    expect(result.pairResults).toHaveLength(24);
    expect(result.pairResults.every((pair)=>JSON.stringify(pair.results[0]?.remaining)===JSON.stringify(pair.results[1]?.remaining)&&pair.results[0]?.outcome===pair.results[1]?.outcome)).toBe(true);
    expect(result.comparisons[0]!.deltaWinRate).toBe(0);expect(result.comparisons[0]!.paired95[0]).toBeLessThan(0);expect(result.comparisons[0]!.paired95[1]).toBeGreaterThan(0);
    expect(JSON.stringify(input)).toBe(before);
  });
});
