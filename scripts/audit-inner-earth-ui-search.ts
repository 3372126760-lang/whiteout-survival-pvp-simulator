import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {performance} from "node:perf_hooks";
import {createDefaultValidationInput} from "../src/ui/defaultInput";
import {renderInnerEarthForm} from "../src/ui/innerEarthView";
import {createDefaultInnerEarthConfig,normalizeInnerEarthInput,INNER_EARTH_MODES} from "../src/pvp/innerEarth";
import {innerEarthAttributeSchema} from "../src/pvp/validationUi/attributeSchema";
import {createValidationPreviewState,getValidationCatalog} from "../src/pvp/validationUi";
import {optimizeInnerEarth,defaultInnerEarthOptimizationOptions} from "../src/pvp/optimizer/innerEarthOptimizer";
import {optimizeThreeQueueScenario,defaultThreeQueueOptimizationOptions} from "../src/pvp/optimizer/threeQueueOptimizer";
const root=process.cwd(),base=createDefaultValidationInput();
const schemaAudit=INNER_EARTH_MODES.map((mode)=>{
 const input=normalizeInnerEarthInput(base,createDefaultInnerEarthConfig(base,mode)),html=renderInnerEarthForm(input);
 const fields=[...html.matchAll(/<input[^>]+data-field="(?:compact-attribute|attribute)"[^>]+>/g)].map((m)=>m[0]);
 return {mode,allySchema:innerEarthAttributeSchema(mode,"ally"),enemySchema:innerEarthAttributeSchema(mode,"enemy"),
 allyInputs:fields.filter((field)=>field.includes('data-side="ally"')).length,enemyInputs:fields.filter((field)=>field.includes('data-side="enemy"')).length,formalAttributesPerSidePerQueue:12};
});
const lab=normalizeInnerEarthInput(base,createDefaultInnerEarthConfig(base,"UNDERGROUND_LAB"));
const selected={...lab,innerEarth:{...lab.innerEarth!,ally:{...lab.innerEarth!.ally,troopTiers:{shield:"T10",lancer:"LAB_T11",marksman:"LAB_T12"},t12SkillLevels:{shield:0,lancer:0,marksman:3}}}};
const labState=createValidationPreviewState(selected);
const levelAudit={allyConstants:Object.fromEntries(["shield","lancer","marksman"].map((t)=>[t,labState.sideA.troops[t as "shield"].troopConstant])),enemyTiers:["T10","T10","T10"],t12VisibleFields:(renderInnerEarthForm(selected).match(/data-field="t12"/g)??[]).length};
const enabled=getValidationCatalog().leaderHeroes.filter((hero)=>hero.rarity==="SSR"&&(hero.generation??0)>=9&&(hero.generation??0)<=11).map((hero)=>hero.heroId);
const troop=(input:typeof base.sideA)=>({...input,deploymentCapacity:300,highestTroopLevels:{shield:"T10",lancer:"T10",marksman:"T10"},
 troops:Object.fromEntries(Object.entries(input.troops).map(([key,value])=>[key,{...value,count:100,troopLevel:"T10",t12Level:0}])) as typeof input.troops});
const configured={...base,maxRounds:200,availableHeroIds:enabled,sideA:troop(base.sideA),sideB:troop(base.sideB)};
const runs:unknown[]=[];
if(!process.argv.includes("--audit-only")) for(const mode of ["ICE_FIRE_LEAGUE","HEART_OF_EARTH","HERO_LAND"] as const){
 const start=performance.now();let last="";
 const progress=(p:{stage:string})=>{if(p.stage!==last){last=p.stage;console.log(`${mode}: ${p.stage}`);}};
 const input=mode==="ICE_FIRE_LEAGUE"?{...configured,scenarioType:"ICE_FIRE_LEAGUE" as const,attributeInputMode:"prediction" as const}
 :normalizeInnerEarthInput(configured,createDefaultInnerEarthConfig(configured,mode));
 const result=mode==="ICE_FIRE_LEAGUE"?optimizeThreeQueueScenario(input,defaultThreeQueueOptimizationOptions(731),progress)
 :optimizeInnerEarth(input,defaultInnerEarthOptimizationOptions(731),progress).result;
 if(result.scenarioType!=="THREE_QUEUE")throw new Error("Expected three queues");
 const run={mode,elapsedMs:Math.round(performance.now()-start),criterion:result.criterionAudit,formalStages:result.formalStages,
 finalValidationCount:result.finalValidationCount,currentWinRate:result.current.winRate,finalWinRate:result.topCandidates[0]?.winRate,
 failedTrials:result.topCandidates.map((row)=>row.failedTrials),performance:result.performance};
 runs.push(run);writeFileSync(resolve(root,"examples/inner-earth-search-benchmark.json"),JSON.stringify({generatedAt:new Date().toISOString(),schemaAudit,levelAudit,runs},null,2));
 console.log(`${mode} completed: ${run.elapsedMs} ms; final=${run.finalWinRate}; formal candidates=${result.searchedCandidateCount}`);
}
const previous=JSON.parse(readFileSync(resolve(root,"examples/ice-fire-lineage-core-boundary-audit.json"),"utf8").replace(/^\uFEFF/,"")) as {checks:{path:string;after:string}[]};
const checks=previous.checks.map(({path,after})=>{const current=createHash("sha256").update(readFileSync(resolve(root,path))).digest("hex");return {path,before:after,after:current,unchanged:after===current};});
const boundary={generatedAt:new Date().toISOString(),checkedFiles:checks.length,unchangedFiles:checks.filter((check)=>check.unchanged).length,changedFiles:checks.filter((check)=>!check.unchanged).map((check)=>check.path),allUnchanged:checks.every((check)=>check.unchanged),checks};
writeFileSync(resolve(root,"examples/inner-earth-ui-core-boundary-audit.json"),JSON.stringify(boundary,null,2));
console.log(JSON.stringify({schemaAudit,levelAudit,boundary:{checkedFiles:boundary.checkedFiles,allUnchanged:boundary.allUnchanged}},null,2));
if(!boundary.allUnchanged)throw new Error("Core battle boundary changed");
