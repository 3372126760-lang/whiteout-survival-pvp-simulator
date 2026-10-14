import { readFileSync,writeFileSync } from "node:fs";
import { parsePersistedJson } from "../src/storage";
import { runBodyAblation,type BodyAblationPlan } from "../src/pvp/optimizer/criterion/bodyAblation";
import { currentRallyRatios } from "../src/pvp/optimizer/candidateGenerator";
const args=process.argv.slice(2),value=(name:string)=>args[args.indexOf(name)+1];
if(!args.includes("--input"))throw new Error("用法: npm run debug:body-ablation -- --input 战斗配置.json [--trials 3000] [--plans 车身方案.json] [--output examples/body-ablation.json]");
const setup=parsePersistedJson(readFileSync(value("--input")!,"utf8")),input=setup.input;
const n="hero-skill.nuola.multi-troop-combat",w="hero-skill.wuming.wind-shelter",h="hero-skill.s8.hengdelike.defense-reduction",s="hero-skill.shuyun.attack",e="hero-skill.eleonora.sunlight-majesty";
const plans:BodyAblationPlan[]=args.includes("--plans")?JSON.parse(readFileSync(value("--plans")!,"utf8")):[
  {label:"P1 诺拉×2+亨德里克+书允",memberSkillIds:[n,n,h,s]},
  {label:"P2 无名×2+诺拉×2",memberSkillIds:[w,w,n,n]},
  {label:"P3 11盾×3+亨德里克",memberSkillIds:[e,e,e,h]},
  {label:"P4 诺拉×2+亨德里克×2",memberSkillIds:[n,n,h,h]},
  {label:"P5 诺拉×2+书允×2",memberSkillIds:[n,n,s,s]}];
const trials=args.includes("--trials")?Number(value("--trials")):3000;
const result=runBodyAblation(input,{leaderHeroIds:input.sideA.leaderHeroIds??{},headWeaponLevels:input.sideA.simulationWeaponLevels??{},memberSkillIds:[],ratios:currentRallyRatios(input)},plans,trials);
const output=args.includes("--output")?value("--output")!:"examples/body-ablation.json";writeFileSync(output,JSON.stringify(result,null,2));
process.stdout.write(JSON.stringify({output,trials,rows:result.rows.map((r)=>({label:r.label,winRate:r.winRate,wilson95:r.wilson95})),comparisons:result.comparisons},null,2)+"\n");
