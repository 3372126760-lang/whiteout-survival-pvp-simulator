import {
  TROOP_DAMAGE_COEFFICIENTS,
  TROOP_HP_COEFFICIENTS,
  getTroopConstant,
  resolveTroopConstant,
  isSupportedTroopLevel,
} from "../data";
import { validateActiveEffect } from "../effects";
import { calculateEffectiveTroopConstant, calculateTroopHp } from "../formulas";
import {
  SIDE_IDS,
  TROOP_TYPES,
  type SideId,
  type TroopType,
} from "../types/combat";
import type {
  BattleSetup,
  BattleSide,
  BattleSideSetup,
  BattleState,
} from "../types/battle";
import type {
  TroopLevelCompositionEntry,
  TroopSetup,
  TroopState,
} from "../types/troop";
import { validateTroopSkillRuntimeState } from "../troopSkills/runtime";
import { validateHeroSkillRuntimeState } from "../heroSkills/runtime";
import { heroDefinitionId, heroRuntimeId, initializeHeroIdentities } from "../heroSkills/identity";

export function createBattleState(setup: BattleSetup): BattleState {
  const sideA = createBattleSide("A", setup.sideA);
  const sideB = createBattleSide("B", setup.sideB);
  const state: BattleState = {
    round: 1,
    battleContext: setup.battleContext ?? "unspecified",
    fixedInitialMinTroops: Math.min(
      sideA.initialTotalCount,
      sideB.initialTotalCount,
    ),
    sideA,
    sideB,
    status: "ready",
    pendingDamageEvents: [],
    battleLog: [],
  };
  validateBattleState(state);
  return state;
}

export function createBattleSide(
  id: SideId,
  setup: BattleSideSetup,
): BattleSide {
  const troops = Object.fromEntries(
    TROOP_TYPES.map((type) => [type, createTroopState(type, setup.troops[type])]),
  ) as unknown as Readonly<Record<TroopType, TroopState>>;
  const initialTotalCount = TROOP_TYPES.reduce(
    (sum, type) => sum + troops[type].initialCount,
    0,
  );
  if (!Number.isSafeInteger(initialTotalCount)) {
    throw new RangeError("Side initial total count exceeds safe integer range.");
  }
  for (const effect of setup.armyEffects ?? []) validateActiveEffect(effect);
  const heroStates = initializeHeroIdentities(setup.heroStates ?? [], id);
  const runtimeIds = new Set<string>();
  const leaderIds = new Set<string>();
  let leaderCount = 0;
  for (const hero of heroStates) {
    const runtimeId = heroRuntimeId(hero);
    const definitionId = heroDefinitionId(hero);
    if (!definitionId.trim()) throw new Error("Hero definition id cannot be empty.");
    if (!runtimeId.trim() || runtimeIds.has(runtimeId)) {
      throw new Error("Hero runtimeInstanceId must be non-empty and unique per side.");
    }
    runtimeIds.add(runtimeId);
    if (hero.position === "leader" && leaderIds.has(definitionId)) {
      throw new Error(`Duplicate leader hero definition: ${definitionId}.`);
    }
    if (hero.position === "leader") leaderIds.add(definitionId);
    if (hero.position === "leader") leaderCount += 1;
    if (leaderCount > 3) throw new Error("A side can have at most three leader heroes.");
    const skillIds = new Set<string>();
    for (const runtime of hero.skillStates) {
      validateHeroSkillRuntimeState(runtime);
      if (skillIds.has(runtime.skillId)) {
        throw new Error(`Duplicate hero skill runtime: ${runtime.skillId}.`);
      }
      skillIds.add(runtime.skillId);
    }
  }
  return {
    id,
    initialTotalCount,
    troops,
    armyEffects: [...(setup.armyEffects ?? [])],
    heroStates,
    ...(setup.heroStatCorrection === undefined
      ? {}
      : { heroStatCorrection: setup.heroStatCorrection }),
  };
}

export function createTroopState(
  type: TroopType,
  setup: TroopSetup,
): TroopState {
  if (!Number.isSafeInteger(setup.count) || setup.count < 0) {
    throw new RangeError("Troop count must be a non-negative safe integer.");
  }
  if (!setup.troopLevel.trim()) {
    throw new Error("troopLevel cannot be empty.");
  }
  // Mixed composition must not bypass validation of a nonexistent primary level.
  if (/^T\d/i.test(setup.troopLevel.trim()) && !isSupportedTroopLevel(setup.troopLevel)) {
    getTroopConstant(setup.troopLevel);
  }
  const levelComposition = normalizeLevelComposition(setup);
  const troopConstant = resolveEffectiveConstant(setup, levelComposition);
  const canonical = isSupportedTroopLevel(setup.troopLevel) ||
    levelComposition.some((entry) => isSupportedTroopLevel(entry.level));
  const troopHpCoefficient = canonical ? TROOP_HP_COEFFICIENTS[type]
    : setup.troopHpCoefficient ?? TROOP_HP_COEFFICIENTS[type];
  const hp = calculateTroopHp({
    troopConstant,
    troopHpCoefficient,
    defense: setup.defense,
    life: setup.life,
  });
  const damageCoefficient = canonical ? TROOP_DAMAGE_COEFFICIENTS[type]
    : setup.damageCoefficient ?? TROOP_DAMAGE_COEFFICIENTS[type];
  if (!Number.isFinite(damageCoefficient) || damageCoefficient < 0) {
    throw new RangeError("damageCoefficient must be non-negative and finite.");
  }
  for (const [label, value] of [
    ["attack", setup.attack],
    ["penetration", setup.penetration],
    ["defense", setup.defense],
    ["life", setup.life],
  ] as const) {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  }
  for (const effect of [...(setup.buffs ?? []), ...(setup.debuffs ?? [])]) {
    validateActiveEffect(effect);
  }
  const skillIds = new Set<string>();
  for (const runtime of setup.skillStates ?? []) {
    validateTroopSkillRuntimeState(runtime);
    if (skillIds.has(runtime.skillId)) {
      throw new Error(`Duplicate troop skill runtime: ${runtime.skillId}.`);
    }
    skillIds.add(runtime.skillId);
  }
  return {
    type,
    troopLevel: setup.troopLevel,
    initialCount: setup.count,
    aliveCount: setup.count,
    levelComposition,
    initialLevelComposition: levelComposition.map((entry) => ({ ...entry })),
    frontUnitHp: setup.count === 0 ? 0 : hp.effectiveHpPerUnit,
    baseHpPerUnit: hp.baseHpPerUnit,
    maxHpPerUnit: hp.effectiveHpPerUnit,
    temporaryShieldHp: 0,
    temporaryShields: [],
    damageCoefficient,
    troopConstant,
    troopHpCoefficient,
    attack: setup.attack,
    penetration: setup.penetration,
    defense: setup.defense,
    life: setup.life,
    ...(setup.reportAttributeContext === undefined ? {} :
      { reportAttributeContext: setup.reportAttributeContext }),
    buffs: [...(setup.buffs ?? [])],
    debuffs: [...(setup.debuffs ?? [])],
    skillStates: [...(setup.skillStates ?? [])],
  };
}

export function replaceTroop(
  side: BattleSide,
  troopType: TroopType,
  troop: TroopState,
): BattleSide {
  return {
    ...side,
    troops: { ...side.troops, [troopType]: troop },
  };
}

export function totalAlive(side: BattleSide): number {
  return TROOP_TYPES.reduce(
    (sum, troop) => sum + side.troops[troop].aliveCount,
    0,
  );
}

export function validateBattleState(state: BattleState): void {
  if (!Number.isSafeInteger(state.round) || state.round < 1) {
    throw new RangeError("Battle round must be a positive safe integer.");
  }
  if (
    !Number.isSafeInteger(state.fixedInitialMinTroops) ||
    state.fixedInitialMinTroops < 0
  ) {
    throw new RangeError("fixedInitialMinTroops must be non-negative.");
  }
  const expectedFixedInitialMinTroops = Math.min(
    state.sideA.initialTotalCount,
    state.sideB.initialTotalCount,
  );
  if (state.fixedInitialMinTroops !== expectedFixedInitialMinTroops) {
    throw new Error(
      "fixedInitialMinTroops must remain the minimum of both initial totals.",
    );
  }
  for (const id of SIDE_IDS) {
    const side = id === "A" ? state.sideA : state.sideB;
    if (side.id !== id) throw new Error(`Expected side ${id}.`);
    for (const troop of TROOP_TYPES) {
      const stack = side.troops[troop];
      if (stack.type !== troop) throw new Error(`Expected troop ${troop}.`);
      const compositionTotal = stack.levelComposition.reduce(
        (sum, entry) => sum + entry.aliveCount,
        0,
      );
      if (compositionTotal !== stack.aliveCount) {
        throw new Error(
          `${id}.${troop} levelComposition must sum to aliveCount.`,
        );
      }
      const shieldTotal = stack.temporaryShields.reduce(
        (sum, shield) => sum + shield.remainingShieldHp,
        0,
      );
      if (
        !Number.isFinite(stack.temporaryShieldHp) ||
        stack.temporaryShieldHp < 0 ||
        Math.abs(shieldTotal - stack.temporaryShieldHp) > Number.EPSILON
      ) {
        throw new Error(
          `${id}.${troop} temporaryShieldHp must equal its shield layers.`,
        );
      }
    }
  }
}

function normalizeLevelComposition(
  setup: TroopSetup,
): readonly TroopLevelCompositionEntry[] {
  const composition = setup.levelComposition ?? [{
    level: setup.troopLevel,
    aliveCount: setup.count,
  }];
  if (composition.length === 0) {
    throw new Error("levelComposition must contain at least one level.");
  }
  const seen = new Set<string>();
  let total = 0;
  const normalized = composition.map((entry) => {
    if (!entry.level.trim() || seen.has(entry.level)) {
      throw new Error("levelComposition levels must be non-empty and unique.");
    }
    seen.add(entry.level);
    if (!Number.isSafeInteger(entry.aliveCount) || entry.aliveCount < 0) {
      throw new RangeError(
        "levelComposition aliveCount must be a non-negative safe integer.",
      );
    }
    total += entry.aliveCount;
    return { ...entry };
  });
  if (total !== setup.count) {
    throw new Error("levelComposition must sum exactly to troop count.");
  }
  return normalized;
}

function resolveEffectiveConstant(
  setup: TroopSetup,
  composition: readonly TroopLevelCompositionEntry[],
): number {
  if (setup.levelComposition === undefined) {
    return resolveTroopConstant(setup.troopLevel, setup.troopConstant);
  }
  // Explicit mixed-level compositions must use the formal PVP mirror table.
  for (const entry of composition) getTroopConstant(entry.level);
  if (setup.count === 0) {
    return resolveTroopConstant(setup.troopLevel, setup.troopConstant);
  }
  return calculateEffectiveTroopConstant(composition).effectiveTroopConstant;
}
