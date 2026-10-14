import type { BattleSide } from "../types/battle";
import type { DamageType, TroopType } from "../types/combat";
import type { ActiveAttributeModifierEffect, ActiveEffect } from "../types/effect";
import type { ActiveAttributeReductionEffect } from "../types/effect";
import { isEffectActiveInRound } from "./activeEffects";
import { deriveExpectedReportAttribute } from "../validationUi/expectedReportAttribute";

const EXTERNAL_ATTRIBUTE_GROUPS = {
  attack: "buffAttack", defense: "buffDefense",
  penetration: "buffPenetration", life: "buffLife",
} as const;

function isWeaponAttributeEffect(effect: ActiveAttributeModifierEffect): boolean {
  return effect.identity.sourceSkillId.startsWith("hero-weapon-skill.");
}

export interface AttributeModifierGroupResult {
  readonly group: string;
  readonly operation: "addToExternalBuff" | "multiplyAttributeFactor";
  readonly summedValue: number;
  readonly multiplier: number;
  readonly effectInstanceIds: readonly string[];
}

export interface ResolvedTroopAttribute {
  readonly currentExternalBuffBase: number;
  readonly currentWeaponBuff: number;
  readonly currentExternalBuffTotal: number;
  readonly baseValue: number;
  readonly buffedValue: number;
  readonly effectiveValue: number;
  readonly multiplier: number;
  readonly groups: readonly AttributeModifierGroupResult[];
  readonly effects: readonly ActiveAttributeModifierEffect[];
  readonly reductionGroups: readonly ResolvedAttributeReductionGroup[];
  readonly reductionEffects: readonly ActiveAttributeReductionEffect[];
}

export interface ResolvedAttributeReductionGroup {
  readonly group: string;
  readonly summedValue: number;
  readonly divisionFactor: number;
  readonly effectInstanceIds: readonly string[];
}

/**
 * Attribute effects are kept outside DamageEvent reduction.
 * Scene weapon attribute rates join the existing external Buff group before
 * report construction. Ordinary hero groups and reductions retain their rules.
 */
export function resolveTroopAttribute(
  side: BattleSide,
  troopType: TroopType,
  attribute: "attack" | "penetration" | "defense" | "life",
  round: number,
  eventScope: {
    readonly targetTroop: TroopType;
    readonly damageType: DamageType;
  },
  transientEffects: readonly ActiveEffect[] = [],
): ResolvedTroopAttribute {
  const troop = side.troops[troopType];
  const candidates = [...new Map([
    ...side.armyEffects, ...troop.buffs, ...troop.debuffs, ...transientEffects,
  ].map((effect) => [effect.instanceId, effect])).values()];
  const effects = candidates.filter(
    (effect): effect is ActiveAttributeModifierEffect =>
      effect.definition.kind === "attributeModifier" &&
      effect.definition.attribute === attribute &&
      isEffectActiveInRound(effect, round) &&
      (effect.definition.scope?.sourceTroops === undefined ||
        effect.definition.scope.sourceTroops.includes(troopType)) &&
      (effect.definition.scope?.targetTroops === undefined ||
        effect.definition.scope.targetTroops.includes(eventScope.targetTroop)) &&
      (effect.definition.scope?.damageTypes === undefined ||
        effect.definition.scope.damageTypes.includes(eventScope.damageType)),
  );
  const reductionEffects = candidates.filter(
    (effect): effect is ActiveAttributeReductionEffect =>
      effect.definition.kind === "attributeReduction" &&
      effect.definition.attribute === attribute &&
      isEffectActiveInRound(effect, round) &&
      (effect.definition.scope?.sourceTroops === undefined ||
        effect.definition.scope.sourceTroops.includes(troopType)) &&
      (effect.definition.scope?.targetTroops === undefined ||
        effect.definition.scope.targetTroops.includes(eventScope.targetTroop)) &&
      (effect.definition.scope?.damageTypes === undefined ||
        effect.definition.scope.damageTypes.includes(eventScope.damageType)),
  );
  const grouped = new Map<
    string,
    {
      group: string;
      operation: "addToExternalBuff" | "multiplyAttributeFactor";
      sum: number;
      ids: string[];
    }
  >();
  for (const effect of effects) {
    const operation = isWeaponAttributeEffect(effect) ||
      effect.definition.group === EXTERNAL_ATTRIBUTE_GROUPS[attribute]
      ? "addToExternalBuff" as const : "multiplyAttributeFactor" as const;
    const key = `${operation}:${effect.definition.group}`;
    const current = grouped.get(key) ?? {
      group: effect.definition.group, operation,
      sum: 0,
      ids: [],
    };
    current.sum += effect.definition.value * effect.stackCount;
    current.ids.push(effect.instanceId);
    grouped.set(key, current);
  }
  const groups = [...grouped.values()].map((result) => {
    return {
      group: result.group,
      operation: result.operation,
      summedValue: result.sum,
      // External groups are already summed into the canonical panel below.
      multiplier: result.operation === "addToExternalBuff" ? 1 : 1 + result.sum,
      effectInstanceIds: result.ids,
    };
  });
  const baseValue = troop[attribute];
  const currentWeaponBuff = effects.filter(isWeaponAttributeEffect).reduce((sum, effect) =>
    sum + effect.definition.value * effect.stackCount, 0);
  const activeExternalBuff = groups.filter((group) =>
    group.operation === "addToExternalBuff").reduce((sum, group) => sum + group.summedValue, 0);
  const reportContext = troop.reportAttributeContext?.[attribute];
  const currentExternalBuffBase = (reportContext?.targetBuff ?? 0) +
    activeExternalBuff - currentWeaponBuff;
  const currentExternalBuffTotal = currentExternalBuffBase + currentWeaponBuff;
  const panelWithExternalBuff = activeExternalBuff === 0 ? baseValue :
    deriveExpectedReportAttribute({ ...(reportContext ?? { raw: baseValue * 100,
      formationDelta: 0, targetAdditive: 0, targetDebuff: 0 }),
      targetBuff: currentExternalBuffTotal }) / 100;
  const buffedMultiplier =
    (1 + panelWithExternalBuff) *
    groups
      .reduce((product, group) => product * group.multiplier, 1);
  const reductionByGroup = new Map<string, { sum: number; ids: string[] }>();
  for (const effect of reductionEffects) {
    const current = reductionByGroup.get(effect.definition.group) ?? {
      sum: 0,
      ids: [],
    };
    current.sum += effect.definition.value * effect.stackCount;
    current.ids.push(effect.instanceId);
    reductionByGroup.set(effect.definition.group, current);
  }
  const reductionGroups = [...reductionByGroup.entries()].map(
    ([group, result]): ResolvedAttributeReductionGroup => ({
      group,
      summedValue: result.sum,
      divisionFactor: 1 + result.sum,
      effectInstanceIds: result.ids,
    }),
  );
  const reductionDivisionFactor = reductionGroups.reduce(
    (product, group) => product * group.divisionFactor,
    1,
  );
  const multiplier = buffedMultiplier / reductionDivisionFactor;
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new RangeError(`Resolved ${attribute} multiplier must be finite and non-negative.`);
  }
  return {
    currentExternalBuffBase, currentWeaponBuff, currentExternalBuffTotal,
    baseValue,
    buffedValue: buffedMultiplier - 1,
    effectiveValue: multiplier - 1,
    multiplier,
    groups,
    effects,
    reductionGroups,
    reductionEffects,
  };
}
