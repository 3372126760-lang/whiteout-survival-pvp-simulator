import type { BattleReadState } from "../types/battle";
import type { DamageEvent } from "../types/damage";
import type { SideId, TroopType } from "../types/combat";
import type { RuleStatus } from "../types/effect";

export interface OverflowDamageAllocation {
  readonly targetSide: SideId;
  readonly targetTroop: TroopType;
  readonly damage: number;
}

export interface OverflowDamageContext {
  readonly battleState: BattleReadState;
  readonly sourceEvents: readonly DamageEvent[];
  readonly originalTargetSide: SideId;
  readonly originalTargetTroop: TroopType;
  readonly unabsorbedDamage: number;
}

export interface OverflowDamageStrategy {
  readonly id: string;
  readonly ruleStatus: RuleStatus;
  readonly provisional: boolean;
  readonly allocate: (
    context: OverflowDamageContext,
  ) => readonly OverflowDamageAllocation[];
}

/** Confirmed: overkill is discarded and never retargeted. */
export const CONFIRMED_DISCARD_OVERFLOW: OverflowDamageStrategy = {
  id: "confirmed-discard-overflow-without-retargeting",
  ruleStatus: "supported",
  provisional: false,
  allocate: () => [],
};
