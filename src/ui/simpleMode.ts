import { TROOP_TYPES, type SideId, type TroopType } from "../pvp/types/combat";
import type { ValidationBattleInput, ValidationSideInput } from "../pvp/validationUi/types";
import { allocateRallyTroopsByRatio, type RallyTroopRatios } from "../pvp/validationUi/rallyDeployment";

export type EditorMode = "simple" | "advanced";
export const EDITOR_MODE_KEY = "pvp.editor-mode";

/** View preference only. The caller owns the one canonical ValidationBattleInput. */
export function readEditorMode(storage: Pick<Storage, "getItem">): EditorMode {
  try { return storage.getItem(EDITOR_MODE_KEY) === "advanced" ? "advanced" : "simple"; }
  catch { return "simple"; }
}

export const SIMPLE_FIELD_MAP = {
  stage: "serverStage (shared by A/B)",
  hero: "sideA/sideB.leaderHeroIds[troop]",
  count: "sideA/sideB.troops[troop].count",
  totalAndRatios: "sideA/sideB.troops[*].count (existing ratio allocator)",
  reportAttribute: "sideA/sideB.troops[troop][attribute] (percentage points)",
  buffs: "sideA/sideB.externalBuffs",
  weapon: "sideA/sideB.simulationWeaponLevels[heroId]",
  bodyHeroes: "sideA/sideB.bodySkills / selectedMemberSkillIds",
  simulationCount: "batchCount (existing simulation setting)",
  randomSimulation: "simulationMode",
} as const;

export const simpleSide = (input: ValidationBattleInput, side: SideId): ValidationSideInput =>
  side === "A" ? input.sideA : input.sideB;

export function withSimpleSide(input: ValidationBattleInput, side: SideId,
  value: ValidationSideInput): ValidationBattleInput {
  return { ...input, [side === "A" ? "sideA" : "sideB"]: value };
}

/** Special scene deployment/mixed-level composition stays with its existing editor. */
export function canEditSimpleTroops(input: ValidationBattleInput, side: SideId): boolean {
  return (input.scenarioType === undefined || input.scenarioType === "SINGLE" || input.scenarioType === "CITY_DEFENSE" || input.scenarioType === "RALLY") &&
    !(input.battleContext === "rally" && input.attributeInputMode === "prediction") &&
    TROOP_TYPES.every((troop) => simpleSide(input, side).troops[troop].levelMode !== "mixed");
}

export function simpleTroopTotal(input: ValidationBattleInput, side: SideId): number {
  return TROOP_TYPES.reduce((sum, troop) => sum + simpleSide(input, side).troops[troop].count, 0);
}

/** Basis-point rounding affects only the percentage editor, never a mode switch. */
export function simpleTroopRatios(input: ValidationBattleInput, side: SideId): RallyTroopRatios {
  const total = simpleTroopTotal(input, side);
  if (total === 0) return { shield: 50, lancer: 0, marksman: 50 };
  const counts = allocateRallyTroopsByRatio({ totalTroops: 10_000,
    ratios: Object.fromEntries(TROOP_TYPES.map((troop) =>
      [troop, simpleSide(input, side).troops[troop].count / total * 100])) as unknown as RallyTroopRatios });
  return { shield: counts.shield / 100, lancer: counts.lancer / 100, marksman: counts.marksman / 100 };
}

export function validSimpleRatios(ratios: RallyTroopRatios): boolean {
  return TROOP_TYPES.every((troop) => Number.isFinite(ratios[troop]) && ratios[troop] >= 0 && ratios[troop] <= 100) &&
    Math.abs(TROOP_TYPES.reduce((sum, troop) => sum + ratios[troop], 0) - 100) < 1e-8;
}

export function setSimpleCounts(input: ValidationBattleInput, side: SideId,
  counts: Readonly<Record<TroopType, number>>): ValidationBattleInput {
  if (!canEditSimpleTroops(input, side)) throw new Error("此配兵方式请在高级模式编辑。");
  if (!TROOP_TYPES.every((troop) => Number.isSafeInteger(counts[troop]) && counts[troop] >= 0) ||
    !Number.isSafeInteger(TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0))) {
    throw new Error("兵量必须是非负整数，且总兵力不能超过安全整数范围。");
  }
  const current = simpleSide(input, side);
  return withSimpleSide(input, side, { ...current, troops: Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, { ...current.troops[troop], count: counts[troop], resolutionSource: "userOverride" }])) as ValidationSideInput["troops"] });
}

export function setSimpleRatios(input: ValidationBattleInput, side: SideId,
  total: number, ratios: RallyTroopRatios): ValidationBattleInput {
  if (!validSimpleRatios(ratios)) throw new Error("盾、矛、射比例之和必须为 100%。");
  return setSimpleCounts(input, side, allocateRallyTroopsByRatio({ totalTroops: total, ratios }));
}

/** Copy exactly the twelve displayed values; keep lineup/provenance/buffs untouched. */
export function copySimpleAttributes(input: ValidationBattleInput, from: SideId): ValidationBattleInput {
  const source = simpleSide(input, from), to = from === "A" ? "B" : "A", target = simpleSide(input, to);
  return withSimpleSide(input, to, { ...target, troops: Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, { ...target.troops[troop], ...Object.fromEntries(
      (["attack", "defense", "penetration", "life"] as const).map((field) => [field, source.troops[troop][field]])) }])) as ValidationSideInput["troops"] });
}

export function playerConfidence(statuses: readonly string[]): { label: string; warning: boolean; description: string } {
  if (statuses.includes("CONFLICT")) return { label: "存在规则冲突", warning: true, description: "该英雄部分技能存在规则冲突，请结合实际战报判断。" };
  if (statuses.some((status) => status === "TENTATIVE" || status === "RULE_UNKNOWN")) return {
    label: "部分待验证", warning: true, description: "该英雄部分技能尚未经过PVP战报完整验证。" };
  if (statuses.length > 0 && statuses.every((status) => status === "BATTLE_CONFIRMED")) return {
    label: "已验证", warning: false, description: "所选英雄技能已通过战报验证。" };
  // Existing `supported` means implemented. It is not evidence of battle confirmation.
  return { label: "模型已实现", warning: true, description: "该英雄部分技能尚未经过PVP战报完整验证。" };
}
