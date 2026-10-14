import { readFileSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { optimizeThreeQueueScenario,defaultThreeQueueOptimizationOptions } from "../src/pvp/optimizer/threeQueueOptimizer";
import { TROOP_TYPES } from "../src/pvp/types/combat";
import { createDefaultInnerEarthConfig,normalizeInnerEarthInput } from "../src/pvp/innerEarth";
import { innerEarthAttributeSchema,ATTRIBUTE_SCHEMA_FIELDS } from "../src/pvp/validationUi/attributeSchema";
import { renderInnerEarthForm } from "../src/ui/innerEarthView";
import type { ValidationBattleInput } from "../src/pvp/validationUi/types";
const base=createDefaultValidationInput();
const side=(value:typeof base.sideA)=>({...value,deploymentCapacity:300,
  troops:Object.fromEntries(TROOP_TYPES.map((troop)=>[troop,{...value.troops[troop],count:100,troopLevel:"T10",t12Level:0}])) as typeof value.troops,
  highestTroopLevels:{shield:"T10",lancer:"T10",marksman:"T10"},
  threeQueues:value.threeQueues!.map((queue)=>({...queue,leaderHeroIds:{},reportHeroByTroop:{},weaponLevels:{},
    reportLineage:undefined,attributeSource:"manualBase" as const,
    attributes:Object.fromEntries(TROOP_TYPES.map((troop)=>[troop,{attack:240,defense:240,penetration:240,life:240}])),
    troopLevels:{shield:"T10",lancer:"T10",marksman:"T10"},ratios:{shield:34,lancer:33,marksman:33}})) as unknown as NonNullable<typeof value.threeQueues>});
const input:ValidationBattleInput={...base,scenarioType:"ICE_FIRE_LEAGUE",attributeInputMode:"prediction",maxRounds:1500,
  availableHeroIds:[],sideA:side(base.sideA),sideB:side(base.sideB)};
writeFileSync(resolve("examples/ice-fire-search-validation-input.json"),JSON.stringify(input,null,2));
const started=performance.now();let last="";
const result=optimizeThreeQueueScenario(input,{...defaultThreeQueueOptimizationOptions(991),
  lockHeroes:[true,true,true],profiling:true},(progress)=>{
  if(progress.stage!==last){last=progress.stage;console.log(last);}
});
const schemas=(["GEM_MINE","EQUIPMENT_FORGE"] as const).map((mode)=>{
  const fixture=normalizeInnerEarthInput(base,createDefaultInnerEarthConfig(base,mode)),html=renderInnerEarthForm(fixture);
  return {mode,mySchema:innerEarthAttributeSchema(mode,"ally"),enemySchema:innerEarthAttributeSchema(mode,"enemy"),
    myAttributeFieldCount:ATTRIBUTE_SCHEMA_FIELDS[innerEarthAttributeSchema(mode,"ally")].length,
    enemyAttributeFieldCount:ATTRIBUTE_SCHEMA_FIELDS[innerEarthAttributeSchema(mode,"enemy")].length,
    renderedMyAttributeFieldCount:(html.match(/data-field="compact-attribute" data-side="ally"/g)??[]).length};
});
const previous=JSON.parse(readFileSync(resolve("examples/inner-earth-ui-core-boundary-audit.json"),"utf8").replace(/^\uFEFF/,"")) as {checks:{path:string;after:string}[]};
const checks=previous.checks.map(({path,after})=>{const current=createHash("sha256").update(readFileSync(resolve(path))).digest("hex");return {path,before:after,after:current,unchanged:after===current};});
const audit={generatedAt:new Date().toISOString(),fixture:"six empty heads, each side capacity 300, T10, 240% each stat; not the user's unavailable failing report",elapsedMs:performance.now()-started,
  iceFireSearch:result.criterionAudit,formalRacing:result.formalRacingAudit,formalStages:result.formalStages,
  currentWinRate:result.current.winRate,recommendedWinRate:result.topCandidates[0]?.winRate,
  scheduler:result.schedulerAudit,recommendedScheduler:result.recommendedSchedulerAudit,performance:result.searchPerformanceReport,
  freshRestartEquivalentTrajectories:result.formalStages!.reduce((sum,s)=>sum+s.trials*s.candidates,0),
  actualSimulatedTrajectories:result.performance.simulatedTrials,schemas,
  ocr:{troopRecognitionEnabled:false,attributeRecognitionEnabled:true},
  failedSeedReproduction:{status:"awaitingActualConfig",seeds:[3010811274,3010811334,3010811340,3010811341,3010811481]},
  coreBoundary:{checkedFiles:checks.length,allUnchanged:checks.every((row)=>row.unchanged),checks}};
writeFileSync(resolve("examples/ice-fire-schema-audit.json"),JSON.stringify(audit,null,2));
console.log(JSON.stringify({elapsedMs:audit.elapsedMs,actualSimulatedTrajectories:audit.actualSimulatedTrajectories,
  freshRestartEquivalentTrajectories:audit.freshRestartEquivalentTrajectories,formalRacing:audit.formalRacing,
  scheduler:audit.scheduler,schemas,coreUnchanged:audit.coreBoundary.allUnchanged},null,2));
if(!audit.coreBoundary.allUnchanged)throw new Error("Formal core changed");
