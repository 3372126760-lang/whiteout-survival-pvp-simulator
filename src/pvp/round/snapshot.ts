import type {
  BattleReadState,
  BattleSide,
  BattleState,
  RoundStartSnapshot,
} from "../types/battle";
import type { ActiveEffect, EffectDefinition } from "../types/effect";
import type { TroopState } from "../types/troop";
import { TROOP_TYPES } from "../types/combat";
import { validateBattleState } from "../battle/createBattleState";

export function createRoundStartSnapshot(
  state: BattleState,
): RoundStartSnapshot {
  validateBattleState(state);
  if (state.status !== "ready") {
    throw new Error("Cannot snapshot a completed battle.");
  }
  return {
    phase: "roundStartSnapshot",
    round: state.round,
    battleContext: state.battleContext,
    fixedInitialMinTroops: state.fixedInitialMinTroops,
    sideA: cloneSide(state.sideA),
    sideB: cloneSide(state.sideB),
  };
}

export function assertSnapshotMatchesState(
  snapshot: RoundStartSnapshot,
  state: BattleReadState,
): void {
  if (
    snapshot.round !== state.round ||
    snapshot.fixedInitialMinTroops !== state.fixedInitialMinTroops
  ) {
    throw new Error("Round snapshot does not match the battle state.");
  }
}

function cloneSide(side: BattleSide): BattleSide {
  return {
    ...side,
    troops: Object.fromEntries(
      TROOP_TYPES.map((type) => [type, cloneTroop(side.troops[type])]),
    ) as unknown as BattleSide["troops"],
    armyEffects: side.armyEffects.map(cloneEffect),
    heroStates: side.heroStates.map((hero) => ({
      ...hero,
      skillStates: hero.skillStates.map((skill) => ({ ...skill })),
    })),
  };
}

function cloneTroop(troop: TroopState): TroopState {
  return {
    ...troop,
    levelComposition: troop.levelComposition.map((entry) => ({ ...entry })),
    temporaryShields: troop.temporaryShields.map((shield) => ({ ...shield })),
    buffs: troop.buffs.map(cloneEffect),
    debuffs: troop.debuffs.map(cloneEffect),
    skillStates: troop.skillStates.map((skill) => ({ ...skill })),
  };
}

function cloneEffect(effect: ActiveEffect): ActiveEffect {
  return {
    ...effect,
    identity: { ...effect.identity },
    definition: cloneDefinition(effect.definition),
  };
}

function cloneDefinition(definition: EffectDefinition): EffectDefinition {
  const scope = definition.scope;
  const clonedScope =
    scope === undefined
      ? undefined
      : {
          ...(scope.sourceTroops === undefined
            ? {}
            : { sourceTroops: [...scope.sourceTroops] }),
          ...(scope.targetTroops === undefined
            ? {}
            : { targetTroops: [...scope.targetTroops] }),
          ...(scope.damageTypes === undefined
            ? {}
            : { damageTypes: [...scope.damageTypes] }),
          ...(scope.damageSubtypes === undefined
            ? {}
            : { damageSubtypes: [...scope.damageSubtypes] }),
        };
  const lifecycle =
    definition.lifecycle === undefined
      ? undefined
      : {
          ...definition.lifecycle,
          ...(definition.lifecycle.activeRounds === undefined
            ? {}
            : { activeRounds: [...definition.lifecycle.activeRounds] }),
        };
  if (definition.kind === "targetingOverride") {
    return {
      ...definition,
      priority: [...definition.priority],
      ...(clonedScope === undefined ? {} : { scope: clonedScope }),
      ...(lifecycle === undefined ? {} : { lifecycle }),
    };
  }
  return {
    ...definition,
    ...(clonedScope === undefined ? {} : { scope: clonedScope }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
  };
}
