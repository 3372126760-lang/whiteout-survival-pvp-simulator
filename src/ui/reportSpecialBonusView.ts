import type { ParsedBattleReport, ReportSourceSide } from "../pvp/battleReportRecognition/types";
import type { SpecialBonusCompleteness } from "../pvp/battleReportRecognition/types";
import type { SideId } from "../pvp/types/combat";
import type { TroopType } from "../pvp/types/combat";
import { previewReportContextAttribute } from "../pvp/battleReportRecognition/mapping";
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const options = (entries: readonly (readonly [string, string])[], selected: string) => entries.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
const groups = [["additive", "官职加算"], ["buffs", "Buff乘区"], ["debuffs", "Debuff除区"]] as const;
const stats = [["attack", "攻击"], ["defense", "防御"], ["penetration", "穿透"], ["life", "生命"]] as const;
const targets = [["self", "本侧"], ["enemy", "敌方"]] as const;
const troops = [["all", "全兵种"], ["shield", "盾"], ["lancer", "矛"], ["marksman", "射"]] as const;
/** Reads only the owned OCR preview, never official A/B battle inputs. */
export function renderReportRawAttributePreview(report: ParsedBattleReport, source: ReportSourceSide, owner: SideId,
  completeness: SpecialBonusCompleteness, cells: readonly { troop: TroopType; stat: "attack" | "defense" | "penetration" | "life" }[]): string {
  if (completeness === "incomplete") return "特殊加成待补齐";
  return cells.map(({troop,stat}) => {
    try {
      const preview = previewReportContextAttribute(report,source,owner,completeness,troop,stat);
      return `<span title="${escape(JSON.stringify(preview))}">${troops.find(([id]) => id === troop)![1]}${stats.find(([id]) => id === stat)![1]} ${preview.rawPercent.toFixed(2)}%</span>`;
    } catch (error) { return `<span class="field-error">${escape(error instanceof Error ? error.message : error)}</span>`; }
  }).join("<br>");
}
export function renderReportSpecialBonuses(report: ParsedBattleReport, owner: SideId, selected: ReportSourceSide, completeness: SpecialBonusCompleteness): string {
  const count = [report.left, report.right].reduce((n, column) => n + Object.values(column?.specialBonuses ?? {}).flat().length, 0);
  const columns = (["left", "right"] as const).map((source) => {
    const column = report[source]; if (!column) return "";
    const rows = groups.flatMap(([group]) => (column.specialBonuses?.[group] ?? []).map((item, index) => {
      const data = `data-scope="report-field" data-owner="${owner}" data-import-kind="special" data-source="${source}" data-group="${group}" data-index="${index}"`;
      const pending = item.conflict || !item.amount.confirmed && (item.amount.needsConfirmation || (item.amount.finalConfidence ?? item.amount.confidence) < .85);
      return `<tr><td><input ${data} data-field="bonus-label" type="text" value="${escape(item.label)}" title="${escape(JSON.stringify(item.sources))}"></td><td><input ${data} data-field="bonus" type="text" inputmode="decimal" value="${item.amount.value}">%</td><td><select ${data} data-field="bonus-group">${options(groups, group)}</select></td><td><select ${data} data-field="bonus-target">${options(targets, item.effectTarget ?? (group === "debuffs" ? "enemy" : "self"))}</select></td><td><select ${data} data-field="bonus-troop">${options(troops, item.troopScope ?? item.troop ?? "all")}</select></td><td><select ${data} data-field="bonus-stat">${options(stats,item.attribute)}</select></td><td>${pending ? "待确认" : "已确认"}<button class="btn btn-small" data-action="confirm-report-bonus" data-side="${owner}" data-source="${source}" data-group="${group}" data-index="${index}">确认此项</button>${(item.candidates ?? []).map((candidate, ci) => `<button class="btn btn-small" data-action="select-report-bonus-candidate" data-side="${owner}" data-source="${source}" data-group="${group}" data-index="${index}" data-candidate="${ci}">采用 ${candidate.amount.value}%</button>`).join("")}<button class="btn btn-small" data-action="remove-report-bonus" data-side="${owner}" data-source="${source}" data-group="${group}" data-index="${index}">删除</button></td></tr>`;
    })).join("");
    const unknown = (column.unmatchedBonuses ?? []).map((item, index) => `<div data-unknown-side="${owner}" data-unknown-source="${source}" data-unknown-index="${index}" class="queue-card"><strong>未归类：${escape(item.rawText)}</strong><div class="inline-fields"><input data-unknown-label type="text" value="${escape(item.rawText)}"><input data-unknown-value type="text" inputmode="decimal" value="${item.amount?.value ?? ""}"><select data-unknown-group>${options(groups, "buffs")}</select><select data-unknown-target>${options(targets, "self")}</select><select data-unknown-troop>${options(troops, "all")}</select><select data-unknown-stat>${options(stats, item.possibleAttribute ?? "attack")}</select><button class="btn btn-small" data-action="confirm-unknown-bonus" data-side="${owner}" data-source="${source}" data-index="${index}">核对并归类</button><button class="btn btn-small" data-action="remove-unknown-bonus" data-side="${owner}" data-source="${source}" data-index="${index}">删除</button></div></div>`).join("");
    return `<h4>${source === "left" ? "左侧" : "右侧"}特殊加成${source === selected ? "（历史本方）" : "（历史对方，敌方减益进入本方反推）"}</h4><div class="table-scroll"><table class="data-table"><thead><tr><th>名称</th><th>数值</th><th>乘区</th><th>目标</th><th>范围</th><th>属性</th><th>确认</th></tr></thead><tbody>${rows}</tbody></table></div>${unknown}<div class="inline-fields" data-bonus-form="${owner}-${source}"><input data-bonus-label type="text" placeholder="加成名称"><input data-bonus-value type="text" inputmode="decimal" placeholder="百分比"><select data-bonus-group>${options(groups, "buffs")}</select><select data-bonus-attribute>${options(stats, "attack")}</select><select data-bonus-troop>${options([["", "全兵种"], ...troops.slice(1)], "")}</select><button class="btn btn-small" data-action="add-report-bonus" data-side="${owner}" data-source="${source}">手工补充</button></div>`;
  }).join("");
  return `<section><h3>特殊加成识别 · 已识别 ${count} 项</h3><p class="hint">历史特殊加成页出现即视为生效；不按当前场景重新过滤。核对本方及历史对方减益后一次性应用。</p>${columns}<label>特殊加成完整性<select data-scope="report-special-completeness" data-side="${owner}">${options([["incomplete", "尚未完整（禁止应用）"], ["complete", "本方及对方相关加成已完整核对"], ["explicitZero", "明确确认本战报特殊加成为零"]], completeness)}</select></label></section>`;
}
