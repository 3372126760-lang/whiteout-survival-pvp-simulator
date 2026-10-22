import { TROOP_TYPES } from "../types/combat";
import { validateProcEffectFamily } from "./procEffectFamily";
import type {
  HeroSkillDefinition,
  HeroSkillRuntimeState,
} from "./types";

export const DEFAULT_HERO_SKILL_LEVEL = 5;

export function createHeroSkillRuntimeState(
  skillId: string,
  level = DEFAULT_HERO_SKILL_LEVEL,
  enabled = true,
): HeroSkillRuntimeState {
  if (!skillId) throw new Error("Hero skillId cannot be empty.");
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError("Hero skill level must be a positive safe integer.");
  }
  return {
    skillId,
    level,
    enabled,
    stacks: 0,
    remainingDuration: 0,
    cooldown: 0,
    lastTriggeredRound: null,
    triggerCount: 0,
    mainAttackCounts: { shield: 0, lancer: 0, marksman: 0 },
  };
}

export function validateHeroSkillRuntimeState(
  runtime: HeroSkillRuntimeState,
): void {
  if (!runtime.skillId) throw new Error("Hero runtime skillId cannot be empty.");
  if (!Number.isSafeInteger(runtime.level) || runtime.level < 1) {
    throw new RangeError("Hero runtime level must be a positive safe integer.");
  }
  for (const [label, value] of [
    ["stacks", runtime.stacks],
    ["remainingDuration", runtime.remainingDuration],
    ["cooldown", runtime.cooldown],
    ["triggerCount", runtime.triggerCount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} must be a non-negative safe integer.`);
    }
  }
  for (const troop of TROOP_TYPES) {
    const count = runtime.mainAttackCounts[troop];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(`mainAttackCounts.${troop} must be non-negative.`);
    }
  }
  if (
    runtime.lastTriggeredRound !== null &&
    (!Number.isSafeInteger(runtime.lastTriggeredRound) ||
      runtime.lastTriggeredRound < 1)
  ) {
    throw new RangeError("lastTriggeredRound must be null or positive.");
  }
}

export function validateHeroSkillDefinition(
  definition: HeroSkillDefinition,
): void {
  validateProcEffectFamily(definition);
  if (!definition.id || !definition.heroId || !definition.name) {
    throw new Error("Hero skill id, heroId, and name cannot be empty.");
  }
  if (definition.positionRule.allowedPositions.length === 0) {
    throw new Error("Hero skill must allow at least one position.");
  }
  validateProbability(definition.probability, "definition probability");
  const levels = Object.entries(definition.levelValues);
  if (levels.length === 0) {
    throw new Error(`Hero skill ${definition.id} needs levelValues.`);
  }
  for (const [levelKey, level] of levels) {
    const levelNumber = Number(levelKey);
    if (!Number.isSafeInteger(levelNumber) || levelNumber < 1) {
      throw new RangeError(`Invalid hero skill level ${levelKey}.`);
    }
    validateProbability(level.probability, `level ${levelKey} probability`);
    validateOptionalPositiveInteger(level.periodRounds, "periodRounds");
    if (level.periodRounds !== undefined && level.periodStartRound === undefined) {
      throw new Error("periodStartRound is required when periodRounds is set.");
    }
    validateOptionalPositiveInteger(level.periodStartRound, "periodStartRound");
    const ids = new Set<string>();
    for (const effect of level.effects) {
      if (!effect.id || !effect.name || ids.has(effect.id)) {
        throw new Error(`Invalid or duplicate hero effect ${effect.id}.`);
      }
      ids.add(effect.id);
      if (effect.kind === "targetingOverride") {
        if (
          effect.priority.length !== TROOP_TYPES.length ||
          new Set(effect.priority).size !== TROOP_TYPES.length
        ) {
          throw new Error("Hero targeting override must contain every troop once.");
        }
      } else if (effect.kind === "extraDamage") {
        if (!Number.isFinite(effect.coefficient) || effect.coefficient < 0) {
          throw new RangeError("Hero extraDamage coefficient must be non-negative.");
        }
      } else if (effect.kind === "temporaryShield") {
        if (!Number.isFinite(effect.coefficient) || effect.coefficient < 0) {
          throw new RangeError("temporaryShield coefficient must be non-negative.");
        }
      } else if (effect.kind === "targetBoundMark") {
        if (!effect.markId) throw new Error("targetBoundMark requires markId.");
      } else if (effect.kind === "oneUseIncomingDamageIncrease") {
        if (!effect.group || !Number.isFinite(effect.value) || effect.value < 0) {
          throw new Error("Invalid oneUseIncomingDamageIncrease effect.");
        }
      } else if (effect.kind === "skipNextRoundAction") {
        // Marker status: lifecycle and target binding carry its semantics.
      } else if (effect.kind === "decayingDamageIncrease") {
        if (
          !effect.group || !Number.isFinite(effect.decayFactor) ||
          effect.decayFactor <= 0 || !Number.isSafeInteger(effect.maxMainAttacks) ||
          effect.maxMainAttacks < 1 ||
          Object.values(effect.initialValues).some(
            (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
          )
        ) {
          throw new Error("Invalid decayingDamageIncrease effect.");
        }
      } else if (!effect.group || !Number.isFinite(effect.value)) {
        throw new Error("Hero modifier effect requires a group and finite value.");
      }
    }
  }
  const mechanic = definition.actionMechanic;
  if (mechanic?.kind === "skipMainAttack") {
    if (!Number.isSafeInteger(mechanic.afterCompletedAttacks) || mechanic.afterCompletedAttacks < 1) {
      throw new RangeError("skipMainAttack requires a positive attack interval.");
    }
  } else if (mechanic?.kind === "attackCountTrigger" || mechanic?.kind === "targetBoundMark") {
    if (!Number.isSafeInteger(mechanic.schedule.interval) || mechanic.schedule.interval < 1) {
      throw new RangeError("attackCount schedule interval must be positive.");
    }
    if (mechanic.kind === "targetBoundMark" && mechanic.duplicateSourceStacking &&
      (!Number.isFinite(mechanic.duplicateSourceStacking.additionalCoefficient) || mechanic.duplicateSourceStacking.additionalCoefficient < 0)) {
      throw new RangeError("duplicate mark source coefficient must be finite and nonnegative.");
    }
  }
}

function validateProbability(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError(`${label} must be in [0, 1].`);
  }
}

function validateOptionalPositiveInteger(
  value: number | undefined,
  label: string,
): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}
