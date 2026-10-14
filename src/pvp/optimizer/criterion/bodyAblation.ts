import { TROOP_TYPES, type SideId } from "../../types";
import { createValidationBattleCompiler, type ValidationBattleInput } from "../../validationUi";
import { createStageSeeds } from "../seedSet";
import { candidateToInput } from "../candidateGenerator";
import { wilsonInterval } from "../statistics";
import type { RallyCandidate } from "../types";
export interface BodyAblationPlan {readonly label:string;readonly memberSkillIds:readonly string[];}
/** Common-seed paired control. Head, ratio, levels, opponent and external panels
 * are fixed; only the four body skill sources are changed. */
export function runBodyAblation(input:ValidationBattleInput,head:RallyCandidate,plans:readonly BodyAblationPlan[],trials=3000,seed=input.randomSeed,side:SideId="A") {
  if(input.battleContext!=="rally"||plans.length<2)throw new Error("Body control needs a rally and at least two plans.");
  if(!Number.isSafeInteger(trials)||trials<1||trials>100000)throw new RangeError("Invalid ablation trial count.");
  const seeds=createStageSeeds(seed,trials,700000),compile=createValidationBattleCompiler();
  const rows=plans.map((plan)=>{const candidate={...head,headWeaponLevels:head.headWeaponLevels??input.sideA.simulationWeaponLevels??{},memberSkillIds:plan.memberSkillIds};const compiled=compile(candidateToInput(input,candidate));
    const results=seeds.map((s)=>compiled.runFastTrial(s)),wins=results.filter((r)=>r.outcome===side).length;
    return {label:plan.label,candidate,trials,wins,winRate:wins/trials,wilson95:wilsonInterval(wins,trials),
      remaining:Object.fromEntries((["A","B"] as const).map((side)=>[side,Object.fromEntries(TROOP_TYPES.map((t)=>[t,results.reduce((n,r)=>n+r.remaining[side][t],0)/trials]))])),results};});
  const baseline=rows[0]!;
  const comparisons=rows.slice(1).map((row)=>{
    let favorable=0,unfavorable=0,bothWin=0,bothLose=0;
    for(let i=0;i<trials;i++){const left=baseline.results[i]!.outcome===side,right=row.results[i]!.outcome===side;
      if(right&&!left)favorable++;else if(left&&!right)unfavorable++;else if(left)bothWin++;else bothLose++;}
    const delta=(favorable-unfavorable)/trials;
    const variance=trials>1?Math.max(0,(favorable+unfavorable-trials*delta*delta)/(trials-1)):0;
    // Empirical Bernstein on paired outcomes in [-1,1]. The finite-sample
    // term prevents a zero-width CI when all observed pairs agree.
    const log=Math.log(4/.05),radius=trials>1?Math.sqrt(2*variance*log/trials)+14*log/(3*(trials-1)):2;
    return {baseline:baseline.label,challenger:row.label,deltaWinRate:delta,paired95:[Math.max(-1,delta-radius),Math.min(1,delta+radius)],
      sameSeedPairs:{favorable,unfavorable,bothWin,bothLose},significantImprovement:delta-radius>0};});
  return {seed,trials,seedPolicy:"identical shared seeds for every body",headHeroIds:head.leaderHeroIds,headWeaponLevels:head.headWeaponLevels??input.sideA.simulationWeaponLevels??{},ratios:head.ratios,
    paired95Method:"empirical Bernstein bound, paired outcomes in [-1,1]",
    rows:rows.map(({results,...row})=>{void results;return row;}),comparisons,
    pairResults:seeds.map((seed,i)=>({seed,results:rows.map((row)=>({label:row.label,outcome:row.results[i]!.outcome,remaining:row.results[i]!.remaining}))}))};
}
