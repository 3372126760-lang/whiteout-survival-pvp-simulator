import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { getValidationThreeQueues, getValidationCatalog } from "../src/pvp/validationUi";
import { normalizeIceFireReportLineage, changeIceFireExpectedHero } from "../src/pvp/validationUi/queueReportLineage";
import { iceFireQueueConversionAudit } from "../src/pvp/validationUi/iceFireAudit";
import { DEFAULT_EXTERNAL_BUFF_CONFIG } from "../src/pvp/externalBuffs";
import { TROOP_TYPES } from "../src/pvp/types";
import { defaultThreeQueueOptimizationOptions, optimizeThreeQueueScenario } from "../src/pvp/optimizer/threeQueueOptimizer";
import type { ValidationBattleInput, ValidationQueueAttributes, ValidationSideInput } from "../src/pvp/validationUi/types";
import { createCriterionThreeQueueEvaluator, currentCriterionQueueState } from "../src/pvp/optimizer/criterion/threeQueue";

const stats = (values: readonly number[]) => Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
  Object.fromEntries(["attack","defense","penetration","life"].map((stat,index) => [stat,values[index]!]))])) as ValidationQueueAttributes;
const base = createDefaultValidationInput();
const side = (source: ValidationSideInput, values: readonly number[]): ValidationSideInput => ({ ...source,
  deploymentCapacity: 3, reportHeroIds:[], reportHeroByTroop:{}, reportWeaponLevels:{}, simulationWeaponLevels:{},
  shared:{petContext:{...DEFAULT_EXTERNAL_BUFF_CONFIG.pet},expertContext:{...DEFAULT_EXTERNAL_BUFF_CONFIG.expert}},
  threeQueues:getValidationThreeQueues(source).map((q) => ({ ...q, attributes:stats(values),leaderHeroIds:{},reportHeroByTroop:{},
    reportWeaponLevels:{},weaponLevels:{},heroSkillLevels:{},reportAttributeBasis:"raw",ratios:{shield:34,lancer:33,marksman:33},
    troopLevels:{shield:"T10",lancer:"T10",marksman:"T10"},t12Levels:{shield:0,lancer:0,marksman:0} })) as unknown as NonNullable<ValidationSideInput["threeQueues"]> });
const input: ValidationBattleInput = normalizeIceFireReportLineage({ ...base, scenarioType:"ICE_FIRE_LEAGUE",
  attributeInputMode:"prediction",maxRounds:40,sideA:side(base.sideA,[90000,5000,90000,5000]),sideB:side(base.sideB,[1,1,1,1]) });
const start = performance.now();
const result = optimizeThreeQueueScenario(input,{...defaultThreeQueueOptimizationOptions(1091127),fixedOwnQueueOrder:true,
  lockHeroes:[true,true,true],lockRatios:[true,true,true],criterionCandidatesPerQueue:1,criterionPairLimit:1,
  criterionTripleLimit:1,criterionTheoryLimit:1,finalCandidateCount:1});
const elapsedMs = performance.now()-start;
assert.equal(result.current.trials,6000); assert.equal(result.current.failedTrials,0);
assert.equal(result.current.permutationAudit!.permutationResults.length,6);
assert(result.current.permutationAudit!.permutationResults.every((row) => row.trials===1000));
const q = input.sideA.threeQueues![0], hero = "hero.s11.eleonora", alternate = getValidationCatalog().leaderHeroes.find((h) => h.generation===8&&h.troopType==="shield")!.heroId;
const attributes = stats([5000,5000,5000,5000]);
const historical = { ...q, attributes, leaderHeroIds:{shield:hero},reportHeroByTroop:{shield:hero},
  reportLineage:{source:"historicalReport" as const,historicalLineageConfirmed:true,attributeSnapshot:attributes} };
const historyInput = {...input,sideA:{...input.sideA,threeQueues:[historical,input.sideA.threeQueues![1],input.sideA.threeQueues![2]] as const}};
const changedInput = {...historyInput,sideA:{...historyInput.sideA,threeQueues:[changeIceFireExpectedHero(historical,"shield",alternate),historyInput.sideA.threeQueues[1],historyInput.sideA.threeQueues[2]] as const}};
const before = iceFireQueueConversionAudit(historyInput,"A",0), after = iceFireQueueConversionAudit(changedInput,"A",0);
assert.notEqual(before.expectedAttributesAfterHeroConversion.shield.attack,after.expectedAttributesAfterHeroConversion.shield.attack);
assert.deepEqual(before.reportAttributes,after.reportAttributes); assert.deepEqual(before.reportHeroIds,after.reportHeroIds);
const scoreProbe = { ...historyInput,
  sideA:{...historyInput.sideA,deploymentCapacity:60,threeQueues:historyInput.sideA.threeQueues.map((queue)=>({...queue,ratios:{shield:50,lancer:20,marksman:30}})) as unknown as NonNullable<ValidationSideInput["threeQueues"]>},
  sideB:{...historyInput.sideB,deploymentCapacity:60,threeQueues:historyInput.sideB.threeQueues!.map((queue)=>({...queue,attributes,ratios:{shield:50,lancer:20,marksman:30}})) as unknown as NonNullable<ValidationSideInput["threeQueues"]>} };
const stateA = currentCriterionQueueState(scoreProbe,"A"), stateB = currentCriterionQueueState(scoreProbe,"B");
const candidate = {...stateA.queues[0],leaderHeroIds:{shield:alternate},headWeaponLevels:{}};
const scores = (["criterion","theory"] as const).map((kernel)=>{
  const evaluator=createCriterionThreeQueueEvaluator(scoreProbe,kernel);
  const before=evaluator.matchup(stateA.queues[0],stateB.queues[0],0,0).margin,after=evaluator.matchup(candidate,stateB.queues[0],0,0).margin;
  assert.notEqual(before,after); return {kernel,before,after};
});
const reference = JSON.parse(readFileSync("examples/equipment-forge-core-boundary-audit.json","utf8").replace(/^\uFEFF/,"")) as {checks:{path:string;after:string}[]};
const core = reference.checks.map((row) => {const actual=createHash("sha256").update(readFileSync(row.path)).digest("hex");return {path:row.path,before:row.after,after:actual,unchanged:actual===row.after};});
assert(core.every((row)=>row.unchanged));
const output = { generatedAt:new Date().toISOString(),fixture:"Synthetic strong empty-head queues; verifies execution wiring, not game report calibration",
  realEngine:{elapsedMs,requestedPerPermutation:1000,totalFinalTrials:result.current.trials,failedTrials:result.current.failedTrials,
    metrics:result.current.permutationAudit,stages:result.formalStages,scheduler:result.schedulerAudit},
  heroOnlyConversion:{before,after,scores},coreBoundary:{checkedFiles:core.length,allUnchanged:true,checks:core},
  devServerStarted:false };
writeFileSync("examples/ice-fire-real-6000-audit.json",JSON.stringify(output,null,2)+"\n","utf8");
console.log(JSON.stringify({elapsedMs,realFinalTrials:result.current.trials,permutationCount:result.current.permutationAudit!.permutationResults.length,
  failedTrials:result.current.failedTrials,coreFilesUnchanged:core.length,
  heroOnlyShieldAttack:[before.expectedAttributesAfterHeroConversion.shield.attack,after.expectedAttributesAfterHeroConversion.shield.attack],scores}));
