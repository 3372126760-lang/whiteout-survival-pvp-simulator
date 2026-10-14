import type { RuleStatus } from "../types/effect";

export interface CasualtyRoundingContext {
  readonly aliveCount: number;
  readonly frontUnitHp: number;
  readonly maxHpPerUnit: number;
}

export interface FullUnitCasualtyContext extends CasualtyRoundingContext {
  readonly remainingAliveCount: number;
  readonly remainingDamageAfterFrontUnit: number;
  readonly exactFullUnitCasualties: number;
}

export interface CasualtyRoundingStrategy {
  readonly id: string;
  readonly ruleStatus: RuleStatus;
  readonly provisional: boolean;
  readonly normalizeIncomingDamage: (
    incomingDamage: number,
    context: CasualtyRoundingContext,
  ) => number;
  readonly resolveFullUnitCasualties: (
    context: FullUnitCasualtyContext,
  ) => number;
}

/** Confirmed: each damage segment is rounded before residual-HP resolution. */
export const CONFIRMED_INTEGER_DAMAGE_ROUNDING: CasualtyRoundingStrategy = {
  id: "confirmed-nearest-integer-damage-floor-full-casualties",
  ruleStatus: "supported",
  provisional: false,
  normalizeIncomingDamage: (incomingDamage) => Math.round(incomingDamage),
  resolveFullUnitCasualties: (context) =>
    Math.min(
      context.remainingAliveCount,
      Math.floor(context.exactFullUnitCasualties),
    ),
};
