import { DEFAULT_EXTERNAL_BUFF_CONFIG, STANDARD_PET_LEVELS, PET_DEFENSE_REDUCTION_LEVELS,
  PET_PENETRATION_REDUCTION_LEVELS, PET_LIFE_REDUCTION_LEVELS, TOWN_BUFF_RATES } from "../pvp/externalBuffs/data";
import type { ExternalBuffConfig } from "../pvp/externalBuffs";

export type CombatBuffPreset = "small" | "large" | "pets" | "off";
/** The same canonical tables drive manual inputs and presets. Capacity fields do
 * not belong to ExternalBuffConfig; experts are deliberately preserved. */
export function combatBuffPreset(config: ExternalBuffConfig, preset: CombatBuffPreset): ExternalBuffConfig {
  if (preset === "small" || preset === "large") {
    if (!Number.isFinite(TOWN_BUFF_RATES[preset])) throw new Error("城镇预设缺少canonical定义。");
    return { ...config, town: Object.fromEntries(Object.keys(DEFAULT_EXTERNAL_BUFF_CONFIG.town)
      .map((field) => [field, preset])) as unknown as ExternalBuffConfig["town"] };
  }
  return { ...config,
    ...(preset === "off" ? { town: { ...DEFAULT_EXTERNAL_BUFF_CONFIG.town } } : {}),
    pet: preset === "off" ? { ...DEFAULT_EXTERNAL_BUFF_CONFIG.pet } : {
      attackLevel: STANDARD_PET_LEVELS.length - 1, defenseLevel: STANDARD_PET_LEVELS.length - 1,
      penetrationLevel: STANDARD_PET_LEVELS.length - 1, lifeLevel: STANDARD_PET_LEVELS.length - 1,
      enemyDefenseReductionLevel: PET_DEFENSE_REDUCTION_LEVELS.length - 1,
      enemyPenetrationReductionLevel: PET_PENETRATION_REDUCTION_LEVELS.length - 1,
      enemyLifeReductionLevel: PET_LIFE_REDUCTION_LEVELS.length - 1,
    } };
}
export function renderCombatBuffPresets(side: string, petsOnly = false): string {
  return `<div class="profile-actions combat-buff-presets">${([
    ...(!petsOnly ? [["small", "一键小药"], ["large", "一键大药"]] : []),
    ["pets", "宠物全开"], ["off", "一键关闭"],
  ]).map(([preset, label]) => `<button type="button" class="btn btn-small" data-action="combat-buff-preset" data-side="${side}" data-preset="${preset}">${label}</button>`).join("")}</div>`;
}
