import { describe,it,expect } from "vitest";
import { selectGlobalPotential,type PotentialCandidate } from "../optimizer/criterion/potentialSelection";
import { emptyCriterionAudit,checkCriterionSpaceWarnings,scaledGlobalBudget,resolveCriterionSearchOptions } from "../optimizer/criterion/searchTypes";
const row=(headKey:string,i:number,base:number,body=0):PotentialCandidate=>({key:`${headKey}:${i}`,headKey,baseCriterion:base,optimisticBodyPotential:body,potentialScore:base+body,uncertainty:0,specialMechanism:false,disagreement:0,structuralKey:String(i%3)});
describe("global theoretical potential funnel",()=>{
  it("can eliminate every ratio of a weak head, without a per-head floor",()=>{
    const rows=[...Array.from({length:231},(_,i)=>row("strong",i,2+i/1000)),...Array.from({length:231},(_,i)=>row("weak",i,-100))];
    const result=selectGlobalPotential(rows,{limit:24,mainShare:.75,protectionShare:.15,diversityShare:.1});
    expect(result.retained).toHaveLength(24);expect(result.retained.every((r)=>r.headKey==="strong")).toBe(true);
    expect(result.eliminatedHeads.map((r)=>r.headKey)).toEqual(["weak"]);
  });
  it("uses allowed body potential rather than bare Criterion ranking",()=>{
    const result=selectGlobalPotential([row("bare",0,2),row("interaction",0,.5,3)],{limit:1,mainShare:1,protectionShare:0,diversityShare:0});
    expect(result.retained[0]!.headKey).toBe("interaction");
  });
  it("separates a protected structure from quotas and never silently drops it",()=>{
    const ref={...row("reference",0,-10),protected:true};
    expect(selectGlobalPotential([row("top",0,2),ref],{limit:1,mainShare:1,protectionShare:0,diversityShare:0}).retained).toHaveLength(2);
  });
  it("scales a full pool to about 2000 and small pools without per-head retention",()=>{
    expect(scaledGlobalBudget(202356,2000,.01,24)).toBe(2000);
    expect(scaledGlobalBudget(2772,2000,.01,24)).toBe(28);
    const options=resolveCriterionSearchOptions();expect(options.matrixBodiesPerRatio).toBe(24);
  });
  it("reports search-space explosions as warnings",()=>{
    const audit=emptyCriterionAudit();audit.retainedHeadRatioCount=5001;audit.preprocessedBodyCount=1501;
    audit.matrixCriterionCandidates=100001;audit.deterministicTheoryCandidates=15001;audit.battleEngineCandidates=5001;
    checkCriterionSpaceWarnings(audit);expect(audit.warnings).toHaveLength(5);expect(audit.warnings.every((w)=>w.code==="SEARCH_SPACE_EXPLOSION_WARNING")).toBe(true);
    audit.retainedHeadRatioCount=1;checkCriterionSpaceWarnings(audit);expect(audit.warnings).toHaveLength(4);
  });
});
