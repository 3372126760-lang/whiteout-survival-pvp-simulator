import type {
  TroopSkillDefinition,
  TroopSkillRuntimeState,
} from "./types";
import { TROOP_TYPES } from "../types/combat";

export interface RandomSource {
  /** Must return a deterministic value in [0, 1). */
  next(): number;
}

export function createTroopSkillRuntimeState(
  skillId: string,
  level: number,
  enabled = true,
): TroopSkillRuntimeState {
  if (!skillId) throw new Error("skillId cannot be empty.");
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError("Skill level must be a positive safe integer.");
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
  };
}

export function createSequenceRandomSource(
  values: readonly number[],
): RandomSource {
  if (values.length === 0) {
    throw new Error("A deterministic random sequence cannot be empty.");
  }
  for (const value of values) validateRoll(value);
  let index = 0;
  return {
    next(): number {
      const value = values[index % values.length]!;
      index += 1;
      return value;
    },
  };
}

/** Small seeded generator for reproducible simulations. It never uses Math.random. */
export function createSeededRandomSource(seed: number): RandomSource {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("RNG seed must be a safe integer.");
  }
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}

export function validateTroopSkillDefinition(
  definition: TroopSkillDefinition,
): void {
  if (!definition.id || !definition.name) {
    throw new Error("Troop skill id and name cannot be empty.");
  }
  validateProbability(definition.probability, "definition probability");
  validateOptionalPositiveInteger(definition.durationRounds, "durationRounds");
  validateOptionalNonNegativeInteger(definition.cooldownRounds, "cooldownRounds");
  const levelEntries = Object.entries(definition.levelValues);
  if (levelEntries.length === 0) {
    throw new Error(`Troop skill ${definition.id} needs explicit levelValues.`);
  }
  for (const [levelKey, value] of levelEntries) {
    const level = Number(levelKey);
    if (!Number.isSafeInteger(level) || level < 1) {
      throw new RangeError(`Invalid skill level key: ${levelKey}.`);
    }
    validateProbability(value.probability, `level ${level} probability`);
    validateOptionalPositiveInteger(value.durationRounds, "durationRounds");
    validateOptionalNonNegativeInteger(value.cooldownRounds, "cooldownRounds");
    validateOptionalPositiveInteger(value.periodRounds, "periodRounds");
    if (value.periodRounds !== undefined && value.periodStartRound === undefined) {
      throw new Error("periodStartRound is required when periodRounds is set.");
    }
    validateOptionalPositiveInteger(value.periodStartRound, "periodStartRound");
    const effectIds = new Set<string>();
    for (const effect of value.effects) {
      if (!effect.id || !effect.name) {
        throw new Error("Troop skill effect id and name cannot be empty.");
      }
      if (effectIds.has(effect.id)) {
        throw new Error(`Duplicate effect id ${effect.id} at skill level ${level}.`);
      }
      effectIds.add(effect.id);
      if (effect.kind === "extraDamage") {
        if (!Number.isFinite(effect.coefficient) || effect.coefficient < 0) {
          throw new RangeError("Extra damage coefficient must be finite and non-negative.");
        }
      } else if (effect.kind === "extraDamageContribution") {
        if (!effect.linkedToSkillId || !Number.isFinite(effect.coefficient) || effect.coefficient < 0) {
          throw new RangeError("Linked extra damage contribution requires a skill and non-negative coefficient.");
        }
      } else if (effect.kind === "sameMainAttackSegment") {
        if (effect.segmentCount !== 1 || effect.damageScale <= 0) {
          throw new Error("Same-main-attack segment requires one positive-scale damage segment.");
        }
      } else if (effect.kind === "targetingOverride") {
        if (
          effect.priority.length !== TROOP_TYPES.length ||
          new Set(effect.priority).size !== TROOP_TYPES.length ||
          TROOP_TYPES.some((troop) => !effect.priority.includes(troop))
        ) {
          throw new Error("Targeting override must be a permutation of all troop types.");
        }
      } else if (!effect.group || !Number.isFinite(effect.value)) {
        throw new Error("Modifier group and finite value are required.");
      }
    }
  }
}

export function validateTroopSkillRuntimeState(
  runtime: TroopSkillRuntimeState,
): void {
  if (!runtime.skillId) throw new Error("Runtime skillId cannot be empty.");
  if (!Number.isSafeInteger(runtime.level) || runtime.level < 1) {
    throw new RangeError("Runtime skill level must be a positive safe integer.");
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
  if (
    runtime.lastTriggeredRound !== null &&
    (!Number.isSafeInteger(runtime.lastTriggeredRound) ||
      runtime.lastTriggeredRound < 1)
  ) {
    throw new RangeError("lastTriggeredRound must be null or a positive safe integer.");
  }
}

function validateRoll(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("RNG values must be finite and in [0, 1).");
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

function validateOptionalNonNegativeInteger(
  value: number | undefined,
  label: string,
): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}
