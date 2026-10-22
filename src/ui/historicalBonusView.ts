import { historicalReportBonuses, HISTORICAL_STATS } from "../pvp/validationUi/historicalBonuses";
import type { SideId } from "../pvp/types";
import type { ValidationSideInput, ValidationQueueConfig } from "../pvp/validationUi/types";
const labels = { attack: "攻击", defense: "防御", penetration: "穿透", life: "生命" };
export function renderHistoricalBonusTable(sideId: SideId, side: ValidationSideInput | ValidationQueueConfig, queueIndex?: number): string {
  const history = historicalReportBonuses(side);
  const location = `data-side="${sideId}" ${queueIndex === undefined ? "" : `data-queue-index="${queueIndex}"`}`;
  return `<div class="table-scroll"><table class="data-table historical-bonuses-table"><thead><tr><th>属性</th><th>官职加成 %</th><th>BUFF %</th><th>受到 DEBUFF %</th></tr></thead><tbody>${HISTORICAL_STATS.map((stat) =>
    `<tr><th scope="row">${labels[stat]}</th>${(["additive", "buff", "debuff"] as const).map((field) => `<td><input aria-label="历史${labels[stat]}${{ additive: "官职加成", buff: "BUFF", debuff: "受到DEBUFF" }[field]}%" type="text" inputmode="decimal" data-scope="bonus-context" ${location} data-context="sourceReportBonuses" data-stat="${stat}" data-field="${field}" value="${history[stat][field]}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
