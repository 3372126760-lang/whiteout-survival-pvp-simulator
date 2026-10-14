import type { ExternalBuffConfig, TownBuffSize } from "./types";
import { GARETH_FOURTH_SKILL_ID, resolveExpertSkillEffect, UnresolvedExpertSkillEffectError } from "./expertSkills";

/**
 * Mirrored read-only from:
 * C:/Users/33721/Desktop/无尽冬日/打熊伤害模型/
 * src/game-data/systems/progression.ts (audited 2026-09-20).
 */
export const STANDARD_PET_STAT_LEVELS = [
  0, .025, .03, .035, .04, .05, .06, .07, .08, .09, .10,
] as const;

/** Backwards-compatible name retained for existing callers. */
export const STANDARD_PET_LEVELS = STANDARD_PET_STAT_LEVELS;

/** Same authoritative table is used by the bear model for pet defense reduction. */
export const PET_DEFENSE_REDUCTION_LEVELS = STANDARD_PET_STAT_LEVELS;

/** Confirmed PVP report-attribute debuff data supplied by the user. */
export const PET_PENETRATION_REDUCTION_LEVELS = [
  0, .015, .020, .025, .030, .035, .040, .045, .050,
] as const;

/** Confirmed PVP report-attribute debuff data supplied by the user. */
export const PET_LIFE_REDUCTION_LEVELS = [
  0, .015, .020, .025, .030, .035, .040, .050,
] as const;

/** Mirrored from the bear model progression table. */
export const TOWN_BUFF_RATES: Readonly<Record<TownBuffSize, number>> = {
  none: 0,
  small: .10,
  large: .20,
};

/** All previously missing town/pet stat tables were confirmed by the user. */
export const EXTERNAL_BUFF_DATA_SOURCE_MISSING = [] as const;

export type ExternalBuffDataSourceMissing =
  (typeof EXTERNAL_BUFF_DATA_SOURCE_MISSING)[number];

export const DEFAULT_EXTERNAL_BUFF_CONFIG: ExternalBuffConfig = {
  town: {
    attack: "none",
    defense: "none",
    penetration: "none",
    life: "none",
    enemyAttackReduction: "none",
    enemyDefenseReduction: "none",
  },
  pet: {
    attackLevel: 0,
    defenseLevel: 0,
    penetrationLevel: 0,
    lifeLevel: 0,
    enemyDefenseReductionLevel: 0,
    enemyPenetrationReductionLevel: 0,
    enemyLifeReductionLevel: 0,
  },
  expert: { garethFourthSkillLevel: 0 },
};

export function lookupExternalBuffLevel(
  table: readonly number[],
  level: number,
  label: string,
): number {
  if (!Number.isSafeInteger(level) || level < 0 || level >= table.length) {
    throw new RangeError(`${label}等级必须是 0 到 ${table.length - 1} 的整数。`);
  }
  return table[level]!;
}

export function getGarethPenetrationReduction(level: number): number {
  if (!Number.isSafeInteger(level) || level < 0 || level > 20) {
    throw new RangeError("加雷斯四技能等级必须是 0 到 20 的整数。");
  }
  const resolved = resolveExpertSkillEffect(GARETH_FOURTH_SKILL_ID, level);
  if (!resolved.effectResolved) throw new UnresolvedExpertSkillEffectError(resolved);
  return resolved.effects.reduce((sum, effect) => sum + effect.value, 0);
}
