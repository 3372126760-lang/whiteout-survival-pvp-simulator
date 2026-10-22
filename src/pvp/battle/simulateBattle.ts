import type { BattleState } from "../types/battle";
import type { BattleTrace } from "../logging";
import { attributeResolvedDamage, emptyDamageAttribution, mergeDamageAttribution,
  type DamageAttribution } from "../statistics/skillDamageAttribution";
import {
  resolveRound,
  resolveRoundCompact,
  type ResolvedRound,
  type RoundResolutionOptions,
} from "../round/resolveRound";

export interface SimulateBattleOptions extends RoundResolutionOptions {
  readonly maxRounds: number;
  readonly traceMode?: "full" | "summary" | "none";
}

export interface BattleSimulationResult {
  readonly finalState: BattleState;
  readonly rounds: readonly ResolvedRound[];
  readonly endReason: "elimination" | "roundLimit";
  readonly trace: BattleTrace;
  readonly damageAttribution: DamageAttribution;
}

export interface CompactBattleSimulationResult {
  readonly finalState: BattleState;
  readonly roundCount: number;
  readonly endReason: "elimination" | "roundLimit";
  readonly totalDamage: { readonly A: number; readonly B: number };
  readonly skillCasualtiesBySide: Readonly<Record<"A" | "B", Readonly<Record<string, number>>>>;
  readonly damageAttribution: DamageAttribution;
}

export function simulateBattle(
  initialState: BattleState,
  options: SimulateBattleOptions & { readonly traceMode: "summary" | "none" },
): CompactBattleSimulationResult;
export function simulateBattle(
  initialState: BattleState,
  options: SimulateBattleOptions & { readonly traceMode?: "full" },
): BattleSimulationResult;
export function simulateBattle(
  initialState: BattleState,
  options: SimulateBattleOptions,
): BattleSimulationResult | CompactBattleSimulationResult;

export function simulateBattle(
  initialState: BattleState,
  options: SimulateBattleOptions,
): BattleSimulationResult | CompactBattleSimulationResult {
  if (!Number.isSafeInteger(options.maxRounds) || options.maxRounds < 1 || options.maxRounds > 1500) {
    throw new RangeError("maxRounds must be an integer from 1 to 1500.");
  }
  let state = initialState;
  const damageAttribution = emptyDamageAttribution(options.traceMode !== "none");
  if (options.traceMode === "summary" || options.traceMode === "none") {
    let roundCount = 0;
    let damageA = 0;
    let damageB = 0;
    const skillCasualtiesBySide: Record<"A" | "B", Record<string, number>> = {
      A: {}, B: {},
    };
    const compactOptions = options.traceMode === "none"
      ? { ...options, onSkillTrace: undefined }
      : options;
    while (state.status === "ready" && roundCount < options.maxRounds) {
      const resolved = resolveRoundCompact(state, compactOptions);
      state = resolved.stateAfter;
      damageA += resolved.damageA;
      damageB += resolved.damageB;
      if (options.traceMode === "summary") {
        mergeDamageAttribution(damageAttribution, resolved.damageAttribution);
        for (const side of ["A", "B"] as const) {
          for (const [skillId, casualties] of Object.entries(resolved.skillCasualtiesBySide[side])) {
            skillCasualtiesBySide[side][skillId] =
              (skillCasualtiesBySide[side][skillId] ?? 0) + casualties;
          }
        }
      }
      roundCount += 1;
    }
    return {
      finalState: state,
      roundCount,
      endReason: state.status === "completed" ? "elimination" : "roundLimit",
      totalDamage: { A: damageA, B: damageB },
      skillCasualtiesBySide,
      damageAttribution,
    };
  }
  const rounds: ResolvedRound[] = [];
  while (state.status === "ready" && rounds.length < options.maxRounds) {
    const resolved = resolveRound(state, options);
    mergeDamageAttribution(damageAttribution,
      attributeResolvedDamage(resolved.stateAfterActionPhase.pendingDamageEvents, resolved.casualties));
    rounds.push(resolved);
    state = resolved.stateAfter;
  }
  const endReason = state.status === "completed" ? "elimination" : "roundLimit";
  return {
    finalState: state,
    rounds,
    endReason,
    damageAttribution,
    trace: {
      heroStatCorrections: {
        ...(initialState.sideA.heroStatCorrection === undefined
          ? {}
          : { A: initialState.sideA.heroStatCorrection }),
        ...(initialState.sideB.heroStatCorrection === undefined
          ? {}
          : { B: initialState.sideB.heroStatCorrection }),
      },
      rounds: rounds.map((round) => round.trace),
      endReason,
      finalStatus: state.status,
    },
  };
}
