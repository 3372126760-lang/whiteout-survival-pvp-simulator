import type { MultiplierGroupResult } from "../types/damage";
import type {
  ActiveDamageModifierEffect,
  ActiveDefenseReductionEffect,
  ActiveIncomingDamageIncreaseEffect,
} from "../types/effect";

export interface GroupedMultiplierResult {
  readonly groups: readonly MultiplierGroupResult[];
  readonly combined: number;
}

/** Same group adds as 1 + sum(value * stacks); distinct groups multiply. */
export function computeGroupedMultiplier(
  effects: readonly (
    | ActiveDamageModifierEffect
    | ActiveDefenseReductionEffect
    | ActiveIncomingDamageIncreaseEffect
  )[],
): GroupedMultiplierResult {
  const byGroup = new Map<
    string,
    { sum: number; instanceIds: string[] }
  >();
  for (const effect of effects) {
    const current = byGroup.get(effect.definition.group) ?? {
      sum: 0,
      instanceIds: [],
    };
    current.sum += effect.definition.value * effect.stackCount;
    current.instanceIds.push(effect.instanceId);
    byGroup.set(effect.definition.group, current);
  }
  const groups = [...byGroup.entries()].map(
    ([group, { sum, instanceIds }]): MultiplierGroupResult => {
      const multiplier = 1 + sum;
      if (!Number.isFinite(multiplier) || multiplier <= 0) {
        throw new RangeError(
          `Effect group ${group} produced a non-positive multiplier.`,
        );
      }
      return {
        group,
        summedValue: sum,
        multiplier,
        effectInstanceIds: instanceIds,
      };
    },
  );
  return {
    groups,
    combined: groups.reduce((product, group) => product * group.multiplier, 1),
  };
}

export const computeDamageIncreaseMultiplier = computeGroupedMultiplier;
export const computeReductionMultiplier = computeGroupedMultiplier;
