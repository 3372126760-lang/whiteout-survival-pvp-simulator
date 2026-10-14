import {
  computeDamageIncreaseMultiplier,
  computeReductionMultiplier,
  getApplicableEffects,
  resolveTroopAttribute,
} from "../effects";
import { sideFromState, type BattleReadState } from "../types/battle";
import type {
  AppliedDamageEffect,
  DamageEvent,
  DamageEventInput,
} from "../types/damage";
import type { DamageSubtype, DamageType } from "../types/combat";
import type { ActiveDamageModifierEffect } from "../types/effect";
import type {
  ActiveDefenseModifierEffect,
  ActiveBaseDefenseMultiplierEffect,
  ActiveDefenseReductionEffect,
  ActiveDirectDamageCancellationEffect,
  ActiveEffect,
  ActiveIncomingDamageIncreaseEffect,
} from "../types/effect";
import {
  CONFIRMED_INTEGER_DAMAGE_ROUNDING,
  type CasualtyRoundingStrategy,
} from "../strategies";

export interface CreateDamageEventOptions {
  readonly transientEffects?: readonly ActiveEffect[];
  readonly damageRoundingStrategy?: CasualtyRoundingStrategy;
}

/** extraDamage is always reduced through the skillDamage category. */
export function reductionCategoryForSubtype(
  subtype: DamageSubtype,
): DamageType {
  return subtype === "normalAttack" ? "normalAttack" : "skillDamage";
}

export function createDamageEvent(
  input: DamageEventInput,
  battleState: BattleReadState,
  options: CreateDamageEventOptions = {},
): DamageEvent {
  validateDamageEventInput(input, battleState);
  const applicable = getApplicableEffects(
    input,
    battleState,
    options.transientEffects ?? [],
  );
  // A consumed Gwen token replaces only Eagle Vision's contribution for this
  // event. Other heroes' vulnerability and incoming groups remain applicable.
  const hasAerialOverride = applicable.damageIncreases.some((effect) =>
    effect.definition.kind === "incomingDamageIncrease" &&
    effect.definition.group === "aerialSuppressionOverride"
  );
  const hasGwenAerialOverride = applicable.damageIncreases.some(isGwenAerialOverride);
  const damageIncreases = hasGwenAerialOverride
    ? applicable.damageIncreases.filter((effect) =>
        effect.definition.kind !== "incomingDamageIncrease" || (
          effect.identity.sourceSkillId !== "hero-skill.gewen.eagle-vision" &&
          effect.identity.effectId !== "hero-effect.gewen.eagle-vision.vulnerability" &&
          effect.definition.id !== "hero-effect.gewen.eagle-vision.vulnerability"
        )
      )
    : hasAerialOverride
    ? applicable.damageIncreases.filter((effect) =>
        effect.definition.kind !== "incomingDamageIncrease" ||
        effect.definition.group === "aerialSuppressionOverride"
      )
    : applicable.damageIncreases;
  const increase = computeDamageIncreaseMultiplier(damageIncreases);
  // Keep the original override group in the audit. For damage calculation only,
  // its 15% joins the retained vulnerability sum instead of multiplying it.
  const increaseMultiplier = hasGwenAerialOverride
    ? computeDamageIncreaseMultiplier(damageIncreases.map((effect): ActiveDamageModifierEffect | ActiveIncomingDamageIncreaseEffect => {
        const definition = effect.definition;
        return definition.kind === "incomingDamageIncrease" && isGwenAerialOverride(effect)
          ? { ...effect, definition: { ...definition, group: "vulnerability" } }
          : effect;
      })).combined
    : increase.combined;
  const defenseReductionIncrease = computeDamageIncreaseMultiplier(
    applicable.defenseReductions,
  );
  const damageReductions = applicable.damageReductions.filter((effect) =>
    effect.definition.group !== "receivedNormalAttackReduction" || input.damageType === "normalAttack"
  ).filter((effect) =>
    effect.definition.group !== "receivedSkillDamageReduction" || input.damageType === "skillDamage"
  );
  const ordinaryReduction = computeReductionMultiplier(damageReductions);
  const receivedDamageReductionSources = damageReductions.filter((effect) =>
    isReceivedReductionGroup(effect.definition.group)
  ).map(toAppliedEffect);
  const receivedDamageReductionTotal = receivedDamageReductionSources.reduce(
    (sum, effect) => sum + effect.effectiveValue, 0);
  const receivedDamageReductionDenominator = 1 + receivedDamageReductionTotal;
  if (!Number.isFinite(receivedDamageReductionDenominator) || receivedDamageReductionDenominator <= 0) {
    throw new RangeError("Received damage reduction produced a non-positive denominator.");
  }
  // Retain original groups for source/scope auditing. Their received components
  // share one divisor; only the other groups retain independent divisors.
  const independentReductionMultiplier = ordinaryReduction.groups.reduce(
    (product, group) => isReceivedReductionGroup(group.group) ? product : product * group.multiplier, 1);
  if (applicable.defenseModifiers.length > 0) {
    throw new Error("Legacy defenseModifier is retired; use a scoped defense attributeModifier.");
  }
  const baseDefense = computeBaseDefenseGroups(applicable.baseDefenseMultipliers);
  const reductionGroups = [
    ...ordinaryReduction.groups,
    ...baseDefense.groups,
  ];
  const reductionMultiplier =
    independentReductionMultiplier * receivedDamageReductionDenominator * baseDefense.combined;
  const directCancellation = computeDirectCancellationGroups(
    applicable.directDamageCancellations,
  );
  const targetDefense = resolveTroopAttribute(
    sideFromState(battleState, input.targetSide),
    input.targetTroop,
    "defense",
    input.round,
    { targetTroop: input.sourceTroop, damageType: input.damageType },
    (options.transientEffects ?? []).filter((effect) =>
      effect.definition.kind === "attributeReduction" ||
      (effect.definition.kind === "attributeModifier" &&
        effect.identity.sourceId.includes(`:${input.targetSide}:`))),
  );
  if (targetDefense.multiplier <= 0) {
    throw new RangeError("Target defense multiplier must be positive.");
  }
  const rawDamage = input.baseDamage;
  const modifiedDamage =
    rawDamage *
    increaseMultiplier /
    (targetDefense.multiplier * reductionMultiplier) *
    defenseReductionIncrease.combined *
    directCancellation.combined;
  const rounding =
    options.damageRoundingStrategy ?? CONFIRMED_INTEGER_DAMAGE_ROUNDING;
  const roundedDamage = rounding.normalizeIncomingDamage(modifiedDamage, {
    aliveCount: 0,
    frontUnitHp: 0,
    maxHpPerUnit: 1,
  });
  if (!Number.isFinite(roundedDamage) || roundedDamage < 0) {
    throw new RangeError("Resolved damage must be a non-negative finite number.");
  }
  return {
    ...input,
    baseDamageAttributeEffects: input.baseDamageAttributeEffects ?? [],
    rootEventId: input.rootEventId ?? input.id,
    depth: input.depth ?? 0,
    increaseGroups: increase.groups,
    defenseReductionGroups: defenseReductionIncrease.groups,
    reductionGroups,
    directCancellationGroups: directCancellation.groups,
    appliedIncreaseEffects: damageIncreases.map(toAppliedEffect),
    appliedReductionEffects: damageReductions.map(toAppliedEffect),
    appliedDefenseReductionEffects:
      applicable.defenseReductions.map(toAppliedEffect),
    appliedDefenseEffects: [
      ...applicable.baseDefenseMultipliers,
    ].map(toAppliedEffect),
    appliedDirectCancellationEffects:
      applicable.directDamageCancellations.map(toAppliedEffect),
    increaseMultiplier,
    defenseReductionMultiplier: defenseReductionIncrease.combined,
    reductionMultiplier,
    receivedDamageReductionSources,
    receivedDamageReductionTotal,
    receivedDamageReductionDenominator,
    damageBeforeReceivedReduction: modifiedDamage * receivedDamageReductionDenominator,
    damageAfterReceivedReduction: modifiedDamage,
    targetDefenseMultiplier: targetDefense.multiplier,
    attributeResolutions: [
      ...(input.attributeResolutions ?? []),
      {
        attribute: "defense",
        baseAttribute: targetDefense.baseValue,
        buffedAttribute: targetDefense.buffedValue,
        modifierGroups: targetDefense.groups,
        reductionGroups: targetDefense.reductionGroups,
        divisionFactor: targetDefense.reductionGroups.reduce(
          (product, group) => product * group.divisionFactor, 1),
        finalAttribute: targetDefense.effectiveValue,
      },
    ],
    directCancellationMultiplier: directCancellation.combined,
    rawDamage,
    modifiedDamage,
    roundedDamage,
    damageRoundingStrategyId: rounding.id,
    finalDamage: roundedDamage,
  };
}

function isGwenAerialOverride(
  effect: ActiveDamageModifierEffect | ActiveIncomingDamageIncreaseEffect,
): boolean {
  return effect.definition.kind === "incomingDamageIncrease" &&
    effect.definition.group === "aerialSuppressionOverride" && (
      effect.identity.sourceSkillId === "hero-skill.gewen.aerial-suppression" ||
      effect.identity.effectId === "hero-effect.gewen.aerial-suppression.vulnerability" ||
      effect.definition.id === "hero-effect.gewen.aerial-suppression.vulnerability"
    );
}

function isReceivedReductionGroup(group: string): boolean {
  return group === "receivedDamageReduction" ||
    group === "receivedNormalAttackReduction" ||
    group === "receivedSkillDamageReduction";
}

function toAppliedEffect(
  effect:
    | ActiveDamageModifierEffect
    | ActiveIncomingDamageIncreaseEffect
    | ActiveDefenseModifierEffect
    | ActiveBaseDefenseMultiplierEffect
    | ActiveDefenseReductionEffect
    | ActiveDirectDamageCancellationEffect,
): AppliedDamageEffect {
  return {
    instanceId: effect.instanceId,
    effectId: effect.definition.id,
    effectName: effect.definition.name,
    sourceId: effect.identity.sourceId,
    sourceSkillId: effect.identity.sourceSkillId,
    effectKind: effect.definition.kind,
    group: effect.definition.group,
    valuePerStack: effect.definition.value,
    stackCount: effect.stackCount,
    effectiveValue: effect.definition.value * effect.stackCount,
    ...(effect.definition.scope === undefined
      ? {}
      : { scope: effect.definition.scope }),
  };
}

function computeBaseDefenseGroups(
  effects: readonly ActiveBaseDefenseMultiplierEffect[],
): ReturnType<typeof computeReductionMultiplier> {
  const normalized = effects.map((effect): ActiveDamageModifierEffect => ({
    ...effect,
    definition: { ...effect.definition, kind: "damageReduction" },
  }));
  return computeReductionMultiplier(normalized);
}

function computeDirectCancellationGroups(
  effects: readonly ActiveDirectDamageCancellationEffect[],
): ReturnType<typeof computeReductionMultiplier> {
  const byGroup = new Map<string, { sum: number; ids: string[] }>();
  for (const effect of effects) {
    const current = byGroup.get(effect.definition.group) ?? { sum: 0, ids: [] };
    current.sum += effect.definition.value * effect.stackCount;
    current.ids.push(effect.instanceId);
    byGroup.set(effect.definition.group, current);
  }
  const groups = [...byGroup.entries()].map(([group, value]) => {
    const multiplier = 1 - value.sum;
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1) {
      throw new RangeError(`Direct cancellation group ${group} must remain in [0, 1].`);
    }
    return {
      group,
      summedValue: value.sum,
      multiplier,
      effectInstanceIds: value.ids,
    };
  });
  return {
    groups,
    combined: groups.reduce((product, group) => product * group.multiplier, 1),
  };
}

function validateDamageEventInput(
  input: DamageEventInput,
  battleState: BattleReadState,
): void {
  if (!input.id) throw new Error("Damage event id cannot be empty.");
  if (input.sourceSide === input.targetSide) {
    throw new Error("Damage source and target sides must differ.");
  }
  if (input.round !== battleState.round) {
    throw new Error("Damage event round must match the battle read state.");
  }
  if (!Number.isSafeInteger(input.actionOrder) || input.actionOrder < 0) {
    throw new RangeError("Damage event actionOrder must be non-negative.");
  }
  if (!Number.isFinite(input.baseDamage) || input.baseDamage < 0) {
    throw new RangeError("Damage event baseDamage must be non-negative and finite.");
  }
  for (const effect of input.baseDamageAttributeEffects ?? []) {
    if (!Number.isFinite(effect.effectiveValue)) {
      throw new RangeError("Base-damage attribute effect values must be finite.");
    }
  }
  if (input.damageType !== reductionCategoryForSubtype(input.damageSubtype)) {
    throw new Error(
      "Damage subtype/category mismatch: extraDamage belongs to skillDamage.",
    );
  }
  const depth = input.depth ?? 0;
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new RangeError("Damage event depth must be non-negative.");
  }
  if (input.parentEventId !== undefined && depth < 1) {
    throw new Error("Child damage events must have depth >= 1.");
  }
}
