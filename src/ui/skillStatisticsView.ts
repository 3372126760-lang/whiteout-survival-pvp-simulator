import { renderSkillArt } from "./heroArtwork";
import { getValidationCatalog } from "../pvp/validationUi/catalog";
import type { ValidationBattleResult } from "../pvp/validationUi/types";
import type { BatchSimulationResult } from "../pvp/validationUi/batchSimulation";
import type { SkillDamageEstimate, SkillDamageStatistics } from "../pvp/statistics/skillDamageAttribution";
import { otherSide, SIDE_IDS, type SideId } from "../pvp/types/combat";

const escape = (value: string): string => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const number = (value: number): string => value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const skillNames = new Map(getValidationCatalog().skills.map((s) => [s.id, s.name]));
const POLICY = "独立单一来源事件的退出数是模型结算值；合并伤害池和连射内部段按伤害份额估算退出数。击败均为按目标正式战后分类换算的估算值，不是游戏真实技能击败。保留小数，不逐技能取整；技能归因不再加进总退出。纯属性/控场技能不估算反事实击败。";
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
function render(rows: readonly SkillStatisticsRow[], statistics: SkillDamageStatistics | undefined, batch: boolean): string {
  const prefix = batch ? "平均" : "";
  return `<div class="skill-damage-statistics"><p class="hint">${POLICY}${batch ? " 每场先结算及换算，再对所有模拟取均值；触发次数也显示每场均值。" : ""}</p>
    ${statistics === undefined ? '<p class="hint">旧结果未采集完整技能归因；保留旧退出记录，击败标为未确认，请重新模拟。</p>' : ""}
    <div class="table-scroll advanced-table-scroll"><table class="data-table"><thead><tr><th>阵营</th><th>技能名称</th><th>${prefix}触发次数</th><th>${prefix}HP伤害贡献</th><th>${prefix}退出战斗人数</th><th>${prefix}击败（估算）</th><th>退出归因</th></tr></thead><tbody>${rows.map((row) => {
      const c = row.contribution;
      return `<tr><td>${row.side}方</td><th><span class="skill-art-name">${renderSkillArt(row.skillId)}${escape(row.name)}</span></th><td>${row.activations === null ? "未采集" : number(row.activations)}</td>
        <td>${c ? number(c.hpDamage) : "—"}</td><td>${c ? number(c.exited) : row.legacyExited === undefined ? "—" : number(row.legacyExited)}</td>
        <td>${c ? c.defeatedEstimate === null ? "未确认" : number(c.defeatedEstimate) : statistics === undefined ? "未确认" : "—"}</td>
        <td>${c ? c.estimated ? "比例估算" : "单一事件结算" : row.legacyExited === undefined ? "无直接伤害归因" : "旧记录，来源未校验"}</td></tr>`;
    }).join("") || '<tr><td colspan="7">没有技能统计记录。</td></tr>'}</tbody></table></div>
    ${statistics === undefined ? "" : SIDE_IDS.map((side) => {
      const target = otherSide(side), defeated = statistics.actualDefeatedByTargetSide[target];
      return `<p class="hint">${side}→${target}：${prefix}实际总退出 ${number(statistics.totals[side].exited)}；${prefix}目标正式击败 ${defeated === null ? "未确认" : number(defeated)}（${statistics.casualtyModeByTargetSide[target] ?? "规则未确认"}）。普通攻击归因退出 ${number(statistics.normalAttack[side].exited)}；来源未确认退出 ${number(statistics.unattributed[side].exited)}。</p>`;
    }).join("")}
    ${statistics && Object.values(statistics.issues).some((count) => count > 0) ? '<p class="hint">存在不完整或多来源结算资料；未确认部分保留在未归因项，不回填给顶层技能。</p>' : ""}
    <button class="btn btn-small" data-action="export-skill-statistics" data-stat-source="${batch ? "batch" : "single"}">导出技能统计 JSON</button></div>`;
}
export function renderSingleSkillDamageStatistics(result: ValidationBattleResult): string {
  return render(singleRows(result), result.skillDamageStatistics, false);
}
export function renderBatchSkillDamageStatistics(result: BatchSimulationResult): string {
  return render(batchRows(result), result.skillDamageStatistics, true);
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
