import { TROOP_TYPES, type SideId, type TroopType } from "../pvp/types/combat";
import type { ValidationBattleInput } from "../pvp/validationUi/types";

const troops: Record<TroopType, string> = { shield: "盾兵", lancer: "矛兵", marksman: "射手" };
const stats = { attack: "攻击力", defense: "防御力", penetration: "穿透力", life: "生命值" } as const;

/** Values bind directly to the canonical battle input; the report is only a view. */
export function renderReportAttributeComparison(input: ValidationBattleInput): string {
  const field = (side: SideId, troop: TroopType, stat: keyof typeof stats) => {
    const value = (side === "A" ? input.sideA : input.sideB).troops[troop][stat];
    const other = (side === "A" ? input.sideB : input.sideA).troops[troop][stat];
    const comparison = value > other ? "higher" : value < other ? "lower" : "equal";
    return `<td class="report-stat-value side-${side.toLowerCase()}"><label><span class="sr-only">${side}方${troops[troop]}${stats[stat]}</span><span class="report-percent"><input class="report-stat-${comparison}" aria-label="${side}方${troops[troop]}${stats[stat]}" data-scope="troop" data-side="${side}" data-troop="${troop}" data-field="${stat}" type="text" inputmode="decimal" value="${value > 0 ? "+" : ""}${value}"><span>%</span></span></label></td>`;
  };
  return `<div class="report-stats-editor"><div class="report-stat-source"><label>属性来源<select data-scope="player-attribute-source"><option value="report" ${input.attributeInputMode !== "prediction" ? "selected" : ""}>最终战报 · 已含增益</option><option value="base" ${input.attributeInputMode === "prediction" ? "selected" : ""}>基础面板 · 另行配置增益</option></select></label><p>${input.attributeInputMode === "prediction" ? "填写基础面板数值；特殊加成会计入预计最终属性。" : "照抄战报中的最终百分比，已包含的特殊加成不会重复叠加。"}</p><button class="btn report-special-buffs-button" data-action="special-buffs-open" aria-haspopup="dialog">特殊加成 ⚙</button></div><table class="report-stat-table"><caption>双方部队属性加成</caption><thead><tr><th scope="col">A 方</th><th scope="col">属性名称</th><th scope="col">B 方</th></tr></thead>${TROOP_TYPES.map(troop => `<tbody><tr class="report-troop-divider"><th colspan="3" scope="rowgroup">${troops[troop]}</th></tr>${(Object.keys(stats) as (keyof typeof stats)[]).map(stat => `<tr>${field("A", troop, stat)}<th scope="row">${troops[troop]}${stats[stat]}</th>${field("B", troop, stat)}</tr>`).join("")}</tbody>`).join("")}</table><p class="hint">可输入 +4527.7 或 4527.7，单位为 %。每行左侧 A 方、右侧 B 方；属性与战报逐项对应。绿色表示本项较高，红色表示本项较低。</p></div>`;
}
