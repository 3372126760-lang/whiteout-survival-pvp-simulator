import { writeFileSync } from "node:fs";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { enumeratePreprocessedBodyPool } from "../src/pvp/optimizer/criterion/bodyEnumeration";
const reports=(["s11","s16"] as const).map((serverStage)=>{
  const input={...createDefaultValidationInput(),serverStage},start=performance.now();
  const result=enumeratePreprocessedBodyPool(input,{},{});
  return {serverStage,provenance:"Full server-available body pool, four independent slots, same primary effect family at most two, Lv5; ordered raw identity counts. Current Criterion template aliases and commuting equal-level free-slot permutations include expected special proxies where order-independent; they do not establish formal seed-by-seed equivalence. Protected exact identities/orders are retained. No formal battles.",
    unorderedHeroIdentityCombinations:new Set(result.bodies.map((row)=>row.ids.slice().sort().join("|"))).size,
    bodyPreprocessMs:performance.now()-start,...result.audit,rejectedByLowMarginalStacking:0,
    marginalPruningScope:"No Head/Ratio at B0; context-dependent pruning is recorded as rejectedJointByLowMarginalStacking at C1.",skillDominance:result.skillDominance,
    warnings:result.audit.preprocessedBodyCount>1500?[{code:"SEARCH_SPACE_EXPLOSION_WARNING",stage:"B0 preprocessedBody",actual:result.audit.preprocessedBodyCount,threshold:1500}]:[]};
});
writeFileSync("examples/criterion-round3-full-body-audit.json",JSON.stringify({recordedAt:new Date().toISOString(),reports},null,2)+"\n");
process.stdout.write(JSON.stringify(reports,null,2)+"\n");
