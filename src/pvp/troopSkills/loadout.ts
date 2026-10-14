import type { TroopType } from "../types/combat";
import { isSupportedTroopLevel } from "../data/troopConstants";
import {
  LANCER_AMBUSH_SKILL_DEFINITION,
  LANCER_CHARGE,
  LANCER_CRIMSON_FIELD,
  LANCER_CRYSTAL_SPEAR,
  LANCER_RADIANT_FORMATION,
  MARKSMAN_BLAZING_STAR,
  MARKSMAN_CRYSTAL_POWDER,
  MARKSMAN_FLAME_IMPACT,
  MARKSMAN_RAPID_FIRE,
  MARKSMAN_REMOTE_STRIKE,
  SHIELD_CRYSTAL_SHIELD,
  SHIELD_DENSE_FORMATION,
  SHIELD_IMMORTAL_WALL,
  SHIELD_LIGHTFORGED_BODY,
  SHIELD_STEEL_GUARDIAN,
} from "./definitions";
import { createTroopSkillRuntimeState } from "./runtime";
import type { TroopSkillRuntimeState } from "./types";

export interface ParsedTroopProgression {
  readonly tier: number;
  readonly fireCrystalLevel: number;
}

export { SUPPORTED_TROOP_LEVELS } from "../data/troopConstants";

export function parseTroopProgression(
  troopLevel: string,
): ParsedTroopProgression | null {
  if (!isSupportedTroopLevel(troopLevel)) return null;
  const match = /^T(\d+)(?:-FC(\d+))?$/i.exec(troopLevel.trim());
  if (match === null) return null;
  const tier = Number(match[1]);
  const fireCrystalLevel = Number(match[2] ?? 0);
  if (!Number.isSafeInteger(tier) || tier < 1) return null;
  if (!Number.isSafeInteger(fireCrystalLevel) || fireCrystalLevel < 0) return null;
  return { tier, fireCrystalLevel };
}

export function createConfirmedTroopSkillLoadout(
  troopType: TroopType,
  troopLevel: string,
  t12Level = 0,
): readonly TroopSkillRuntimeState[] {
  if (!Number.isSafeInteger(t12Level) || t12Level < 0 || t12Level > 24) {
    throw new RangeError("T12 level must be an integer from 0 to 24.");
  }
  const progression = parseTroopProgression(troopLevel);
  if (progression === null) return [];
  const { tier, fireCrystalLevel: fc } = progression;
  const runtime = (
    skillId: string,
    level = 1,
  ): TroopSkillRuntimeState =>
    createTroopSkillRuntimeState(skillId, level, true);

  if (troopType === "shield") {
    return [
      runtime(SHIELD_DENSE_FORMATION.id),
      ...(tier >= 7 ? [runtime(SHIELD_STEEL_GUARDIAN.id)] : []),
      ...(fc >= 3 ? [runtime(SHIELD_CRYSTAL_SHIELD.id, fc >= 5 ? 2 : 1)] : []),
      ...(fc >= 8 ? [runtime(SHIELD_LIGHTFORGED_BODY.id, fc >= 10 ? 2 : 1)] : []),
      ...(tier >= 12 && t12Level > 0
        ? [runtime(SHIELD_IMMORTAL_WALL.id, t12Level)]
        : []),
    ];
  }
  if (troopType === "lancer") {
    return [
      runtime(LANCER_CHARGE.id),
      ...(tier >= 7 ? [runtime(LANCER_AMBUSH_SKILL_DEFINITION.id)] : []),
      ...(fc >= 3 ? [runtime(LANCER_CRYSTAL_SPEAR.id, fc >= 5 ? 2 : 1)] : []),
      ...(fc >= 8 ? [runtime(LANCER_CRIMSON_FIELD.id, fc >= 10 ? 2 : 1)] : []),
      ...(tier >= 12 && t12Level > 0
        ? [runtime(LANCER_RADIANT_FORMATION.id, t12Level)]
        : []),
    ];
  }
  return [
    runtime(MARKSMAN_REMOTE_STRIKE.id),
    ...(tier >= 7 ? [runtime(MARKSMAN_RAPID_FIRE.id)] : []),
    ...(fc >= 3
      ? [runtime(
          MARKSMAN_CRYSTAL_POWDER.id,
          fc >= 5 ? 2 : 1,
        )]
      : []),
    ...(fc >= 8 ? [runtime(MARKSMAN_FLAME_IMPACT.id, fc >= 10 ? 2 : 1)] : []),
    ...(tier >= 12 && t12Level > 0
      ? [runtime(MARKSMAN_BLAZING_STAR.id, t12Level)]
      : []),
  ];
}
