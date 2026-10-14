import { resolveRoundFast, type RoundResolutionOptions } from "../round/resolveRound";
import { TROOP_TYPES, type SideId, type TroopType } from "../types/combat";
import type { BattleSide, BattleState } from "../types/battle";

export type FastTroopCounts = Readonly<Record<TroopType, number>>;
export interface FastBattleResult {
  readonly outcome: SideId | "draw" | "timeout";
  readonly winner: SideId | null;
  readonly failed: boolean;
  readonly rounds: number;
  readonly roundCount: number;
  readonly remaining: Readonly<Record<SideId, FastTroopCounts>>;
  readonly aRemaining: FastTroopCounts;
  readonly bRemaining: FastTroopCounts;
  readonly winnerRemaining: FastTroopCounts;
}

/** Copy mutable runtime containers; immutable definitions and effects are shared. */
export function cloneBattleTemplate(template: BattleState): BattleState {
  const cloneSide = (side: BattleSide): BattleSide => ({
    ...side,
    armyEffects: [...side.armyEffects],
    heroStates: side.heroStates.map((hero) => ({ ...hero,
      skillStates: hero.skillStates.map((runtime) => ({ ...runtime,
        mainAttackCounts: { ...runtime.mainAttackCounts } })),
    })),
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => {
      const stack = side.troops[troop];
      return [troop, { ...stack,
        levelComposition: stack.levelComposition.map((entry) => ({ ...entry })),
        initialLevelComposition: stack.initialLevelComposition.map((entry) => ({ ...entry })),
        temporaryShields: stack.temporaryShields.map((layer) => ({ ...layer })),
        buffs: [...stack.buffs], debuffs: [...stack.debuffs],
        skillStates: stack.skillStates.map((runtime) => ({ ...runtime })),
      }];
    })) as unknown as BattleSide["troops"],
  });
  return { ...template, sideA: cloneSide(template.sideA), sideB: cloneSide(template.sideB),
    pendingDamageEvents: [...template.pendingDamageEvents], battleLog: [] };
}

/** Optimizer-only output. No BattleTrace, skill log, damage report or final state. */
export const FastBattleMode = {
  run(template: BattleState, options: RoundResolutionOptions & {
    readonly maxRounds: number;
  }): FastBattleResult {
    if (!Number.isSafeInteger(options.maxRounds) || options.maxRounds < 1 || options.maxRounds > 1500) {
      throw new RangeError("maxRounds must be an integer from 1 to 1500.");
    }
    let state = cloneBattleTemplate(template);
    let roundCount = 0;
    while (state.status === "ready" && roundCount < options.maxRounds) {
      state = resolveRoundFast(state, options);
      roundCount += 1;
    }
    const counts = (side: BattleSide): FastTroopCounts => ({
      shield: side.troops.shield.aliveCount,
      lancer: side.troops.lancer.aliveCount,
      marksman: side.troops.marksman.aliveCount,
    });
    const remaining = { A: counts(state.sideA), B: counts(state.sideB) };
    const total = (side: SideId) => TROOP_TYPES.reduce((sum, troop) => sum + remaining[side][troop], 0);
    const outcome = state.status !== "completed" ? "timeout"
      : total("A") === total("B") ? "draw" : total("A") > total("B") ? "A" : "B";
    const winner = outcome === "A" || outcome === "B" ? outcome : null;
    return { outcome, winner, failed: winner === null, rounds: roundCount,
      roundCount, remaining, aRemaining: remaining.A, bRemaining: remaining.B,
      winnerRemaining: winner === null ? { shield: 0, lancer: 0, marksman: 0 } :
        remaining[winner] };
  },
};
