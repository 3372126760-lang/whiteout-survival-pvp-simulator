import type { BattleLogEntry } from "../logging/types";
import type { ActiveEffect } from "./effect";
import type { DamageEvent } from "./damage";
import type { BattleContext, SideId, TroopType } from "./combat";
import type { TroopSetup, TroopState } from "./troop";
import type { HeroState } from "../heroSkills/types";
import type { HeroStatCorrection } from "../heroSkills/heroStatCorrection";

export type { HeroState } from "../heroSkills/types";

export interface BattleSide {
  readonly id: SideId;
  readonly initialTotalCount: number;
  readonly troops: Readonly<Record<TroopType, TroopState>>;
  readonly armyEffects: readonly ActiveEffect[];
  readonly heroStates: readonly HeroState[];
  readonly heroStatCorrection?: HeroStatCorrection;
}

export interface BattleSideSetup {
  readonly troops: Readonly<Record<TroopType, TroopSetup>>;
  readonly armyEffects?: readonly ActiveEffect[];
  readonly heroStates?: readonly HeroState[];
  readonly heroStatCorrection?: HeroStatCorrection;
}

export interface BattleSetup {
  readonly sideA: BattleSideSetup;
  readonly sideB: BattleSideSetup;
  readonly battleContext?: BattleContext;
}

export interface BattleReadState {
  readonly round: number;
  readonly battleContext: BattleContext;
  readonly fixedInitialMinTroops: number;
  readonly sideA: BattleSide;
  readonly sideB: BattleSide;
}

export interface BattleState extends BattleReadState {
  readonly status: "ready" | "completed";
  readonly pendingDamageEvents: readonly DamageEvent[];
  readonly battleLog: readonly BattleLogEntry[];
}

export interface RoundStartSnapshot extends BattleReadState {
  readonly phase: "roundStartSnapshot";
}

export function sideFromState(
  state: BattleReadState,
  side: SideId,
): BattleSide {
  return side === "A" ? state.sideA : state.sideB;
}
