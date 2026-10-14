import {
  DEFAULT_EXTERNAL_BUFF_CONFIG,
  PET_DEFENSE_REDUCTION_LEVELS,
  PET_LIFE_REDUCTION_LEVELS,
  PET_PENETRATION_REDUCTION_LEVELS,
  STANDARD_PET_STAT_LEVELS,
  TOWN_BUFF_RATES,
  lookupExternalBuffLevel,
} from "./data";
import { GARETH_FOURTH_SKILL_ID, resolveExpertSkillEffect, UnresolvedExpertSkillEffectError } from "./expertSkills";
import type {
  BattleReportAttributeModifiers,
  ExternalBuffConfig,
  ReportAttribute,
  ReportAttributeValues,
  ReportBonusSource,
  ResolvedExternalBuffs,
  ResolvedReportAttributeBonus,
} from "./types";

const ZERO_ATTRIBUTES: ReportAttributeValues = {
  attack: 0,
  defense: 0,
  penetration: 0,
  life: 0,
};

/**
 * Legacy public compatibility helper; not used by scenario/UI/optimizer builders.
 * For expected attributes use deriveExpectedReportAttribute instead.
 * (1 + final) = (1 + base + additive + sum(buff)) / (1 + sum(debuff)).
 * Values remain full precision; formatting is a UI responsibility.
 */
export function resolveReportAttributeBonus(input: {
  readonly baseBonus: number;
  readonly additiveBonus?: number;
  readonly specialBuff?: number;
  readonly specialDebuff?: number;
}): ResolvedReportAttributeBonus {
  const additiveBonus = input.additiveBonus ?? 0;
  const specialBuff = input.specialBuff ?? 0;
  const specialDebuff = input.specialDebuff ?? 0;
  for (const [label, value] of Object.entries({
    baseBonus: input.baseBonus,
    additiveBonus,
    specialBuff,
    specialDebuff,
  })) {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  }
  if (1 + input.baseBonus + additiveBonus + specialBuff <= 0) {
    throw new RangeError("Report attribute numerator factors must be positive.");
  }
  if (1 + specialDebuff <= 0) {
    throw new RangeError("Report attribute debuff division factor must be positive.");
  }
  const numeratorFactor = 1 + input.baseBonus + additiveBonus + specialBuff;
  const divisionFactor = 1 + specialDebuff;
  return {
    baseBonus: input.baseBonus,
    additiveBonus,
    specialBuff,
    specialDebuff,
    numeratorFactor,
    divisionFactor,
    finalBonus: numeratorFactor / divisionFactor - 1,
  };
}

export function resolveExternalBuffs(
  config: ExternalBuffConfig = DEFAULT_EXTERNAL_BUFF_CONFIG,
): ResolvedExternalBuffs {
  const selfBuffSources: ReportBonusSource[] = [];
  const enemyDebuffSources: ReportBonusSource[] = [];
  addTown(selfBuffSources, "town.attack", "城镇攻击", "attack", config.town.attack);
  addTown(selfBuffSources, "town.defense", "城镇防御", "defense", config.town.defense);
  addTown(selfBuffSources, "town.penetration", "城镇穿透", "penetration", config.town.penetration);
  addTown(selfBuffSources, "town.life", "城镇生命", "life", config.town.life);
  addTown(enemyDebuffSources, "town.enemyAttack", "城镇减攻", "attack", config.town.enemyAttackReduction);
  addTown(enemyDebuffSources, "town.enemyDefense", "城镇减防", "defense", config.town.enemyDefenseReduction);
  addLevel(selfBuffSources, "pet.attack", "宠物攻击", "attack", STANDARD_PET_STAT_LEVELS, config.pet.attackLevel);
  addLevel(selfBuffSources, "pet.defense", "宠物防御", "defense", STANDARD_PET_STAT_LEVELS, config.pet.defenseLevel);
  addLevel(selfBuffSources, "pet.penetration", "宠物穿透", "penetration", STANDARD_PET_STAT_LEVELS, config.pet.penetrationLevel);
  addLevel(selfBuffSources, "pet.life", "宠物生命", "life", STANDARD_PET_STAT_LEVELS, config.pet.lifeLevel);
  addLevel(enemyDebuffSources, "pet.enemyDefense", "宠物减防", "defense", PET_DEFENSE_REDUCTION_LEVELS, config.pet.enemyDefenseReductionLevel);
  addLevel(enemyDebuffSources, "pet.enemyPenetration", "宠物减穿透", "penetration", PET_PENETRATION_REDUCTION_LEVELS, config.pet.enemyPenetrationReductionLevel);
  addLevel(enemyDebuffSources, "pet.enemyLife", "宠物减生命", "life", PET_LIFE_REDUCTION_LEVELS, config.pet.enemyLifeReductionLevel);
  const expert = resolveExpertSkillEffect(GARETH_FOURTH_SKILL_ID, config.expert.garethFourthSkillLevel);
  if (!expert.effectResolved) throw new UnresolvedExpertSkillEffectError(expert);
  for (const effect of expert.effects) addSource(effect.effectTarget === "enemy" ? enemyDebuffSources : selfBuffSources, {
    id: expert.skillId, label: expert.skillName, attribute: effect.attribute, value: effect.value,
  });

  return {
    selfBuffs: sumSources(selfBuffSources),
    enemyDebuffs: sumSources(enemyDebuffSources),
    selfBuffSources,
    enemyDebuffSources,
  };
}

export function resolveBattleReportModifiers(
  own: ExternalBuffConfig | undefined,
  opponent: ExternalBuffConfig | undefined,
): BattleReportAttributeModifiers {
  const resolvedOwn = resolveExternalBuffs(own);
  const resolvedOpponent = resolveExternalBuffs(opponent);
  return {
    selfBuffs: resolvedOwn.selfBuffs,
    receivedDebuffs: resolvedOpponent.enemyDebuffs,
  };
}

function addTown(
  output: ReportBonusSource[],
  id: string,
  label: string,
  attribute: ReportAttribute,
  size: keyof typeof TOWN_BUFF_RATES,
): void {
  addSource(output, { id, label, attribute, value: TOWN_BUFF_RATES[size] });
}

function addLevel(
  output: ReportBonusSource[],
  id: string,
  label: string,
  attribute: ReportAttribute,
  table: readonly number[],
  level: number,
): void {
  addSource(output, {
    id,
    label,
    attribute,
    value: lookupExternalBuffLevel(table, level, label),
  });
}

function addSource(output: ReportBonusSource[], source: ReportBonusSource): void {
  if (source.value !== 0) output.push(source);
}

function sumSources(sources: readonly ReportBonusSource[]): ReportAttributeValues {
  const values = { ...ZERO_ATTRIBUTES };
  for (const source of sources) values[source.attribute] += source.value;
  return values;
}
