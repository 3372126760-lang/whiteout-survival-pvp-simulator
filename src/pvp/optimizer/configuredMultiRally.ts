import {createValidationBattleCompiler} from "../validationUi/adapter";
import type {ValidationBattleInput,ValidationSideInput} from "../validationUi/types";
import {TROOP_TYPES} from "../types/combat";
import {deriveWaveSeed,createStageSeeds} from "./seedSet";
import type {TroopSurvivors} from "./types";

export interface ConfiguredMultiRallyResult {
 readonly attacks: readonly ValidationSideInput[];
 readonly trials:number; readonly wins:number; readonly winRate:number;
 readonly waveWinRates:readonly number[]; readonly enemyRemainingMean:TroopSurvivors;
}
export interface ConfiguredMultiRallyOptimizationResult {
 readonly current: ConfiguredMultiRallyResult;
 readonly recommended: ConfiguredMultiRallyResult;
 readonly screeningTrials: number;
}
/** Fixed-length user-configured sequence; one defender, fresh independent attackers.
 * Counts carry between rallies using the same fresh-wave policy as the existing engine.
 * No minimization of wave count or probability threshold stopping rule.
 */
export function createConfiguredMultiRallyEvaluator(input:ValidationBattleInput) {
 const compile=createValidationBattleCompiler();
 const cache=new Map<string,ReturnType<typeof compile>>();
 const battleFor=(sideA:ValidationSideInput)=>{
  const key=JSON.stringify(sideA);
  let battle=cache.get(key);
  if(!battle){battle=compile({...input,scenarioType:"RALLY",battleContext:"rally",rallyMode:"single",rallyAttacks:[],sideA});cache.set(key,battle);if(cache.size>128)cache.delete(cache.keys().next().value!);}
  return battle;
 };
 return (attacks:readonly ValidationSideInput[],seeds:readonly number[]):ConfiguredMultiRallyResult=>{
  if(!attacks.length || attacks.length>10 || !seeds.length)throw new Error("多集结需要1至10支进攻部队及非空种子。");
  const battles=attacks.map(battleFor), defender=battles[0]!.initialState.sideB;
  const initial=Object.fromEntries(TROOP_TYPES.map(t=>[t,defender.troops[t].aliveCount])) as unknown as TroopSurvivors;
  const sums={shield:0,lancer:0,marksman:0},defeated=attacks.map(()=>0);
  let wins=0;
  for(const seed of seeds){
   let enemy:TroopSurvivors={...initial};
   for(let wave=0;wave<battles.length;wave++){
    if(TROOP_TYPES.some(t=>enemy[t]>0))enemy=battles[wave]!.runFastFreshTrial(deriveWaveSeed(seed,wave),enemy).remaining.B;
    if(TROOP_TYPES.every(t=>enemy[t]===0))defeated[wave]!++;
   }
   if(TROOP_TYPES.every(t=>enemy[t]===0))wins++;
   for(const t of TROOP_TYPES)sums[t]+=enemy[t];
  }
  return {attacks:[...attacks],trials:seeds.length,wins,winRate:wins/seeds.length,waveWinRates:defeated.map(n=>n/seeds.length),enemyRemainingMean:{shield:sums.shield/seeds.length,lancer:sums.lancer/seeds.length,marksman:sums.marksman/seeds.length}};
 };
}
/** Coordinate refinement keeps the configured number of rallies fixed. */
export function optimizeConfiguredMultiRally(input:ValidationBattleInput, choices:readonly (readonly ValidationSideInput[])[],seed:number,trials=100,verificationTrials=1000):ConfiguredMultiRallyOptimizationResult {
 const current=input.rallyAttacks?.length?input.rallyAttacks:[input.sideA];
 if(choices.length!==current.length || choices.some(rows=>!rows.length || rows.length>30))throw new Error("每波候选需与配置波数一致，且为1至30个。");
 if(!Number.isSafeInteger(trials)||trials<1||trials>100000||!Number.isSafeInteger(verificationTrials)||verificationTrials<1||verificationTrials>100000)throw new Error("模拟场次无效。");
 const execute=createConfiguredMultiRallyEvaluator(input), screening=createStageSeeds(seed,trials);
 const results=new Map<string,ConfiguredMultiRallyResult>();
 const evaluate=(attacks:readonly ValidationSideInput[],seeds:readonly number[])=>{
  const key=JSON.stringify([attacks,seeds]);
  let result=results.get(key);
  if(!result){result=execute(attacks,seeds);results.set(key,result);}
  return result;
 };
 let attacks=[...current],best=evaluate(attacks,screening);
 for(let wave=0;wave<attacks.length;wave++)for(const choice of choices[wave]!){
  const next=attacks.map((a,i)=>i===wave?choice:a),row=evaluate(next,screening);
  if(row.winRate>best.winRate){attacks=next;best=row;}
 }
 const screeningSet=new Set(screening);let offset=900000;const independent:number[]=[];
 while(independent.length<verificationTrials){independent.push(...createStageSeeds(seed,verificationTrials,offset).filter(s=>!screeningSet.has(s)&&!independent.includes(s)));offset+=verificationTrials;}
 const seeds=independent.slice(0,verificationTrials);
 const baseline=evaluate(current,seeds),challenger=evaluate(attacks,seeds);
 return {current:baseline,recommended:challenger.winRate>baseline.winRate?challenger:baseline,screeningTrials:trials};
}
