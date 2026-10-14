import {
  RULE_UNKNOWN,
  type ActiveEffect,
  type ActiveEffectIdentity,
  type EffectDefinition,
} from "../types/effect";
import type { TroopType } from "../types/combat";

export interface CreateActiveEffectInput {
  readonly identity: ActiveEffectIdentity;
  readonly definition: EffectDefinition;
  readonly appliedRound: number;
  readonly stackCount?: number;
  readonly applicationCount?: number;
  readonly holderScope?: "army" | TroopType;
}

export function activeEffectIdentityKey(identity: ActiveEffectIdentity): string {
  validateIdentity(identity);
  return JSON.stringify([
    identity.sourceId,
    identity.sourceSkillId,
    identity.effectId,
  ]);
}

export function createActiveEffect(
  input: CreateActiveEffectInput,
): ActiveEffect {
  validateDefinition(input.definition);
  assertPositiveSafeInteger(input.appliedRound, "appliedRound");
  const timing = input.definition.lifecycle?.activationTiming ?? "immediate";
  const activeFromRound =
    timing === "nextRound" ? input.appliedRound + 1 : input.appliedRound;
  const duration = input.definition.lifecycle?.durationRounds;
  if (duration !== undefined) {
    assertPositiveSafeInteger(duration, "durationRounds");
  }
  for (const round of input.definition.lifecycle?.activeRounds ?? []) {
    assertPositiveSafeInteger(round, "activeRounds entry");
  }
  const lifecycle = input.definition.lifecycle;
  if (lifecycle?.periodRounds !== undefined) {
    assertPositiveSafeInteger(lifecycle.periodRounds, "periodRounds");
    assertPositiveSafeInteger(lifecycle.firstActiveRound ?? 0, "firstActiveRound");
    assertPositiveSafeInteger(lifecycle.activeWindowRounds ?? 0, "activeWindowRounds");
    if (lifecycle.activeWindowRounds! > lifecycle.periodRounds) {
      throw new RangeError("activeWindowRounds cannot exceed periodRounds.");
    }
  }
  const effect: ActiveEffect = {
    instanceId: `effect:${activeEffectIdentityKey(input.identity)}`,
    identity: input.identity,
    definition: input.definition,
    stackCount: input.stackCount ?? 1,
    applicationCount: input.applicationCount ?? 1,
    appliedRound: input.appliedRound,
    activeFromRound,
    ...(duration === undefined
      ? {}
      : { remainingRounds: duration + (timing === "nextRound" ? 1 : 0) }),
    ...(input.holderScope === undefined
      ? {}
      : { holderScope: input.holderScope }),
  };
  validateActiveEffect(effect);
  return effect;
}

export function validateActiveEffect(effect: ActiveEffect): void {
  if (!effect.instanceId) throw new Error("Effect instanceId cannot be empty.");
  validateIdentity(effect.identity);
  validateDefinition(effect.definition);
  assertPositiveSafeInteger(effect.stackCount, "stackCount");
  assertPositiveSafeInteger(effect.applicationCount, "applicationCount");
  assertPositiveSafeInteger(effect.appliedRound, "appliedRound");
  assertPositiveSafeInteger(effect.activeFromRound, "activeFromRound");
  if (effect.remainingRounds !== undefined) {
    assertPositiveSafeInteger(effect.remainingRounds, "remainingRounds");
  }
  const maxStacks = effect.definition.lifecycle?.maxStacks;
  if (maxStacks !== undefined && effect.stackCount > maxStacks) {
    throw new RangeError("Effect stackCount exceeds maxStacks.");
  }
}

export function isEffectActiveInRound(
  effect: ActiveEffect,
  round: number,
): boolean {
  validateActiveEffect(effect);
  const lifecycle = effect.definition.lifecycle;
  const periodicActive = lifecycle?.periodRounds === undefined
    ? true
    : round >= lifecycle.firstActiveRound! &&
      (round - lifecycle.firstActiveRound!) % lifecycle.periodRounds <
        lifecycle.activeWindowRounds!;
  return (
    effect.definition.ruleStatus !== RULE_UNKNOWN &&
    round >= effect.activeFromRound &&
    (effect.definition.lifecycle?.activeRounds === undefined ||
      effect.definition.lifecycle.activeRounds.includes(round)) &&
    periodicActive &&
    (effect.remainingRounds === undefined || effect.remainingRounds > 0)
  );
}

/**
 * Applies explicit refresh/replace/stack policy. Missing policy never causes an
 * implicit overwrite because that would guess a game rule.
 */
export function upsertActiveEffect(
  current: readonly ActiveEffect[],
  incoming: ActiveEffect,
): readonly ActiveEffect[] {
  validateActiveEffect(incoming);
  const index = current.findIndex(
    (effect) =>
      activeEffectIdentityKey(effect.identity) ===
      activeEffectIdentityKey(incoming.identity),
  );
  if (index < 0) return [...current, incoming];
  const mode = incoming.definition.lifecycle?.refreshMode;
  if (mode === undefined) {
    throw new Error(
      "Duplicate effect identity requires explicit refreshMode (RULE_UNKNOWN).",
    );
  }
  const previous = current[index]!;
  let replacement: ActiveEffect;
  if (mode === "replace") {
    replacement = incoming;
  } else if (mode === "refresh") {
    // Confirmed global refresh semantics: replace the old state and restart
    // timing from this application. Keep only the cumulative audit counter.
    replacement = {
      ...incoming,
      applicationCount: previous.applicationCount + 1,
    };
  } else {
    const maximum = incoming.definition.lifecycle?.maxStacks;
    const stackCount = maximum === undefined
      ? previous.stackCount + incoming.stackCount
      : Math.min(maximum, previous.stackCount + incoming.stackCount);
    const refreshAtLimit =
      stackCount === previous.stackCount &&
      incoming.definition.lifecycle?.atMaxStacks === "refreshDuration";
    replacement = {
      ...previous,
      stackCount,
      applicationCount: previous.applicationCount + 1,
      ...(refreshAtLimit && incoming.remainingRounds !== undefined
        ? { remainingRounds: incoming.remainingRounds }
        : {}),
    };
  }
  validateActiveEffect(replacement);
  return current.map((effect, effectIndex) =>
    effectIndex === index ? replacement : effect,
  );
}

/** Called exactly once after a round has completed. */
export function advanceEffectDurations(
  effects: readonly ActiveEffect[],
): readonly ActiveEffect[] {
  return effects.flatMap((effect) => {
    validateActiveEffect(effect);
    if (effect.remainingRounds === undefined) return [effect];
    if (effect.remainingRounds === 1) return [];
    return [{ ...effect, remainingRounds: effect.remainingRounds - 1 }];
  });
}

function validateIdentity(identity: ActiveEffectIdentity): void {
  if (!identity.sourceId || !identity.sourceSkillId || !identity.effectId) {
    throw new Error("Effect identity fields cannot be empty.");
  }
}

function validateDefinition(definition: EffectDefinition): void {
  if (!definition.id || !definition.name) {
    throw new Error("Effect definition id and name cannot be empty.");
  }
  if (definition.kind === "targetingOverride") {
    if (definition.priority.length === 0) {
      throw new Error("Targeting override priority cannot be empty.");
    }
    return;
  }
  if (definition.kind === "targetBoundMark") {
    if (!definition.markId) throw new Error("Target-bound mark id cannot be empty.");
    return;
  }
  if (definition.kind === "oneUseIncomingDamageIncrease") {
    if (!definition.group || !Number.isFinite(definition.value)) {
      throw new Error("One-use incoming damage marker requires group and value.");
    }
    return;
  }
  if (definition.kind === "skipNextRoundAction") return;
  if (!definition.group || !Number.isFinite(definition.value)) {
    throw new Error("Modifier group and finite value are required.");
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}
