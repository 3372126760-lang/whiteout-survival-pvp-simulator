import { TROOP_TYPES } from "../../types";
import { DEFAULT_TARGET_PRIORITY } from "../../constants";
import { deriveBatchSeed, type RallyTroopRatios } from "../../validationUi";
import { createSeededRandomSource } from "../../troopSkills";
import { generateAllHeadFormations, generateBodyFormations, headFormationGenerationAudit,
  candidateToInput, candidateKey, generateRatioGrid, headHeroPoolAudit, fixedHeadForSearch, candidateHeadWeaponLevels } from "../candidateGenerator";
import { optimizerPoolAudit, optimizationHeroPoolFilterAudit } from "../heroPools";
import { resolveSearchDimensions } from "../searchDimensions";
import { createTheoryTemplateBuilder, defaultTheoryOptions, estimateTheoryCandidate,
  headLineupKey, ratioRegion, type TheoryTemplate } from "../theory";
import type { OptimizationConfig, OptimizationInput, OptimizationProgress, RallyCandidate } from "../types";
import type { OptimizerProfiler } from "../profiling";
import type { BodyEffectSignature } from "./signatures";
import { prepareCriterionHead, compileCriterionTemplate, type CriterionHeadTemplate } from "./compiler";
import { criterionBattle } from "./solver";
import { orderedLifetimePotential } from "./ordered";
import { emptyCriterionAudit, resolveCriterionSearchOptions, scaledGlobalBudget, checkCriterionSpaceWarnings,
  type CriterionSearchAudit, type CriterionSearchOptions } from "./searchTypes";
import { selectGlobalPotential,type PotentialCandidate } from "./potentialSelection";
import { enumeratePreprocessedBodyPool } from "./bodyEnumeration";
import { createBodyMarginalModel,prepareBodyMarginalContext,roughBodyMarginalScore,
  optimisticBodyPotential, type BodyComboSignature } from "./bodyPreprocess";
import type { CriterionTemplate, Triple } from "./types";
import type { SideId } from "../../types";
import { createOptimizationContext, optimizationContextAudit, auditOptimizationRoleState } from "../optimizationContext";
/** Search perspective only: formal rally inputs retain their roles. */
function candidatePerspective(template:CriterionTemplate, side:SideId):CriterionTemplate {
  return side === "A" ? template : {a:template.b,b:template.a};
}
interface RatioRow extends PotentialCandidate { candidate:RallyCandidate; parent:HeadRow; reasons:NonNullable<RallyCandidate["selectionReasons"]>[number][]; }
interface HeadRow { head:CriterionHeadTemplate; template:CriterionTemplate; rows:RatioRow[]; }
interface BodyRow { ids:readonly string[]; signature:BodyEffectSignature; semantic:BodyComboSignature; }
export function recordCriterionCoverage(audit:CriterionSearchAudit,stage:string,candidates:readonly RallyCandidate[]):void {
  audit.stageCoverage[stage]={candidates:candidates.length,uniqueHeads:new Set(candidates.map((c)=>headLineupKey(c.leaderHeroIds))).size,
    uniqueBodies:new Set(candidates.map((c)=>c.memberSkillIds.join("|"))).size};
}
/** Compatibility microbenchmark proxy. Search uses scoped marginal groups below. */
export function roughBodyCriterion(baseA:number,baseB:number,signature:BodyEffectSignature,rearWeight=.5):number {
  const v=signature.rough;return (baseA*(1+v[0]!+v[1]!*(1-.25*rearWeight))-baseB*(1-v[2]!*.5-v[3]!))/Math.max(1,baseA+baseB);
}
function potentials(template:CriterionTemplate,ratios:RallyTroopRatios):[number,number] {
  const total=template.a.counts.reduce((n,v)=>n+v,0),a=TROOP_TYPES.map((t)=>total*ratios[t]/100),b=template.b.counts;
  return [template.a,template.b].map((s,i)=>orderedLifetimePotential((i===0?a:b).map((n,j)=>Math.sqrt(n)*s.normal[j*3]!),
    (i===0?a:b).map((n,j)=>n*s.hp[j]!),s.priorities[0]!)) as [number,number];
}
const headRatioKey=(c:RallyCandidate)=>headLineupKey(c.leaderHeroIds)+":"+TROOP_TYPES.map((t)=>c.ratios[t]).join("/");
function bodyStructure(c:RallyCandidate):string {return ratioRegion(c.ratios)+":"+c.memberSkillIds.slice().sort().join("|");}
function selectBodies(bodies:readonly BodyRow[],scores:readonly number[],settings:CriterionSearchOptions,seed:number,required:ReadonlySet<string>) {
  const ranked=bodies.map((_,i)=>i).sort((a,b)=>scores[b]!-scores[a]!||a-b),chosen=new Set<number>();
  const add=(i:number|undefined)=>{if(i!==undefined&&chosen.size<settings.matrixBodiesPerRatio)chosen.add(i);};
  for(const i of ranked)if(required.has(bodies[i]!.ids.join("|")))chosen.add(i);
  const fill=(rows:readonly number[],quota:number)=>{let added=0;for(const i of rows)if(!chosen.has(i)&&added<quota){add(i);added++;}};
  fill(ranked,settings.roughBodyTop);
  const diversity=new Set<string>();let n=0;for(const i of ranked)if(n<settings.bodyDiversity&&!diversity.has(bodies[i]!.signature.structure)){
    diversity.add(bodies[i]!.signature.structure);if(!chosen.has(i)){add(i);n++;}}
  fill([...ranked].sort((a,b)=>bodies[b]!.signature.uncertainty-bodies[a]!.signature.uncertainty||scores[b]!-scores[a]!),settings.bodyUncertainty);
  fill(ranked.filter((i)=>bodies[i]!.semantic.hasSpecialMechanisms),settings.bodySpecial);
  const random=createSeededRandomSource(seed),pool=ranked.filter((i)=>!chosen.has(i));
  for(let i=0;i<settings.bodyExploration&&pool.length;i++)add(pool.splice(Math.floor(random.next()*pool.length),1)[0]);
  for(const i of ranked)if(chosen.size<settings.matrixBodiesPerRatio)add(i);
  return [...chosen].map((i)=>bodies[i]!);
}
function globalJointSelection(candidates:readonly RallyCandidate[],limit:number,settings:CriterionSearchOptions,
  protectedKeys:ReadonlySet<string>,score:(c:RallyCandidate)=>number) {
  const lookup=new Map(candidates.map((c)=>[candidateKey(c),c]));
  const rows=candidates.map((c):PotentialCandidate=>({key:candidateKey(c),headKey:headLineupKey(c.leaderHeroIds),
    baseCriterion:c.criterionEstimate?.margin??0,optimisticBodyPotential:0,potentialScore:score(c),
    uncertainty:Math.max(c.criterionEstimate?.uncertainty??0,c.theoryEstimate?.uncertainty??0),
    specialMechanism:!!(c.criterionEstimate?.flags.hardToStaticize||c.criterionEstimate?.flags.targetRedirect),
    disagreement:c.theoryEstimate?Math.abs((c.criterionEstimate?.margin??0)-c.theoryEstimate.theoryScore):0,
    structuralKey:bodyStructure(c),protected:protectedKeys.has(candidateKey(c))}));
  const selection=selectGlobalPotential(rows,{limit,mainShare:settings.potentialMainShare,protectionShare:settings.potentialProtectionShare,diversityShare:settings.potentialDiversityShare});
  return selection.retained.map((r)=>lookup.get(r.key)!);
}
export function knownRallyStructureReferences(input: OptimizationInput, config: OptimizationConfig): RallyCandidate[] {
  // Historical attack examples are not known defender references.
  if (config.candidateSide === "B" || fixedHeadForSearch(input,config.constraints,config.candidateSide) !== undefined) return [];
  const heads=generateAllHeadFormations(input,config.constraints,undefined,config.candidateSide), requestedBody=["hero-skill.wuming.wind-shelter","hero-skill.wuming.wind-shelter","hero-skill.nuola.multi-troop-combat","hero-skill.nuola.multi-troop-combat"];
  if(config.constraints.fixedBodyExact || config.constraints.fixedMemberSkillIds?.length) return [];
  let legalBodies:ReturnType<typeof generateBodyFormations>;
  try {legalBodies=generateBodyFormations(input,{...config.constraints,fixedBodyExact:true,fixedMemberSkillIds:requestedBody},heads[0]?.leaderHeroIds??{},config.candidateSide);}
  catch(error){if(error instanceof RangeError)return [];throw error;} // Optional known references can be outside the owned body pool.
  const body=legalBodies.find((row)=>config.constraints.equivalentMemberPositions
    ? [...row.memberSkillIds].sort().join("|")===requestedBody.slice().sort().join("|")
    : row.memberSkillIds.join("|")===requestedBody.join("|"))?.memberSkillIds;
  if(!body)return [];
  return ["hero.s10.gregory","hero.s11.eleonora"].flatMap((shield)=>{
    const head={shield,lancer:"hero.s3.miya",marksman:"hero.s11.rufus"};
    if(!heads.some((row)=>headLineupKey(row.leaderHeroIds)===headLineupKey(head))) return [];
    return [{leaderHeroIds:head,headWeaponLevels:candidateHeadWeaponLevels(input,head,config.constraints,config.candidateSide),memberSkillIds:body,
      ratios:{shield:57,lancer:3,marksman:40},selectionReasons:["protectedReference" as const]}];
  });
}
/** Global potential C0 -> preprocessed body rough -> scoped Matrix -> global
 * Theory -> global formal pool. No Head has a guaranteed candidate. */
export function preFilterJointRallyCandidates(input:OptimizationInput,config:OptimizationConfig,
  onProgress?:(progress:OptimizationProgress)=>void,profiler?:OptimizerProfiler) {
  const settings=resolveCriterionSearchOptions(config.criterion),configuredOptions=config.theory??defaultTheoryOptions(),audit=emptyCriterionAudit();
  const side=config.candidateSide??"A", own=side==="A"?input.sideA:input.sideB;
  const fixedHead=fixedHeadForSearch(input,config.constraints,side)!==undefined;
  const options=fixedHead?{...configuredOptions,ratioStep:5}:configuredOptions;
  const fixedBody=config.constraints.fixedBodyExact===true||(config.constraints.fixedMemberSkillIds?.length??0)===4;
  const dimensions=resolveSearchDimensions(input,{side,
    fixedHead:TROOP_TYPES.every((troop)=>config.constraints.fixedLeaders?.[troop]!==undefined),fixedBody});
  const optimizationContext=createOptimizationContext(input,side);
  Object.assign(audit,optimizationContextAudit(optimizationContext),dimensions);
  const elapsed=(start:number)=>profiler?performance.now()-start:0;
  let started=performance.now();profiler?.begin(fixedHead?"H0 · 固定车头模板":"H0 · 近三代车头生成",1);
  const formations=generateAllHeadFormations(input,config.constraints,profiler,side),grid=generateRatioGrid(options.ratioStep);
  if(!fixedHead)Object.assign(audit,optimizationHeroPoolFilterAudit(input,side));
  Object.assign(audit,headFormationGenerationAudit(input,config.constraints,undefined,side));
  audit.allLegalHeadCountBeforeRecentRule=audit.allLegalHeadCount;
  profiler?.end();audit.headGenerationTime=elapsed(started);
  if(!formations.length)throw new Error(audit.recentEligibleHeadCount>0
    ? "集结车身池无合法组合（同主效果最多两个），请检查车身范围与锁定条件。"
    : "优化英雄池不能组成包含近三代英雄的合法车头，请检查本次优化范围与锁定条件。");
  const requestedReferences=[...(config.protectedCandidates??[]),...knownRallyStructureReferences(input,config)];
  const references=requestedReferences.filter((ref)=>dimensions.attributeInputMode!=="FINAL_REPORT" ||
    formations.some((formation)=>headLineupKey(formation.leaderHeroIds)===headLineupKey(ref.leaderHeroIds)))
    .map((ref)=>({...ref,headWeaponLevels:candidateHeadWeaponLevels(input,ref.leaderHeroIds,config.constraints,side),selectionReasons:[...(ref.selectionReasons??[]),"protectedReference" as const],
      memberSkillIds:config.constraints.equivalentMemberPositions
        ? ref.memberSkillIds.slice().sort()
        : ref.memberSkillIds}));
  audit.ignoredProtectedReferencesByFixedHead=requestedReferences.length-references.length;
  for(const ref of references){
    if(!formations.some((f)=>headLineupKey(f.leaderHeroIds)===headLineupKey(ref.leaderHeroIds)))throw new Error(fixedHead?"Protected manual candidate changes the fixed current head.":"Protected manual candidate is outside the recent-eligible hero pool.");
    if(!generateBodyFormations(input,{...config.constraints,fixedBodyExact:true,fixedMemberSkillIds:ref.memberSkillIds},ref.leaderHeroIds,side).length)throw new Error("Protected manual candidate violates body pool/effect-family constraints.");
    if(fixedBody&&ref.memberSkillIds.join("|")!==(config.constraints.fixedMemberSkillIds??own.selectedMemberSkillIds).join("|"))throw new Error("Protected manual candidate violates fixed body constraints.");
  }
  const protectedKeys=new Set(references.map((c)=>candidateKey(c))),refsByRatio=new Map<string,RallyCandidate[]>();
  for(const ref of references){const key=headRatioKey(ref),list=refsByRatio.get(key)??[];list.push(ref);refsByRatio.set(key,list);}
  audit.protectedTheoryReferences=protectedKeys.size;
  started=performance.now();profiler?.begin("B0 · 车身语义与支配预处理",1);
  const preprocessed=enumeratePreprocessedBodyPool(input,config.constraints,formations[0]!.leaderHeroIds,
    {protectedBodyKeys:references.map((r)=>r.memberSkillIds.join("|")),candidateSide:side});
  const bodies:readonly BodyRow[]=preprocessed.bodies;Object.assign(audit,preprocessed.audit);
  if(!bodies.length)throw new Error("集结车身池无合法组合（同主效果最多两个）。");
  const marginalModel=createBodyMarginalModel(bodies);
  profiler?.end();audit.bodyPreprocessTime=elapsed(started);
  audit.legalHeads=formations.length;audit.ratiosPerHead=grid.length;audit.legalBodyCount=bodies.length;audit.defaultTargetPriority=DEFAULT_TARGET_PRIORITY;
  audit.actualWeaponLevels=fixedHead?candidateHeadWeaponLevels(input,formations[0]!.leaderHeroIds,config.constraints,side):Object.fromEntries(optimizerPoolAudit(input,side).filter((r)=>r.enabled).map((r)=>[r.heroDefinitionId,r.optimizerWeaponLevel]));
  audit.headTemplateCount=formations.length;audit.ratioCount=grid.length;audit.bodyCandidateCount=bodies.length;
  const buildRough=createTheoryTemplateBuilder({...options,deterministicRounds:settings.c0TheoryRounds});
  const allRows:RatioRow[]=[],parents:HeadRow[]=[];
  const auditedRoleRows=new Map<string, NonNullable<CriterionSearchAudit["roleEffectApplicability"]>[number]>();
  const c0Label=fixedHead?"C0 · 固定车头 × 全比例潜力":"C0 · 近三代全车头 × 全比例潜力";
  started=performance.now();profiler?.begin(c0Label,formations.length*grid.length,0);
  for(const [index,formation] of formations.entries()){
    const base:RallyCandidate={...formation,headMode:dimensions.headMode,criterionPerspectiveSide:side,memberSkillIds:[],headWeaponLevels:candidateHeadWeaponLevels(input,formation.leaderHeroIds,config.constraints,side),ratios:{shield:34,lancer:33,marksman:33}};
    const battle=candidateToInput(input,base,side),head=prepareCriterionHead(battle),template=candidatePerspective(compileCriterionTemplate(head),side),rough=buildRough(battle,side);
    const roleAudit=auditOptimizationRoleState(head.state,optimizationContext,undefined,input.disabledSkillIds);
    for(const key of ["headEffectsActiveByRole","headEffectsInactiveByRole","weaponEffectsActiveByRole","weaponEffectsInactiveByRole"] as const)
      audit[key]=[...new Set([...(audit[key]??[]),...roleAudit[key]])];
    for(const row of roleAudit.roleEffectApplicability)
      auditedRoleRows.set(`${row.runtimeInstanceId}:${row.skillId}:${row.level}`,row);
    const parent:HeadRow={head,template,rows:[]};parents.push(parent);
    const ratios=[...grid];
    for(const ref of references.filter((r)=>headLineupKey(r.leaderHeroIds)===headLineupKey(base.leaderHeroIds)))if(!ratios.some((r)=>TROOP_TYPES.every((t)=>r[t]===ref.ratios[t])))ratios.push(ref.ratios);
    for(const ratio of ratios){
      const candidate={...base,ratios:ratio},[a,b]=potentials(template,ratio),criterion=Math.log(Math.max(1e-12,a)/Math.max(1e-12,b));
      const roughTheory=estimateTheoryCandidate(rough,TROOP_TYPES.map((t)=>ratio[t]));
      const context=prepareBodyMarginalContext(head.state,ratio,marginalModel,candidatePerspective(template,side),side),optimistic=optimisticBodyPotential(context,marginalModel);
      const uncertainty=Math.max(template.a.uncertainty,roughTheory.uncertainty),special=template.a.flags.hardToStaticize||template.a.flags.targetRedirect;
      const key=headRatioKey(candidate);
      allRows.push({key,headKey:headLineupKey(base.leaderHeroIds),baseCriterion:criterion,optimisticBodyPotential:optimistic,potentialScore:criterion+optimistic,
        uncertainty,specialMechanism:special,disagreement:Math.abs(Math.tanh(criterion/2)-roughTheory.theoryScore),
        structuralKey:ratioRegion(ratio)+":"+head.signatures[side==="A"?0:1].structure+":"+Object.values(template.a.flags).map(Number).join(""),protected:refsByRatio.has(key),candidate,parent,reasons:[]});
    }
    audit.criterionEvaluations+=grid.length;profiler?.observeCandidateCount(allRows.length);
    onProgress?.({stage:c0Label,completed:(index+1)*grid.length,total:formations.length*grid.length});
  }
  audit.rawHeadRatioCount=formations.length*grid.length;
  audit.roleEffectApplicability=[...auditedRoleRows.values()];
  const c0=selectGlobalPotential(allRows,{limit:fixedHead?allRows.length:scaledGlobalBudget(audit.rawHeadRatioCount,settings.headRatioLimit,settings.headRatioFraction,settings.smallSpaceHeadRatioFloor),
    mainShare:settings.potentialMainShare,protectionShare:settings.potentialProtectionShare,diversityShare:settings.potentialDiversityShare});
  for(const row of c0.retained){row.reasons=refsByRatio.has(row.key)?["criterionTop","protectedReference"]:["criterionTop"];
    if(c0.reasons.get(row.key)?.includes("uncertaintySpecialDisagreement"))row.reasons.push("uncertaintyExploration");
    if(c0.reasons.get(row.key)?.includes("structuralDiversity"))row.reasons.push("ratioDiversity");
    row.parent.rows.push(row);}
  const rows=parents.filter((r)=>r.rows.length);audit.retainedHeadRatioCount=c0.retained.length;audit.headsBeforeC0=formations.length;audit.headsAfterC0=rows.length;
  audit.headsFullyEliminatedAtC0=formations.length-rows.length;audit.eliminatedByTheoryPotential=c0.eliminatedHeads;audit.c0Cutoff=c0.cutoff;audit.c0MainPotentialCutoff=c0.mainCutoff;
  const laneCount=(reason:string)=>c0.retained.filter((row)=>c0.reasons.get(row.key)?.includes(reason)).length;
  audit.retainedByMainTheory=laneCount("potentialTop")+laneCount("potentialFill");
  audit.retainedByUncertainty=laneCount("uncertainty");audit.retainedBySpecialMechanism=laneCount("specialMechanism");
  audit.retainedByDisagreement=laneCount("disagreement");audit.retainedByDiversity=laneCount("structuralDiversity");
  for(const row of rows)audit.representativesPerHead[headLineupKey(row.rows[0]!.candidate.leaderHeroIds)]=row.rows.length;
  profiler?.end();audit.headRatioCriterionTime=elapsed(started);audit.uniqueHeads=rows.length;
  recordCriterionCoverage(audit,"C0",c0.retained.map((r)=>r.candidate));
  const lineups=parents.map((row,i)=>({head:formations[i]!.leaderHeroIds,scannedRatios:grid.length,localPeaks:0,selectedRatios:row.rows.length}));
  // Release the full cheap scan before allocating joint candidates. Retained
  // rows own only surviving head templates; eliminated heads need no state.
  allRows.length=0;parents.length=0;
  const roughSelections:{parent:HeadRow;ratio:RatioRow;bodies:BodyRow[]}[]=[];let completed=0,retainedRough=0;
  const roughTotal=c0.retained.length*bodies.length;
  started=performance.now();profiler?.begin("C1 · 预处理车身边际粗扫描",roughTotal,0);
  for(const [hi,parent] of rows.entries())for(const [ri,ratio] of parent.rows.entries()){
    const context=prepareBodyMarginalContext(parent.head.state,ratio.candidate.ratios,marginalModel,candidatePerspective(parent.template,side),side),scores=bodies.map((body)=>roughBodyMarginalScore(body.semantic,context));
    const required=new Set((refsByRatio.get(ratio.key)??[]).map((r)=>r.memberSkillIds.join("|")));
    const best=scores.reduce((maximum,score)=>Math.max(maximum,score),-Infinity);
    const usable=bodies.map((body,i)=>({body,score:scores[i]!})).filter(({body,score})=>{
      const reject=!required.has(body.ids.join("|"))&&!body.semantic.hasSpecialMechanisms&&best-score>.35;
      if(reject)audit.rejectedJointByLowMarginalStacking++;return !reject;
    });
    const selected=selectBodies(usable.map((r)=>r.body),usable.map((r)=>r.score),settings,deriveBatchSeed(config.firstSeed,4000000+hi*1000+ri),required);
    roughSelections.push({parent,ratio,bodies:selected});completed+=bodies.length;
    retainedRough+=selected.length;profiler?.observeCandidateCount(retainedRough+bodies.length);
    audit.perHeadBodyCandidateCount[headLineupKey(ratio.candidate.leaderHeroIds)]=bodies.length;
    onProgress?.({stage:"C1 · 预处理车身边际粗扫描",completed,total:roughTotal});
  }
  profiler?.end();audit.bodyRoughScanTime=elapsed(started);
  audit.headsEnteredBodySearch=rows.length;audit.ratiosEnteredBodySearch=c0.retained.length;
  audit.roughBodyEvaluations=completed;audit.bodyCombosScanned=completed;audit.roughJointEvaluations=completed;
  audit.roughJointCount=completed;
  audit.stageCoverage.C1={candidates:completed,uniqueHeads:rows.length,uniqueBodies:bodies.length};
  const matrixCandidates:RallyCandidate[]=[],matrixCount=roughSelections.reduce((n,r)=>n+r.bodies.length,0);let matrixDone=0;
  started=performance.now();profiler?.begin("C2 · MatrixCriterion 联合候选",matrixCount,0);
  let activeHead:HeadRow|undefined;const cache=new Map<string,CriterionTemplate>();
  for(const row of roughSelections){
    if(activeHead!==row.parent){cache.clear();activeHead=row.parent;}
    for(const body of row.bodies){
      let template=cache.get(body.signature.key);if(!template){template=candidatePerspective(compileCriterionTemplate(row.parent.head,body.signature,side),side);cache.set(body.signature.key,template);}
      const total=template.a.counts.reduce((n,v)=>n+v,0),counts=TROOP_TYPES.map((t)=>total*row.ratio.candidate.ratios[t]/100) as unknown as Triple;
      const candidate={...row.ratio.candidate,memberSkillIds:body.ids,criterionEstimate:criterionBattle(template,counts),selectionReasons:[...row.ratio.reasons,"bodyScreening" as const]};
      if(protectedKeys.has(candidateKey(candidate))&&!candidate.selectionReasons.includes("protectedReference"))candidate.selectionReasons.push("protectedReference");
      matrixCandidates.push(candidate);matrixDone++;
    }
    profiler?.observeCandidateCount(matrixCandidates.length);
    onProgress?.({stage:"C2 · MatrixCriterion 联合候选",completed:matrixDone,total:matrixCount});
  }
  profiler?.end();audit.matrixCriterionTime=elapsed(started);audit.matrixBodyEvaluations=matrixDone;audit.matrixCriterionCandidates=matrixDone;
  recordCriterionCoverage(audit,"C2",matrixCandidates);
  const theorySelected=globalJointSelection(matrixCandidates,fixedHead&&fixedBody?matrixCandidates.length:scaledGlobalBudget(matrixCandidates.length,settings.theoryCandidateLimit,settings.theoryCandidateFraction,settings.smallSpaceTheoryFloor),settings,protectedKeys,(c)=>c.criterionEstimate!.margin);
  // Cluster by head/body so full Theory programs compile once per distinct pair.
  theorySelected.sort((a,b)=>(headLineupKey(a.leaderHeroIds)+a.memberSkillIds.join("|")).localeCompare(headLineupKey(b.leaderHeroIds)+b.memberSkillIds.join("|")));
  const candidates:RallyCandidate[]=[],buildTheory=createTheoryTemplateBuilder(options);let theoryDone=0;
  started=performance.now();profiler?.begin("C3 · 全局联合确定性理论",theorySelected.length);
  const templates=new Map<string,TheoryTemplate>();let lastHead="";
  for(const candidate of theorySelected){
    const hk=headLineupKey(candidate.leaderHeroIds);if(hk!==lastHead){templates.clear();lastHead=hk;}
    const key=candidate.memberSkillIds.join("|");let template=templates.get(key);
    if(!template){template=buildTheory(candidateToInput(input,{...candidate,ratios:{shield:34,lancer:33,marksman:33}},side),side);templates.set(key,template);}
    candidates.push({...candidate,theoryEstimate:estimateTheoryCandidate(template,TROOP_TYPES.map((t)=>candidate.ratios[t]))});theoryDone++;
    onProgress?.({stage:"C3 · 全局联合确定性理论",completed:theoryDone,total:theorySelected.length});
  }
  profiler?.end();audit.deterministicTheoryTime=elapsed(started);audit.theoryBodyEvaluations=theoryDone;audit.deterministicTheoryCandidates=theoryDone;
  audit.theoreticalEvaluationCount=theoryDone;
  recordCriterionCoverage(audit,"Theory",candidates);
  const selected=globalJointSelection(candidates,fixedHead&&fixedBody?candidates.length:scaledGlobalBudget(candidates.length,settings.formalCandidateLimit,settings.formalCandidateFraction,settings.smallSpaceFormalFloor),settings,protectedKeys,(c)=>c.theoryEstimate!.theoryScore);
  for(const key of protectedKeys)if(!selected.some((c)=>candidateKey(c)===key))throw new Error("Protected structure was lost during theoretical pruning.");
  audit.battleEngineCandidates=selected.length;checkCriterionSpaceWarnings(audit);
  return {candidates:selected,protectedKeys,formations,grid,options,theoryCandidateCount:audit.criterionEvaluations,localPeaksDetected:0,audit,
    heroPoolAudit:fixedHead?undefined:headHeroPoolAudit(input,config.constraints,undefined,side),lineups,dimensions};
}
