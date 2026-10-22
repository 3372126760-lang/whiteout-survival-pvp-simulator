import { candidateHeadWeaponLevels, fixedHeadForSearch, generateAllHeadFormations, generateBodyFormations } from "../candidateGenerator";
import { headLineupKey } from "../theory";
import type { CriterionSearchAudit } from "../criterion/searchTypes";
import type { OptimizationInput, OptimizationConfig, RallyCandidate } from "../types";
export function recordCriterionCoverage(audit:CriterionSearchAudit,stage:string,candidates:readonly RallyCandidate[]):void {
  audit.stageCoverage[stage]={candidates:candidates.length,uniqueHeads:new Set(candidates.map((c)=>headLineupKey(c.leaderHeroIds))).size,
    uniqueBodies:new Set(candidates.map((c)=>c.memberSkillIds.join("|"))).size};
}
export function knownRallyStructureReferences(input: OptimizationInput, config: OptimizationConfig): RallyCandidate[] {
  // Historical attack examples are not known defender references.
  if (config.candidateSide === "B" || fixedHeadForSearch(input,config.constraints,config.candidateSide) !== undefined) return [];
  const heads=generateAllHeadFormations(input,config.constraints,undefined,config.candidateSide), requestedBody=["hero-skill.wuming.wind-shelter","hero-skill.wuming.wind-shelter","hero-skill.nuola.multi-troop-combat","hero-skill.nuola.multi-troop-combat"];
  if(input.scenarioType === "CITY_DEFENSE") return [];
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
