import {createConfiguredMultiRallyEvaluator,optimizeConfiguredMultiRally} from "../pvp/optimizer/configuredMultiRally";
import {runRallyOptimizationAsync} from "../pvp/optimizer";
import {candidateToInput} from "../pvp/optimizer/candidateGenerator";
import type {OptimizationConfig} from "../pvp/optimizer/types";
import {createOptimizerWorkerPool} from "./optimizerWorkerPool";
import {rescaleTroop} from "../pvp/optimizer/troopAllocation";
import {TROOP_TYPES} from "../pvp/types";
import {createStageSeeds} from "../pvp/optimizer/seedSet";
import type {ValidationBattleInput} from "../pvp/validationUi/types";
self.onmessage=(event:MessageEvent<{input:ValidationBattleInput;count:number;config?:OptimizationConfig}>)=>{void run(event.data);};
async function run({input,count,config}:{input:ValidationBattleInput;count:number;config?:OptimizationConfig}){
 const pool=config?createOptimizerWorkerPool():null;
 try{
  if(!Number.isSafeInteger(count)||count<1||count>100000)throw new Error("模拟次数须为1至100000");
  const attacks=input.rallyAttacks?.length?input.rallyAttacks:[input.sideA];
  if(config&&pool){
   const choices=[];
   for(const [index,sideA] of attacks.entries()){
    self.postMessage({progress:`搜索集结 ${index+1} / ${attacks.length}`});
    // Later attackers face the preceding waves' remaining defender. A small
    // prefix sample supplies a search guide; final ranking replays exact paths.
    let sideB=input.sideB;
    if(index>0){
     const remaining=createConfiguredMultiRallyEvaluator(input)(attacks.slice(0,index),createStageSeeds(config.firstSeed,12)).enemyRemainingMean;
     const counts=Object.fromEntries(TROOP_TYPES.map(t=>[t,Math.floor(remaining[t])])) as Record<typeof TROOP_TYPES[number],number>;
     const total=TROOP_TYPES.reduce((n,t)=>n+counts[t],0);
     if(total>0)sideB={...sideB,troops:Object.fromEntries(TROOP_TYPES.map(t=>[t,rescaleTroop(sideB.troops[t],counts[t])])) as typeof sideB.troops,
      rallyDeployment:{totalTroops:total,ratios:{shield:counts.shield/total*100,lancer:counts.lancer/total*100,marksman:counts.marksman/total*100}}};
    }
    const waveInput={...input,sideA,sideB,rallyMode:"single" as const,rallyAttacks:[]};
    // Fixed heads belong to each wave, never to the wave currently visible in the editor.
    const constraints={...config.constraints,
     ...(config.constraints.fixedBodyExact?{fixedMemberSkillIds:sideA.bodySkills?.map(body=>body.skillId)??sideA.selectedMemberSkillIds}:{}),
     ...(config.constraints.fixedLeaders?{fixedLeaders:sideA.leaderHeroIds}: {})};
    const found=await runRallyOptimizationAsync(waveInput,{...config,constraints,candidateSide:"A",objectiveMode:"singleWin"},pool.run,
     p=>self.postMessage({progress:`集结 ${index+1} / ${attacks.length} · ${p.stage}`}));
    choices.push([sideA,...found.singleWaveTop.slice(0,5).map(row=>candidateToInput(waveInput,row.candidate).sideA)]);
   }
   self.postMessage({progress:"按完整多集结轨迹筛选，并用独立种子复验"});
   const optimization=optimizeConfiguredMultiRally(input,choices,config.firstSeed,Math.min(300,count),count);
   self.postMessage({optimization});
  }else{
   const result=createConfiguredMultiRallyEvaluator(input)(attacks,createStageSeeds(input.randomSeed,count));
   self.postMessage({result});
  }
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
 finally{pool?.close();}
}
