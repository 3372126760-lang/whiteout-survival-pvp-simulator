import type { ValidationBattleInput } from "../pvp/validationUi/types";
import { getInnerEarthConfig } from "../pvp/innerEarth";
import { TROOP_TYPES } from "../pvp/types/combat";
import { troopPortrait, troopFrame, crystalBadge, t12SkillIcon, troopIcon } from "./gameArtwork";
import { allocateDeployment } from "./troopDeploymentView";
const names = {shield:"盾兵",lancer:"矛兵",marksman:"射手"};
const stats = {attack:"攻击力",defense:"防御力",penetration:"穿透力",life:"生命值"} as const;
export function renderInnerEarthReport(input: ValidationBattleInput): string {
 const c = getInnerEarthConfig(input), queued = ["HEART_OF_EARTH","HERO_LAND"].includes(c.subMode);
 const enemyRatios = c.enemy.shared.troopRatioPreset === "SHIELD_HEAVY" ? {shield:800/15,lancer:400/15,marksman:20} : {shield:100/3,lancer:100/3,marksman:100/3};
 const enemyCounts = allocateDeployment(c.enemy.shared.capacity,enemyRatios);
 return Array.from({length:queued ? 3 : 1},(_,index) => {
 const allyCounts = queued ? allocateDeployment(c.ally.shared.capacity,c.ally.queues[index]!.ratio) : c.ally.counts;
 const attributes = queued ? c.ally.queues[index]!.expectedReportStats : c.ally.reportStats;
 const totals = [allyCounts,enemyCounts].map(counts=>TROOP_TYPES.reduce((n,t)=>n+counts[t],0));
 return `<section class="earth-battle-report"><h3>${queued ? `第${index+1}队对照` : "双方部队对照"}</h3><div class="report-troops-totals">${totals.map((total,i)=>`<div class="side-${i ? "b":"a"}"><div class="report-side-caption">${i ? "B · 敌方":"A · 我方"}</div><p>初始部队</p><strong>${total.toLocaleString("zh-CN")}</strong></div>`).join("")}</div><div class="report-armies">${[allyCounts,enemyCounts].map((counts,i)=>`<div class="report-army side-${i ? "b":"a"}">${TROOP_TYPES.map(t=>{
 const tier = i ? "T10" : c.ally.troopTiers[t];
 const level = /(?:^T|LAB_T)(\d+)/.exec(tier)?.[1] ?? "10";
 return `<article class="report-soldier"><h3>${troopIcon(t)}${names[t]}</h3><div class="report-soldier-image" data-frame="${troopFrame(tier)}">${troopPortrait(t,tier)}${crystalBadge(tier)}<span class="report-soldier-rank">${level}.0级</span></div><span class="report-soldier-tier">${tier.startsWith("LAB_") ? `T${level} · 无火晶` : tier}</span><div class="report-soldier-level"><strong>${counts[t].toLocaleString("zh-CN")}</strong><small>${totals[i] ? (counts[t]/totals[i]!*100).toFixed(2) : "0.00"}%</small></div>${!i && tier.includes("T12") ? `<div class="report-soldier-skill">${t12SkillIcon(t)}<span>T12 技能<b>${c.ally.t12SkillLevels[t]} 级</b></span></div>`:""}</article>`;
 }).join("")}</div>`).join("")}</div><table class="report-stat-table earth-stat-table"><caption>属性加成</caption><thead><tr><th>A 方</th><th>属性名称</th><th>B 方</th></tr></thead><tbody>${TROOP_TYPES.map(t=>(Object.keys(stats) as (keyof typeof stats)[]).map(stat=>{
 const a=attributes[t][stat], b=c.enemy.shared.expectedReportStats[t][stat];
 return `<tr><td class="earth-stat-${a>b ? "higher":a<b ? "lower":"equal"}">+${a.toFixed(1)}%</td><th scope="row">${names[t]}${stats[stat]}</th><td class="earth-stat-${b>a ? "higher":b<a ? "lower":"equal"}">+${b.toFixed(1)}%</td></tr>`;
 }).join("")).join("")}</tbody></table></section>`;
 }).join("");
}

