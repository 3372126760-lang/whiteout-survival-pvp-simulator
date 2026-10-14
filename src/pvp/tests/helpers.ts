import {
  createActiveEffect,
  type ActiveEffect,
  type DamageModifierEffectDefinition,
  type EffectScope,
  type TroopSetup,
  type TroopSkillRuntimeState,
  type BattleSideSetup,
  type TroopType,
} from "../../pvp";

export interface SideHelperOptions {
  readonly troopConstant?: number;
  readonly maxHpPerUnit?: number;
  readonly armyEffects?: readonly ActiveEffect[];
  readonly troopBuffs?: Readonly<
    Partial<Record<TroopType, readonly ActiveEffect[]>>
  >;
  readonly skillStates?: Readonly<
    Partial<Record<TroopType, readonly TroopSkillRuntimeState[]>>
  >;
}

export function makeSide(
  counts: Readonly<Partial<Record<TroopType, number>>>,
  options: SideHelperOptions = {},
): BattleSideSetup {
  const troop = (type: TroopType): TroopSetup => ({
    count: counts[type] ?? 0,
    troopLevel: "TEST",
    troopConstant: options.troopConstant ?? 1,
    troopHpCoefficient:
      (options.maxHpPerUnit ?? 1_000) / (options.troopConstant ?? 1),
    attack: 0,
    penetration: 0,
    defense: 0,
    life: 0,
    buffs: options.troopBuffs?.[type] ?? [],
    skillStates: options.skillStates?.[type] ?? [],
  });
  return {
    troops: {
      shield: troop("shield"),
      lancer: troop("lancer"),
      marksman: troop("marksman"),
    },
    armyEffects: options.armyEffects ?? [],
  };
}

export interface DamageEffectOptions {
  readonly id: string;
  readonly kind: DamageModifierEffectDefinition["kind"];
  readonly group: string;
  readonly value: number;
  readonly scope?: EffectScope;
  readonly appliedRound?: number;
}

export function makeDamageEffect(options: DamageEffectOptions): ActiveEffect {
  return createActiveEffect({
    identity: {
      sourceId: `source:${options.id}`,
      sourceSkillId: `skill:${options.id}`,
      effectId: options.id,
    },
    definition: {
      id: options.id,
      name: options.id,
      kind: options.kind,
      group: options.group,
      value: options.value,
      ruleStatus: "supported",
      ...(options.scope === undefined ? {} : { scope: options.scope }),
    },
    appliedRound: options.appliedRound ?? 1,
  });
}
