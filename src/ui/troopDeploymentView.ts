import { TROOP_TYPES, type TroopType } from "../pvp/types/combat";
import { allocateRallyTroopsByRatio, type RallyTroopRatios } from "../pvp/validationUi/rallyDeployment";
import { validSimpleRatios } from "./simpleMode";

export type DeploymentCounts = Readonly<Record<TroopType, number>>;
const names = { shield: "盾兵", lancer: "矛兵", marksman: "射手" };
export function deploymentRatios(counts: DeploymentCounts): RallyTroopRatios {
  const total = TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0);
  if (!total) return { shield: 34, lancer: 33, marksman: 33 };
  const bp = allocateRallyTroopsByRatio({ totalTroops: 10000,
    ratios: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, counts[troop] / total * 100])) as unknown as RallyTroopRatios });
  return { shield: bp.shield / 100, lancer: bp.lancer / 100, marksman: bp.marksman / 100 };
}
export function allocateDeployment(totalTroops: number, ratios: RallyTroopRatios): DeploymentCounts {
  if (!validSimpleRatios(ratios)) throw new Error("盾、矛、射比例之和必须为100%。");
  return allocateRallyTroopsByRatio({ totalTroops, ratios });
}
export function renderTotalRatioDeployment(counts: DeploymentCounts, scope: string,
  draft?: RallyTroopRatios | null): string {
  const ratios = draft ?? deploymentRatios(counts), valid = validSimpleRatios(ratios);
  const total = TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0);
  return `<section class="total-ratio-deployment"><div class="inline-fields"><label>总出征数量<input type="number" min="0" step="1" data-scope="${scope}" data-field="total" value="${total}"></label>
    ${TROOP_TYPES.map((troop) => `<label>${names[troop]}比例 %<input type="text" inputmode="decimal" data-scope="${scope}" data-field="ratio" data-troop="${troop}" value="${ratios[troop]}"></label>`).join("")}</div>
    <p class="hint">比例合计 ${(ratios.shield + ratios.lancer + ratios.marksman).toFixed(2)}%。${valid ? "按比例分配后总兵力保持精确一致。" : "请将比例补齐为100%；完成前仍使用上次有效配兵。"}</p>
    <div class="readonly-grid">${TROOP_TYPES.map((troop) => `<span>实际${names[troop]} <strong data-deployment-count="${troop}">${counts[troop]}</strong></span>`).join("")}</div></section>`;
}
