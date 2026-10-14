import { TROOP_TYPES } from "../../types";
import { getValidationCatalog, resolveValidationTroopCounts } from "../../validationUi";
import { availableHeadHeroesByTroop, candidateKey, candidateToInput, currentRallyRatios, refineRatios, generateBodyFormations } from "../candidateGenerator";
import { optimizerPoolAudit } from "../heroPools";
import { headLineupKey, createTheoryTemplateBuilder, estimateTheoryCandidate } from "../theory";
import { evaluateSingleCandidate, type SingleSearchResult } from "../singleWaveSearch";
import { BattleSampleLedger, adaptiveSeedPools, emptySearchIntegrityReport, raceCandidates, resolveAdaptiveSearchOptions, type AdaptiveStageAudit } from "../adaptiveSampling";
import { SingleWinObjective } from "../objectives";
import { emptyRatioSearchAudit } from "../basinSearch";
import type { OptimizationConfig, OptimizationInput, OptimizationProgress, RallyCandidate, CandidateEvaluation } from "../types";
import type { OptimizationWorkflow } from "../execution";
import type { OptimizerProfiler } from "../profiling";
import { preFilterJointRallyCandidates, recordCriterionCoverage } from "./jointPreFilter";
import { resolveJointRacingSchedule } from "./racingSchedule";
import { bodyPrimaryEffectFamily } from "./bodyPreprocess";
import { selectFiveRunProbe, candidateProbeUncertainty, candidateHardToStaticize } from "./probeRacing";
import { resolveCriterionSearchOptions, checkCriterionSpaceWarnings } from "./searchTypes";
import { currentHeadHeroIds, currentHeadWeaponLevels, isEmptyHead } from "../searchDimensions";
export function* createJointSingleWaveSearchWorkflow(input:OptimizationInput,config:OptimizationConfig,
  onProgress?:(progress:OptimizationProgress)=>void,profiler?:OptimizerProfiler):OptimizationWorkflow<SingleSearchResult> {
  if(!input.sideA.rallyDeployment||!input.sideB.rallyDeployment)throw new Error("Single-wave optimization requires both rally deployments.");
  const searchStarted=performance.now();
  const side=config.candidateSide??"A", enemy=side==="A"?"B":"A", own=side==="A"?input.sideA:input.sideB;
  const options=resolveCriterionSearchOptions(config.criterion), adaptive=resolveAdaptiveSearchOptions(config.adaptiveSearch);
  const scan=preFilterJointRallyCandidates(input,config,onProgress,profiler), audit=scan.audit;
  const schedule=resolveJointRacingSchedule(config);
  const max=Math.max(...schedule.map((s)=>s.trials)), seeds=adaptiveSeedPools(config.firstSeed,max,config.verificationTrials), integrity=emptySearchIntegrityReport(seeds.finalScreeningPrefix);
  const current:RallyCandidate={headMode:isEmptyHead(currentHeadHeroIds(input,side))?"EMPTY_HEAD":"FIXED_HEAD",leaderHeroIds:currentHeadHeroIds(input,side),headWeaponLevels:currentHeadWeaponLevels(input,side),
    memberSkillIds:own.bodySkills?.map((b)=>b.skillId)??own.selectedMemberSkillIds,
    ratios:currentRallyRatios(input,side),selectionReasons:["currentConfig"]};
  const currentKey=candidateKey(current), protectedKeys=new Set([...scan.protectedKeys,currentKey]);
  const ledger=new BattleSampleLedger(candidateKey,(candidate:RallyCandidate)=>candidateKey(candidate)===currentKey?input:candidateToInput(input,candidate,side),side,profiler,seeds.screeningSet);
  const count=resolveValidationTroopCounts(own,"rally",input.attributeInputMode??"finalReport"), total=TROOP_TYPES.reduce((n,t)=>n+count[t],0);
  const records:{stage:string;candidates:number;trials:number;retained:number;simulatedTrials:number}[]=[], visited=new Map<string,RallyCandidate["leaderHeroIds"]>();
  const compare=(a:CandidateEvaluation,b:CandidateEvaluation)=>SingleWinObjective.compare(a,b);
  const unique=(candidates:readonly RallyCandidate[])=>[...new Map(candidates.map((c)=>[candidateKey(c),c])).values()];
  const stage=function*(name:string,candidates:readonly RallyCandidate[],pool:readonly number[]):OptimizationWorkflow<CandidateEvaluation[]> {
    const list=unique(candidates), start=performance.now(), row:AdaptiveStageAudit={stage:name,candidatesEntered:list.length,candidatesAdvanced:list.length,candidatesEliminated:0,requestedBattles:0,executedBattles:0,reusedBattles:0,cacheHitRate:0,elapsedMs:0};
    integrity.perStage.push(row);profiler?.begin(name,list.length);
    onProgress?.({stage:name,completed:0,total:list.length});
    yield* ledger.sample(list,pool,row,(completed)=>onProgress?.({stage:name,completed,total:list.length}));
    const result=list.map((candidate)=>{
      visited.set(headLineupKey(candidate.leaderHeroIds),candidate.leaderHeroIds);
      return evaluateSingleCandidate(candidate,total,pool,()=>ledger.outcomes(candidate,pool).map((r)=>({outcome:r.outcome===side?"A" as const:r.outcome===enemy?"B" as const:r.outcome,self:r.remaining[side],enemy:r.remaining[enemy],rounds:r.roundCount})));}).sort(compare);
    profiler?.end();row.elapsedMs=profiler?performance.now()-start:0;
    records.push({stage:name,candidates:list.length,trials:pool.length,retained:list.length,simulatedTrials:row.executedBattles});return result;
  };
  // Candidate budget cuts are global. Only exact baseline / explicitly recorded
  // reference identities are exceptions; no Head receives a minimum allocation.
  const globalRetain=(rows:readonly CandidateEvaluation[],keep:number)=>{
    const sorted=[...rows].sort(compare), selected=new Set(sorted.slice(0,keep).map((r)=>candidateKey(r.candidate)));
    for(const row of sorted)if(protectedKeys.has(candidateKey(row.candidate)))selected.add(candidateKey(row.candidate));
    return sorted.filter((row)=>selected.has(candidateKey(row.candidate)));
  };
  const recordPromotion=(rows:readonly CandidateEvaluation[],retained:CandidateEvaluation[],name:string,
    reason:"budget"|"theoryBudget"="budget")=>{
    const keys=new Set(retained.map((r)=>candidateKey(r.candidate)));
    for(const row of rows)if(!keys.has(candidateKey(row.candidate)))audit.eliminations.push({stage:name,
      headKey:headLineupKey(row.candidate.leaderHeroIds),candidateKey:candidateKey(row.candidate),reason,
      samples:row.trials,uncertainty:candidateProbeUncertainty(row.candidate)});
    const stageAudit=integrity.perStage.at(-1);if(stageAudit){stageAudit.candidatesEliminated=stageAudit.candidatesEntered-retained.length;stageAudit.candidatesAdvanced=retained.length;}
    records.at(-1)!.retained=retained.length;return retained;
  };
  const promote=(rows:readonly CandidateEvaluation[],keep:number,name:string)=>
    recordPromotion(rows,globalRetain(rows,keep),name);
  let pool=unique([...scan.candidates,current]),top:CandidateEvaluation[]=[];
  const initial=pool;
  audit.battleEngineCandidates=initial.length;checkCriterionSpaceWarnings(audit);
  for(const [i,setting]of schedule.entries()) {
    const name=i===0?"M1a · 共享种子全局探针":i===1?"M1b · 候选累计样本复筛":`M${i} · 累计联合筛选`;
    const stageSeeds=seeds.screening.slice(0,setting.trials);
    let rows=yield* stage(name,pool,stageSeeds);
    if(i===0) {
      const probe=selectFiveRunProbe(rows,{keep:setting.keep,seeds:stageSeeds,referenceCandidate:current,side,
        outcomes:(candidate,pool)=>ledger.outcomes(candidate,pool),shares:options.probeLaneShares,
        uncertaintyThreshold:options.uncertaintyThreshold,protectedKeys});
      Object.assign(audit,probe.audit);
      top=probe.retained;
      const rejected=new Map(probe.decisions.filter((d)=>!d.retained).map((d)=>[d.candidateKey,d]));
      for(const row of rows){const decision=rejected.get(candidateKey(row.candidate));if(decision)audit.eliminations.push({stage:name,
        headKey:headLineupKey(row.candidate.leaderHeroIds),candidateKey:decision.candidateKey,
        reason:decision.reason==="eliminatedByFiveRunProbe"?"fiveRunProbe":"theoryBudget",samples:row.trials,
        uncertainty:candidateProbeUncertainty(row.candidate)});}
      const stageAudit=integrity.perStage.at(-1)!;stageAudit.candidatesEliminated=rows.length-top.length;stageAudit.candidatesAdvanced=top.length;
      records.at(-1)!.retained=top.length;
    } else {
      if(setting.trials>=20) {
        const before=rows;
        rows=raceCandidates(rows,{candidate:(r)=>r.candidate,key:candidateKey,uncertainty:candidateProbeUncertainty,
          hardToStaticize:candidateHardToStaticize,compare,protected:(c)=>protectedKeys.has(candidateKey(c)),
          topK:Math.min(setting.keep,rows.length),stage:name,looks:schedule.length,comparisons:initial.length,maxRuns:max,
          options:{...adaptive,minimumRunsBeforeElimination:Math.max(20,options.minimumHeadRuns),
            highUncertaintyMinimumRuns:Math.max(40,options.uncertainHeadRuns),uncertaintyThreshold:options.uncertaintyThreshold}},integrity);
        const remaining=new Set(rows.map((r)=>candidateKey(r.candidate)));
        for(const row of before)if(!remaining.has(candidateKey(row.candidate)))audit.eliminations.push({stage:name,
          headKey:headLineupKey(row.candidate.leaderHeroIds),candidateKey:candidateKey(row.candidate),reason:"confidence",
          samples:row.trials,uncertainty:candidateProbeUncertainty(row.candidate)});
      }
      top=promote(rows,setting.keep,name);
    }
    if(i===1){audit.m1bCandidateCount=records.at(-1)!.candidates;audit.m1bAdvancedCount=top.length;}
    pool=top.map((r)=>r.candidate);
    recordCriterionCoverage(audit,i===0?"M1a":i===1?"M1b":`M${i}`,pool);
    if(i===0)recordCriterionCoverage(audit,"M1",pool);
  }
  const ratioAudit=emptyRatioSearchAudit(), refined:RallyCandidate[]=[];
  if(options.fineRadius>0) {
    const build=createTheoryTemplateBuilder(scan.options), basins=globalRetain(top,options.finalHeadBasins*options.finalBodyBasinsPerHead).filter((row)=>
      scan.formations.some((f)=>headLineupKey(f.leaderHeroIds)===headLineupKey(row.candidate.leaderHeroIds))&&
      generateBodyFormations(input,{...config.constraints,fixedBodyExact:true,fixedMemberSkillIds:row.candidate.memberSkillIds},row.candidate.leaderHeroIds,side).length>0);
    profiler?.begin("1% · 联合盆地理论微调",basins.length);
    for(const [basinIndex,parent] of basins.entries()) {
      const template=build(candidateToInput(input,{...parent.candidate,ratios:{shield:34,lancer:33,marksman:33}},side),side);
      const neighbors=refineRatios(parent.candidate.ratios,1,options.fineRadius).map((ratios)=>({...parent.candidate,ratios,
        theoryEstimate:estimateTheoryCandidate(template,TROOP_TYPES.map((t)=>ratios[t])),selectionReasons:["fineSearch" as const]})).sort((a,b)=>b.theoryEstimate.theoryScore-a.theoryEstimate.theoryScore);
      const selected=neighbors.slice(0,options.finePerBasin);refined.push(...selected);
      ratioAudit.basins.push({id:`joint-basin-${basinIndex+1}`,head:headLineupKey(parent.candidate.leaderHeroIds),seed:parent.candidate.ratios,centers:[parent.candidate.ratios],rounds:1,stopReason:"roundBudget",fineCenter:parent.candidate.ratios,fineCandidates:selected.length,onePercentEntered:true});
      ratioAudit.generatedFineRatios+=selected.length;ratioAudit.fineBasinCount++;
      integrity.fineSearch.basin1PercentEntered++;integrity.fineSearch.basinCount++;integrity.fineSearch.generated1PercentRatios+=selected.length;
      onProgress?.({stage:"1% · 联合盆地理论微调",completed:basinIndex+1,total:basins.length});
    }
    ratioAudit.fineHeroLineupCount=new Set(ratioAudit.basins.map((b)=>b.head)).size;
    profiler?.end();
    if(refined.length)top=promote(yield* stage("M4 · 联合盆地正式复筛",[...pool,...refined],seeds.screening),config.verificationTop,"M4Fine");
  }
  const finalists=unique([...globalRetain(top,config.verificationTop).map((r)=>r.candidate),...initial.filter((c)=>protectedKeys.has(candidateKey(c))),current]);
  // Every reported finalist is verified to the same requested high budget, with common seeds.
  const verified=yield* stage("Final · 联合方案统一高场次复验",finalists,seeds.final);
  const baseline=verified.find((r)=>candidateKey(r.candidate)===currentKey)!;if(!baseline)throw new Error("Exact baseline was not verified.");
  recordCriterionCoverage(audit,"Final",finalists);
  integrity.final.finalistsAt300=config.verificationTrials>=300?verified.length:0;integrity.final.finalistsAt500=config.verificationTrials>=500?verified.length:0;
  audit.finalists=verified.map((r)=>{const c=r.candidate,mapped=candidateKey(c)===currentKey?input:candidateToInput(input,c,side);
    const actualBodies=mapped[side==="A"?"sideA":"sideB"].bodySkills??candidateToInput(input,c,side)[side==="A"?"sideA":"sideB"].bodySkills??[];return {
    bodySlots:actualBodies.map((body,index)=>({heroDefinitionId:body.heroDefinitionId??body.heroId,runtimeInstanceId:body.runtimeInstanceId??`${side}-body-${index}`,
      effectFamily:bodyPrimaryEffectFamily(body.skillId,body.skillLevel),skillId:body.skillId,level:body.skillLevel})),headHeroIds:c.leaderHeroIds,headWeaponLevels:Object.fromEntries(TROOP_TYPES.flatMap((t)=>{const id=c.leaderHeroIds[t];return id&&getValidationCatalog().leaderHeroes.find((h)=>h.heroId===id)?.weaponMaxStat!==null?[[id,c.headWeaponLevels?.[id]??0]]:[]})),
    weaponLevelSource:candidateKey(c)===currentKey?"exactBaseline":scan.dimensions.headSearchEnabled?"optimizerHeroPool":"fixedCurrentHead",bodySkillIds:c.memberSkillIds,
    bodySkillLevels:c.memberSkillIds.map((id,index)=>own.bodySkills?.[index]?.skillId===id?own.bodySkills[index]!.skillLevel:own.bodySkills?.find((b)=>b.skillId===id)?.skillLevel??5),ratios:c.ratios,trials:r.trials,wins:r.wins,winRate:r.winRate,winRateConfidenceInterval:r.wilson95,selectionReasons:c.selectionReasons??[],uncertainty:c.theoryEstimate?.uncertainty??c.criterionEstimate?.uncertainty??1,...(c.theoryEstimate?{theoryScore:c.theoryEstimate.theoryScore}:{}),...(c.criterionEstimate?{criterion:c.criterionEstimate}:{})};});
  integrity.final.screeningRuns=ledger.executedScreeningRuns;integrity.final.independentValidationRuns=ledger.executedIndependentRuns;
  integrity.final.finalistsAt1000=config.verificationTrials>=1000?verified.length:0;
  audit.battleRunsRequested=integrity.perStage.reduce((n,r)=>n+r.requestedBattles,0);
  audit.battleRunsExecuted=integrity.perStage.reduce((n,r)=>n+r.executedBattles,0);
  audit.battleRunsReused=integrity.perStage.reduce((n,r)=>n+r.reusedBattles,0);
  audit.finalCandidates=finalists.length;audit.uniqueFinalHeads=audit.stageCoverage.Final!.uniqueHeads;
  audit.uniqueFinalBodies=audit.stageCoverage.Final!.uniqueBodies;
  audit.known89StructureReachedFinal=side==="A"&&verified.some((r)=>r.candidate.leaderHeroIds.shield==="hero.s11.eleonora"&&
    r.candidate.leaderHeroIds.lancer==="hero.s3.miya"&&r.candidate.leaderHeroIds.marksman==="hero.s11.rufus"&&
    r.candidate.ratios.shield===57&&r.candidate.ratios.lancer===3&&r.candidate.ratios.marksman===40&&
    r.candidate.memberSkillIds.filter((id)=>id==="hero-skill.wuming.wind-shelter").length===2&&
    r.candidate.memberSkillIds.filter((id)=>id==="hero-skill.nuola.multi-troop-combat").length===2&&r.trials===config.verificationTrials);
  audit.battleEngineTime=profiler?profiler.snapshot().stages.filter((r)=>r.executionWorkload).reduce((n,r)=>n+r.wallElapsedMs,0):0;
  audit.totalWallTime=profiler?performance.now()-searchStarted:0;
  const choices=availableHeadHeroesByTroop(input,config.constraints,undefined,side), heads=[...visited.values()].filter((head)=>scan.formations.some((f)=>headLineupKey(f.leaderHeroIds)===headLineupKey(head))), ranked=[...verified].sort(compare).slice(0,config.topN);
  return {top:ranked,coarseBest:ranked[0]!,current:baseline,evaluatedCandidates:ledger.evaluatedBatches,performance:ledger.performance,
    searchDiagnostics:{criterionAudit:audit,searchDimensionAudit:scan.dimensions,weaponAudit:scan.dimensions.headSearchEnabled?optimizerPoolAudit(input,side):[],searchIntegrityReport:integrity,...(scan.heroPoolAudit?{heroPoolAudit:scan.heroPoolAudit}:{}),ratioSearchAudit:ratioAudit,
      theoryCoverage:{theoryCandidateCount:scan.theoryCandidateCount,legalHeroLineupCount:scan.formations.length,theoryHeroCoverage:100,ratiosPerHeroLineup:scan.grid.length,localPeaksDetected:scan.localPeaksDetected,battleCandidateCount:initial.length,heroLineupsEnteringBattleEngine:heads.length,battleHeroCoverage:heads.length/scan.formations.length*100},
      localExpansionCount:refined.length,theoryOptions:scan.options,theoryLineups:scan.lineups,battleSelections:unique([...initial,...refined]).map((c)=>({candidateKey:candidateKey(c),selectionReasons:c.selectionReasons??[]})),monteCarloStages:records,legalHeadCandidateCount:scan.formations.length,evaluatedUniqueHeadCandidateCount:heads.length,headCoverageRate:heads.length/scan.formations.length*100,
      fixedBody:config.constraints.fixedBodyExact??false,availableBodyCandidateCount:audit.legalBodyCount,stage1Trials:schedule[0]!.trials,stage1CandidateCount:initial.length,retainedHeadCandidateCount:audit.stageCoverage.M1!.uniqueHeads,
      stage2RatioCandidateCount:records[1]?.candidates??0,fixedHead:!scan.dimensions.headSearchEnabled,
      searchDimensions:{headShield:scan.dimensions.headSearchEnabled&&config.constraints.fixedLeaders?.shield===undefined,headLancer:scan.dimensions.headSearchEnabled&&config.constraints.fixedLeaders?.lancer===undefined,headMarksman:scan.dimensions.headSearchEnabled&&config.constraints.fixedLeaders?.marksman===undefined,body:scan.dimensions.bodySearchEnabled,troopRatio:true},
      availableHeadHeroesByTroop:choices,shieldCandidateCount:choices.shield.length,lancerCandidateCount:choices.lancer.length,marksmanCandidateCount:choices.marksman.length,
      headCandidateCount:scan.formations.length,bodyCandidateCount:audit.legalBodyCount,ratioCandidateCount:scan.grid.length,totalCandidateCount:scan.formations.length*scan.grid.length*audit.legalBodyCount,coarseRatioCandidateCount:scan.grid.length,
      coarseCandidateCount:initial.length,generatedFormationCount:scan.formations.length,evaluatedHeadLineups:heads,bestHeadLineup:ranked[0]!.candidate.leaderHeroIds,optimizationTargetSide:side,candidateChangedSide:side}};
}
