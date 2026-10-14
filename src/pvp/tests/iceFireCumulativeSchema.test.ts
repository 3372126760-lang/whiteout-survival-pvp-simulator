import { describe,expect,it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createDefaultInnerEarthConfig,normalizeInnerEarthInput,materializeInnerEarthInput } from "../innerEarth";
import { expandPerTroopPaired6,expandAllTroopsPaired2,innerEarthAttributeSchema } from "../validationUi/attributeSchema";
import { attributePreviewGroups,applyRecognizedAttributes } from "../battleReportRecognition/attributeImport";
import { normalizeRecognitionResult } from "../battleReportRecognition/recognize";
import type { OcrImage } from "../battleReportRecognition/types";
import { defaultThreeQueueOptimizationOptions,createThreeQueueOptimizationWorkflow } from "../optimizer/threeQueueOptimizer";
import { runOptimizationWorkflow,emptyOptimizationPerformance,type EvaluationJob } from "../optimizer/execution";
import { createEvaluationExecutor } from "../optimizer/execution";
import { diagnoseIceFireDuel,replayIceFireTrial } from "../diagnostics/iceFireReplay";
import { runPureTroopBattleScenario,type PureTroopBattleScenario } from "../scenario/pureTroopScenario";
import { toValidationThreeQueueConfig } from "../validationUi/adapter";
import { createSeededRandomSource } from "../troopSkills";
import { TROOP_TYPES } from "../types";

const full=(values:readonly number[])=>expandPerTroopPaired6(Object.fromEntries(TROOP_TYPES.flatMap((troop,i)=>[
  [`${troop}AttackDefense`,values[i*2]!],[`${troop}PenetrationLife`,values[i*2+1]!],
])));
const image=(values:readonly number[],named=true):OcrImage=>({imageId:"six",width:800,height:1000,lines:
  TROOP_TYPES.flatMap((troop,i)=>["攻击力","防御力","穿透力","生命值"].map((stat,j)=>({
    text:`${named?{shield:"盾兵",lancer:"矛兵",marksman:"射手"}[troop]:""}${stat} ${values[i*2+(j<2?0:1)]}%`,confidence:.99,
    box:[[20,20+(i*4+j)*30],[210,20+(i*4+j)*30],[210,38+(i*4+j)*30],[20,38+(i*4+j)*30]],
  })))});
function emptyIce() {
  const base=createDefaultValidationInput();
  const side=(value:typeof base.sideA)=>({...value,threeQueues:value.threeQueues!.map((q)=>({...q,leaderHeroIds:{},reportHeroByTroop:{},weaponLevels:{}})) as unknown as NonNullable<typeof value.threeQueues>});
  return {...base,scenarioType:"ICE_FIRE_LEAGUE" as const,attributeInputMode:"prediction" as const,maxRounds:40,sideA:side(base.sideA),sideB:side(base.sideB)};
}
describe("IceFire cumulative trajectory racing and asymmetric schemas",()=>{
  it("GEM_MINE retains six independent ally inputs and two enemy inputs through OCR/formal expansion",()=>{
    const mode = "GEM_MINE";
    const base=createDefaultValidationInput(),input=normalizeInnerEarthInput(base,createDefaultInnerEarthConfig(base,mode));
    expect(innerEarthAttributeSchema(mode,"ally")).toBe("PER_TROOP_PAIRED_6");
    expect(innerEarthAttributeSchema(mode,"enemy")).toBe("ALL_TROOPS_PAIRED_2");
    const values=[62,489.7,62,305,62,406.3];
    const parsed=normalizeRecognitionResult(image(values),"PER_TROOP_PAIRED_6").left!;
    const groups=attributePreviewGroups(parsed,"PER_TROOP_PAIRED_6");
    expect(groups).toHaveLength(6);expect(groups.map((g)=>g.item?.value)).toEqual(values);
    expect(groups.every((g)=>!g.conflict&&!g.needsConfirmation)).toBe(true);
    expect(attributePreviewGroups(parsed,"ALL_TROOPS_PAIRED_2")).toHaveLength(2);
    expect(parsed.troopSetup).toEqual({shield:{},lancer:{},marksman:{}});
    const imported=applyRecognizedAttributes(input,parsed,"A");
    expect(imported.innerEarth!.ally.reportStats).toEqual(full(values));
    const formal=materializeInnerEarthInput(imported);
    for(const troop of TROOP_TYPES)expect(formal.sideA.troops[troop].attack).toBe(full(values)[troop].attack);
    expect(input.innerEarth!.ally.reportStats).not.toEqual(full(values));
  });
  it("allows all per-troop pairs to differ and scopes real conflicts to their pair",()=>{
    const values=[100,150,200,250,300,350],parsed=normalizeRecognitionResult(image(values,false),"PER_TROOP_PAIRED_6").left!;
    expect(attributePreviewGroups(parsed,"PER_TROOP_PAIRED_6").map((g)=>g.item?.value)).toEqual(values);
    const conflict={...parsed,attributes:{...parsed.attributes,lancer:{...parsed.attributes.lancer,
      defense:{...parsed.attributes.lancer!.defense!,value:201}}}};
    expect(attributePreviewGroups(conflict,"PER_TROOP_PAIRED_6").filter((g)=>g.conflict).map((g)=>g.key)).toEqual(["lancerAttackDefense"]);
    const expanded=expandAllTroopsPaired2({sharedAttackDefense:220,sharedPenetrationLife:330});
    TROOP_TYPES.forEach((troop)=>expect(expanded[troop]).toEqual({attack:220,defense:220,penetration:330,life:330}));
    const incomplete={...image(values,false),lines:image(values,false).lines.slice(1)};
    expect(attributePreviewGroups(normalizeRecognitionResult(incomplete,"PER_TROOP_PAIRED_6").left,"PER_TROOP_PAIRED_6").every((g)=>g.needsConfirmation)).toBe(true);
  });
  it("uses 30/20/100/150/700 new baseline runs, shared prefixes, alternative ratios and truthful C0 audit",()=>{
    const input=emptyIce(),jobs:EvaluationJob[]=[];
    const options={...defaultThreeQueueOptimizationOptions(991),enemyPermutationMode:"fixedCurrent" as const,fixedOwnQueueOrder:true,criterionCandidatesPerQueue:8,criterionPairLimit:16,
      criterionTripleLimit:16,criterionTheoryLimit:8,lockHeroes:[true,true,true] as const,
      formalStageTrials:[30,50,150,300],formalStageKeeps:[8,6,4,3],finalCandidateCount:3};
    const result=runOptimizationWorkflow(createThreeQueueOptimizationWorkflow(input,options),(job)=>{
      jobs.push(job);return {samples:{trials:job.seeds.length,requestedTrials:job.seeds.length,wins:job.seeds.length,losses:0,
        failedTrials:0,pruned:false,outcomes:[],trajectories:job.seeds.map((seed)=>({seed,outcome:"A" as const,battleCount:3,
          remainingQueuesA:3,remainingQueuesB:0,maxRoundHitCount:0}))},performance:{...emptyOptimizationPerformance(),simulatedTrials:job.seeds.length}};
    });
    const baseline=jobs.filter((job)=>job.protectFromPruning);
    expect(baseline.map((job)=>job.seeds.length)).toEqual([30,20,100,150,700]);
    const seeds=baseline.flatMap((job)=>job.seeds);expect(new Set(seeds).size).toBe(1000);
    for(const job of jobs)expect(job.seeds.every((seed)=>seeds.includes(seed))).toBe(true);
    expect(result.formalStages!.map((s)=>s.trials)).toEqual([30,50,150,300,1000]);
    expect(result.formalStages!.map((s)=>s.baselineReusedRuns)).toEqual([0,30,50,150,300]);
    expect(result.formalRacingAudit!.baselineSimulatedRuns).toBe(1000);expect(result.formalRacingAudit!.pairedComparisonEnabled).toBe(true);
    const audit=result.criterionAudit!;
    expect([audit.q1SingleCandidateCount,audit.q2SingleCandidateCount,audit.q3SingleCandidateCount]).toEqual([231,231,231]);
    expect([audit.q1UniqueRatioCount,audit.q2UniqueRatioCount,audit.q3UniqueRatioCount]).toEqual([231,231,231]);
    expect(audit.singleCandidateTotal).toBe(693);expect(audit.singleQueueAudit.every((a)=>a.top20.length===20)).toBe(true);
    expect(audit.uniqueTripleRatioPatternsAtM1).toBeGreaterThan(1);expect(audit.alternativeRatiosEvaluated).toBe(true);
    expect(audit.formalFinalistsCompared).toBe(true);expect(audit.pairCandidateCount).toBeLessThanOrEqual(16);
    expect(result.topCandidates[0]!.isCurrent).toBe(true);expect(result.schedulerAudit!.observedTrajectories).toBe(result.finalValidatedCandidateCount*1000);
    expect(result.recommendedSchedulerAudit!.observedTrajectories).toBe(1000);expect(result.schedulerAudit!.finishIn3Rate).toBe(1);
    expect(result.schedulerAudit!.A3to0SweepRate).toBe(1);
    const totalNew=result.formalStages!.reduce((sum,s)=>sum+s.incrementalRuns,0);
    expect(result.performance.simulatedTrials).toBe(totalNew);expect(result.formalRacingAudit!.reusedTrajectoryCount).toBeGreaterThan(0);
  });
  it("records no-progress without changing formal termination or integer damage",()=>{
    const troop=(count:number)=>({count,attack:0,defense:1e9,penetration:0,life:0,troopLevel:"T10",troopConstant:7.4947,damageCoefficient:1});
    const side={shield:troop(1),lancer:troop(0),marksman:troop(0)};
    const battle=runPureTroopBattleScenario({id:"zero-rounded-diagnostic",sideA:side,sideB:side,maxRounds:60});
    const report=diagnoseIceFireDuel(battle);
    expect(report.classification).toBe("A_ZERO_DAMAGE_STALEMATE");expect(report.guards[0]!.round).toBe(30);
    expect(report.roundCount).toBe(60);expect(report.last20Rounds).toHaveLength(20);expect(report.guardAffectsOutcome).toBe(false);
  });
  it("does not label simultaneous elimination as a 1500-round timeout",()=>{
    // Recorded symmetric fixture's known draw seed, with untouched core rules.
    const value=emptyIce(),attributes=full([240,240,240,240,240,240]);
    const symmetric=(s:typeof value.sideA)=>({...s,deploymentCapacity:300,threeQueues:s.threeQueues!.map((q)=>({...q,attributes,
      ratios:{shield:34,lancer:33,marksman:33},troopLevels:{shield:"T10",lancer:"T10",marksman:"T10"}})) as unknown as NonNullable<typeof s.threeQueues>});
    const job={kind:"threeQueue" as const,input:{...value,maxRounds:1500,sideA:symmetric(value.sideA),sideB:symmetric(value.sideB)},side:"A" as const,seeds:[1243],collectTrajectories:true};
    const result=createEvaluationExecutor()(job),trial=result.samples.trajectories![0]!;
    expect(trial.outcome).toBe("failed");expect(trial.failureReason).toBe("simultaneousElimination");
    expect(trial.maxRoundHitCount).toBe(0);expect(trial.failedBattleId).toMatch(/battle-1/);expect(trial.failedBattleSeed).toBeDefined();
  });
  it("fresh formal runtime per duel carries only per-type survivors; fast observations match scheduler counts",()=>{
    const input=emptyIce(),config=toValidationThreeQueueConfig(input);
    // Deliberately strong A fixture: this proves reset/observation wiring, not
    // reproduction of the user's unavailable failing configuration.
    const strong={...config,attacker:{...config.attacker,queues:config.attacker.queues.map((q)=>({...q,side:{...q.side,
      shield:{...q.side.shield,attack:10000,penetration:10000},lancer:{...q.side.lancer,attack:10000,penetration:10000},
      marksman:{...q.side.marksman,attack:10000,penetration:10000}}})) as unknown as typeof config.attacker.queues}};
    const replay=replayIceFireTrial(strong,3010811274);expect(replay.status).toBe("completed");expect(replay.duels).toHaveLength(3);
    replay.duels.forEach(({report})=>{expect(report.runtimeReset.round).toBe(1);expect(report.runtimeReset.pendingEvents).toBe(0);
      expect(report.runtimeReset.temporaryShieldHp).toEqual([0,0,0,0,0,0]);});
    const captures:PureTroopBattleScenario[]=[];
    runThreeQueueScenario(strong,(scenario,seed)=>{
      captures.push(scenario);const battle=runPureTroopBattleScenario(scenario,{randomSource:createSeededRandomSource(seed)});
      const counts=(side:typeof battle.simulation.finalState.sideA)=>Object.fromEntries(TROOP_TYPES.map((troop)=>[troop,side.troops[troop].aliveCount])) as Record<typeof TROOP_TYPES[number],number>;
      return {battle,winner:"A",attackerSurvivors:counts(battle.simulation.finalState.sideA),defenderSurvivors:counts(battle.simulation.finalState.sideB)};
    });
    expect(captures[1]!.sideA.shield.count).toBeLessThanOrEqual(captures[0]!.sideA.shield.count);
    const result=createEvaluationExecutor()({kind:"threeQueue",input,seeds:[3010811274],side:"A",collectTrajectories:true});
    expect(result.samples.trajectories).toHaveLength(1);
  });
});

// Static import kept separate from diagnostic helpers to use the real scheduler.
import { runThreeQueueScenario } from "../scenario/threeQueueScenario";
