import { attributeResolvedDamage, damageEventSkillIds, damageEventSkillRoundedDamage, reportedSkillActivations } from "../pvp/statistics/skillDamageAttribution";
import { getActiveSkillUniverse } from "../pvp/validationUi/activeSkillUniverse";
import type { ValidationActiveSkillOption } from "../pvp/validationUi/types";
import { renderSkillArt, renderHeroPortrait } from "./heroArtwork";
import { getValidationCatalog } from "../pvp/validationUi/catalog";
import type { ValidationBattleResult } from "../pvp/validationUi/types";
import type { BatchSimulationResult } from "../pvp/validationUi/batchSimulation";
import type { SkillDamageEstimate, SkillDamageStatistics } from "../pvp/statistics/skillDamageAttribution";
import { otherSide, SIDE_IDS, TROOP_TYPES, type SideId } from "../pvp/types/combat";

const escape = (value: string): string => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const number = (value: number): string => value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const integer = (value: number): string => Math.round(value).toLocaleString("zh-CN");
const troopNames = { shield: "盾兵", lancer: "矛兵", marksman: "射手" };
const catalogSkills = getValidationCatalog().skills;
const skillNames = new Map(catalogSkills.map((s) => [s.id, s.name]));
const POLICY = "退出战斗人数表示伤害结算中退出的兵力，不再换算战后击败或受伤分类。当前独立事件采用实际整数退出；旧合并伤害记录仍按份额归因。增益或控制技能没有直接伤害时不归属退出人数。";
interface SkillStatisticsRow {
  side: SideId;
  skillId: string;
  name: string;
  activations: number | null;
  contribution: SkillDamageEstimate | null;
  legacyExited?: number;
}
function singleRows(result: ValidationBattleResult): SkillStatisticsRow[] {
  const rows = new Map<string, SkillStatisticsRow>();
  for (const entry of result.skillSummary) rows.set(`${entry.side}:${entry.skillId}`, {
    side: entry.side, skillId: entry.skillId, name: entry.skillName,
    activations: entry.actualActivationCount,
    contribution: result.skillDamageStatistics?.bySide[entry.side][entry.skillId] ?? null,
  });
  for (const side of SIDE_IDS) for (const [id, contribution] of Object.entries(result.skillDamageStatistics?.bySide[side] ?? {})) {
    if (!rows.has(`${side}:${id}`)) rows.set(`${side}:${id}`, { side, skillId: id,
      name: skillNames.get(id) ?? "未登记技能", activations: null, contribution });
  }
  return [...rows.values()];
}
function batchRows(result: BatchSimulationResult): SkillStatisticsRow[] {
  const rows: SkillStatisticsRow[] = [];
  for (const side of SIDE_IDS) {
    const probabilities = result.skillStatistics.filter((s) => s.side === side);
    const ids = new Set([...probabilities.map((s) => s.skillId),
      ...Object.keys(result.skillActivationCounts?.[side] ?? {}),
      ...Object.keys(result.skillDamageStatistics?.bySide[side] ?? result.meanSkillCasualties[side])]);
    for (const id of ids) {
      const probability = probabilities.find((s) => s.skillId === id);
      const activations = result.skillActivationCounts === undefined ? probability?.actualActivationCount
        : result.skillActivationCounts[side][id] ?? 0;
      rows.push({ side, skillId: id, name: probability?.skillName ?? skillNames.get(id) ?? "未登记技能",
        activations: activations === undefined ? null : activations / result.simulationCount,
        contribution: result.skillDamageStatistics?.bySide[side][id] ?? null,
        ...(result.skillDamageStatistics === undefined && result.meanSkillCasualties[side][id] !== undefined
          ? { legacyExited: result.meanSkillCasualties[side][id] } : {}) });
    }
  }
  return rows;
}
export function skillTriggerRecords(result: ValidationBattleResult, side: SideId, skillId: string) {
  return result.trace.rounds.flatMap(round => [...round.heroSkills, ...round.troopSkills]
    .filter(entry => entry.side === side && entry.skillId === skillId && entry.triggered)
    .map(entry => ({
      round: round.round, activations: reportedSkillActivations(entry), description: entry.uiSummary,
      damageEvents: round.damageEvents.filter(event => event.sourceSide === side)
        .map(event => ({ id: event.id, damage: damageEventSkillRoundedDamage(event, skillId) }))
        .filter(event => event.damage > 0),
    })));
}
export function compactSkillTriggerRecords(result: ValidationBattleResult, side: SideId, skillId: string) {
  const rounds = new Map<number, { activations: number; events: Map<string, number> }>();
  for (const record of skillTriggerRecords(result, side, skillId)) {
    const current = rounds.get(record.round) ?? { activations: 0, events: new Map<string, number>() };
    current.activations += record.activations;
    for (const event of record.damageEvents) current.events.set(event.id, event.damage);
    rounds.set(record.round, current);
  }
  return [...rounds].filter(([, record]) => record.activations > 0).map(([round, record]) => {
    const resolved = result.simulation.rounds.find(entry => entry.round === round);
    const contribution = resolved ? attributeResolvedDamage(resolved.trace.damageEvents, resolved.casualties).bySide[side][skillId] : undefined;
    const exits = TROOP_TYPES.flatMap(troop => {
      const count = contribution?.exitedByTargetTroop[troop] ?? 0;
      return count > 0 ? [{ troop, count }] : [];
    });
    const events = resolved?.trace.damageEvents.filter(event => event.sourceSide === side && damageEventSkillIds(event).includes(skillId)) ?? [];
    const eventIds = new Set(events.map(event=>event.id));
    const settlements = resolved?.casualties.filter(entry=>entry.sourceEvents.some(event=>eventIds.has(event.id))) ?? [];
    const priorTargetGone = settlements.length > 0 && settlements.every(entry => entry.troop.aliveCount === 0 && entry.casualties === 0);
    const shieldOnly = settlements.length > 0 && settlements.every(entry=>entry.absorbedDamage > 0 && entry.absorbedDamage === entry.temporaryShieldApplications.reduce((sum,shield)=>sum+shield.absorbedDamage,0));
    const emptyReason = events.length === 0 ? "无直接伤害记录" : priorTargetGone ? "目标已先行退出" : shieldOnly ? "伤害被护盾吸收" : "未造成兵力退出";
    return { round, exits, emptyReason, targets: [...new Set(events.map(event=>event.targetTroop))], damage: [...record.events.values()].reduce((sum, damage) => sum + damage, 0) };
  });
}
function render(rows: readonly SkillStatisticsRow[], statistics: SkillDamageStatistics | undefined, batch: boolean, layout: readonly ValidationActiveSkillOption[] = [], result?: ValidationBattleResult): string {
  const prefix = batch ? "平均" : "";
  const rowMarkup = (row: SkillStatisticsRow) => {
      const c = row.contribution;
      const records = result ? compactSkillTriggerRecords(result,row.side,row.skillId) : [];
      const attribution = c ? c.estimated ? "比例估算" : "单一事件结算" : row.legacyExited === undefined ? "无直接伤害归因" : "旧记录，来源未校验";
      return `<tr><th><span class="skill-art-name">${renderSkillArt(row.skillId)}${escape(row.name)}</span></th><td>${row.activations === null ? "未采集" : number(row.activations)}</td>
        <td>${c ? integer(c.exited) : row.legacyExited === undefined ? "—" : integer(row.legacyExited)}</td>
        </tr><tr class="skill-detail-row"><td colspan="3" class="skill-record-cell"><div class="skill-detail-panels"><details class="skill-row-details"><summary>伤害与归因</summary><dl><dt>${prefix}HP伤害贡献</dt><dd>${c ? integer(c.hpDamage) : "—"}</dd><dt>退出归因</dt><dd>${attribution}</dd></dl></details>
        <details class="skill-trigger-details"><summary>触发记录${batch ? "" : ` · ${records.length} 回合`}</summary>${batch ? '<p>批量结果仅保留汇总，未保存每场回合记录。运行单场可查看触发回合。</p>' : records.length ? `<table class="skill-round-table"><thead><tr><th>回合</th><th>退出战斗</th><th>对应兵种</th></tr></thead><tbody>${records.map(record=>{
 const exits=record.exits;
 return exits.length ? exits.map((entry,index)=>`<tr>${index === 0 ? `<td rowspan="${exits.length}">第 ${record.round} 回合</td>` : ""}<td><strong>${integer(entry.count)}</strong></td><td>敌方${troopNames[entry.troop]}</td></tr>`).join("") : `<tr><td>第 ${record.round} 回合</td><td title="${record.emptyReason}">${record.targets.length ? "0" : "—"}</td><td>${record.targets.length ? record.targets.map(troop=>`敌方${troopNames[troop]}`).join("、") : record.emptyReason}</td></tr>`;
 }).join("")}</tbody></table>` : '<p>本场没有已触发记录。</p>'}</details></div></td></tr>`;

  };
  const groups = ["盾兵 · 英雄技能","盾兵 · 兵种技能","矛兵 · 英雄技能","矛兵 · 兵种技能","射手 · 英雄技能","射手 · 兵种技能","车身技能","其他 / 来源待确认"];
  const classify = (row: SkillStatisticsRow) => {
    const active = layout.filter(s => s.side === row.side && s.id === row.skillId);
    const meta = active.find(s => s.position === "leader") ?? active[0] ?? catalogSkills.find(s => s.id === row.skillId);
    if (!meta) return 7;
    if (active.length && active.every(s => s.position === "member")) return 6;
    const troop = ["shield","lancer","marksman"].indexOf(meta.troopType);
    return troop < 0 ? 7 : troop * 2 + (meta.source === "troop" ? 1 : 0);
  };
  const ordered = (side: SideId) => rows.filter(r=>r.side===side && catalogSkills.find(s=>s.id===r.skillId)?.category !== "exclusiveWeapon" && !r.skillId.startsWith("hero-weapon-skill.")).slice().sort((a,b)=> {
    const ma=catalogSkills.find(s=>s.id===a.skillId), mb=catalogSkills.find(s=>s.id===b.skillId);
    return classify(a)-classify(b) || (ma?.expeditionSkillSlot ?? 9)-(mb?.expeditionSkillSlot ?? 9) || (ma?.definitionOrder ?? 999)-(mb?.definitionOrder ?? 999) || a.name.localeCompare(b.name,"zh-CN");
  });
  return `<div class="skill-damage-statistics"><p class="hint">${POLICY}${batch ? " 每场先结算及换算，再对所有模拟取均值；触发次数也显示每场均值。" : ""}</p>
    ${statistics === undefined ? '<p class="hint">旧结果未采集完整技能归因；保留旧退出记录，请重新模拟。</p>' : ""}
    <div class="skill-stat-sides">${SIDE_IDS.map(side=>`<section class="skill-stat-side side-${side.toLowerCase()}" aria-label="${side}方技能统计"><h3>${side} 方技能</h3><div class="table-scroll advanced-table-scroll"><table class="data-table"><colgroup><col style="width:50%"><col style="width:18%"><col style="width:32%"></colgroup><thead><tr><th>技能名称</th><th>${prefix}触发次数</th><th>${prefix}退出战斗人数</th></tr></thead>${groups.map((label,index)=> {
 const members=ordered(side).filter(row=>classify(row)===index);
 const heroIds = [...new Set(members.map(row => catalogSkills.find(skill => skill.id === row.skillId)?.heroId).filter((id): id is string => Boolean(id)))];
 const heroHeader = index < 6 && index % 2 === 0 ? heroIds.map(id => `<span class="skill-group-hero">${renderHeroPortrait(id)}${escape(getValidationCatalog().leaderHeroes.find(hero=>hero.heroId===id)?.name ?? "英雄")}</span>`).join("") : "";
 return `<tbody data-skill-group="${index}"><tr class="skill-stat-group"><th colspan="3"><span>${label}</span>${heroHeader}</th></tr>${members.map(rowMarkup).join("") || '<tr><td colspan="3">本场无此类技能记录</td></tr>'}</tbody>`;
 }).join("")}</table></div><p class="hint">同名技能沿用现有合并统计；主将与车身共同提供时归入主将兵种，不重复列入车身。</p></section>`).join("")}</div>
    ${statistics === undefined ? "" : SIDE_IDS.map((side) => {
      const target = otherSide(side);
      return `<p class="hint">${side}→${target}：${prefix}实际总退出 ${number(statistics.totals[side].exited)}。普通攻击归因退出 ${number(statistics.normalAttack[side].exited)}；来源未确认退出 ${number(statistics.unattributed[side].exited)}。</p>`;
    }).join("")}
    ${statistics && Object.values(statistics.issues).some((count) => count > 0) ? '<p class="hint">存在不完整或多来源结算资料；未确认部分保留在未归因项，不回填给顶层技能。</p>' : ""}
    <button class="btn btn-small" data-action="export-skill-statistics" data-stat-source="${batch ? "batch" : "single"}">导出技能统计 JSON</button></div>`;
}
export function renderSingleSkillDamageStatistics(result: ValidationBattleResult): string {
  return render(singleRows(result), result.skillDamageStatistics, false, getActiveSkillUniverse(result.initialState), result);
}
export function renderBatchSkillDamageStatistics(result: BatchSimulationResult): string {
  return render(batchRows(result), result.skillDamageStatistics, true, result.skillDisplayLayout);
}
/** Kept structured until the user explicitly requests a download. */
export function skillStatisticsExport(result: ValidationBattleResult | BatchSimulationResult) {
  const batch = "simulationCount" in result;
  return { format: "wos-pvp-skill-statistics", schemaVersion: 1, interpretation: POLICY,
    unit: batch ? "per-trial means; activation counts per trial" : "single battle",
    simulationCount: batch ? result.simulationCount : 1,
    firstSeed: batch ? result.firstSeed : result.input.randomSeed,
    lastSeed: batch ? result.lastSeed : result.input.randomSeed,
    rows: batch ? batchRows(result) : singleRows(result), statistics: result.skillDamageStatistics ?? null };
}
