import { totalAlive } from "../battle/createBattleState";
import {
  resolvePendingDamage,
  type MixedLevelTargetCasualtyResolution,
  type TargetCasualtyResolution,
} from "../casualty";
import { advanceEffectDurations } from "../effects";
import { createRoundBattleTrace, type RoundBattleTrace } from "../logging";
import { TROOP_TYPES } from "../types/combat";
import type {
  BattleSide,
  BattleState,
  RoundStartSnapshot,
} from "../types/battle";
import type { TroopState } from "../types/troop";
import {
  runActionPhase,
  type ActionPhaseOptions,
} from "./actionPhase";
import { createRoundStartSnapshot } from "./snapshot";
import type { PendingDamageResolutionOptions } from "../casualty/resolvePendingDamage";
import type { TroopSkillSystem, TroopSkillTraceEntry } from "../troopSkills";
import type { HeroSkillSystem, HeroSkillTraceEntry } from "../heroSkills";

export interface RoundEndResolution {
  readonly state: BattleState;
  readonly casualties: readonly TargetCasualtyResolution[];
  readonly mixedLevelCasualties: readonly MixedLevelTargetCasualtyResolution[];
}

export interface ResolvedRound {
  readonly round: number;
  readonly snapshot: RoundStartSnapshot;
  readonly stateAfterActionPhase: BattleState;
  readonly stateAfter: BattleState;
  readonly casualties: readonly TargetCasualtyResolution[];
  readonly mixedLevelCasualties: readonly MixedLevelTargetCasualtyResolution[];
  readonly trace: RoundBattleTrace;
}

export interface CompactResolvedRound {
  readonly stateAfter: BattleState;
  readonly damageA: number;
  readonly damageB: number;
  /** Explicit skill-damage event attribution; never added back to total casualties. */
  readonly skillCasualtiesBySide: Readonly<Record<"A" | "B", Readonly<Record<string, number>>>>;
}

export interface RoundResolutionOptions
  extends ActionPhaseOptions,
    PendingDamageResolutionOptions {
  /** Optional injected subsystem; resolveRound contains no concrete skill rules. */
  readonly troopSkillSystem?: TroopSkillSystem;
  /** Optional hero subsystem composed through the same action/effect providers. */
  readonly heroSkillSystem?: HeroSkillSystem;
  /** Receives transient skill decisions without retaining a round trace. */
  readonly onSkillTrace?: ((
    troop: readonly TroopSkillTraceEntry[],
    hero: readonly HeroSkillTraceEntry[],
  ) => void) | undefined;
}

export function resolveRoundEnd(
  state: BattleState,
  options: PendingDamageResolutionOptions = {},
): RoundEndResolution {
  if (state.status !== "ready") {
    throw new Error("Cannot resolve the end of a completed battle.");
  }
  const casualtyResolution = resolvePendingDamage(state, options);
  const sideA = advanceSideEffects(casualtyResolution.state.sideA, state.round);
  const sideB = advanceSideEffects(casualtyResolution.state.sideB, state.round);
  const completed = totalAlive(sideA) === 0 || totalAlive(sideB) === 0;
  const nextStatus = completed ? "completed" : "ready";
  const nextState: BattleState = {
    ...casualtyResolution.state,
    round: completed ? state.round : state.round + 1,
    sideA,
    sideB,
    status: nextStatus,
    battleLog: options.recordBattleLog === false ? casualtyResolution.state.battleLog : [
      ...casualtyResolution.state.battleLog,
      { type: "roundEnd", round: state.round, battleStatus: nextStatus },
    ],
  };
  return {
    state: nextState,
    casualties: casualtyResolution.targets,
    mixedLevelCasualties: casualtyResolution.mixedLevelCasualties,
  };
}

export function resolveRound(
  state: BattleState,
  options: RoundResolutionOptions = {},
): ResolvedRound {
  const resolved = resolveRoundInternal(state, options, true);
  const trace = createRoundBattleTrace(
    resolved.snapshot,
    resolved.action.generatedEvents,
    resolved.end.state,
    resolved.end.casualties,
    resolved.end.mixedLevelCasualties,
    resolved.troopTrace,
    resolved.heroTrace,
  );
  return {
    round: resolved.snapshot.round,
    snapshot: resolved.snapshot,
    stateAfterActionPhase: resolved.stateAfterAction,
    stateAfter: resolved.end.state,
    casualties: resolved.end.casualties,
    mixedLevelCasualties: resolved.end.mixedLevelCasualties,
    trace,
  };
}

/** Runs the identical action/casualty chain but never creates or retains BattleTrace. */
export function resolveRoundCompact(
  state: BattleState,
  options: RoundResolutionOptions = {},
): CompactResolvedRound {
  const resolved = resolveRoundInternal(state, { ...options, recordBattleLog: false }, false);
  let damageA = 0;
  let damageB = 0;
  const skillCasualtiesBySide: Record<"A" | "B", Record<string, number>> = {
    A: {}, B: {},
  };
  for (const event of resolved.action.generatedEvents) {
    if (event.sourceSide === "A") damageA += event.finalDamage;
    else damageB += event.finalDamage;
    if (event.sourceSkillId !== undefined && event.damageType === "skillDamage" &&
      event.sourceSkillId !== "hero-skill.ruini.dream-mark") {
      skillCasualtiesBySide[event.sourceSide][event.sourceSkillId] ??= 0;
    }
  }
  for (const casualty of resolved.end.casualties) {
    if (casualty.casualties === 0) continue;
    for (const event of casualty.sourceEvents) {
      if (event.sourceSkillId === undefined || event.damageType !== "skillDamage" ||
        event.sourceSkillId === "hero-skill.ruini.dream-mark") continue;
      const side = skillCasualtiesBySide[event.sourceSide];
      side[event.sourceSkillId] = (side[event.sourceSkillId] ?? 0) + casualty.casualties;
    }
  }
  return { stateAfter: resolved.end.state, damageA, damageB, skillCasualtiesBySide };
}

/** Same resolution chain; skips trace and reporting-only damage attribution. */
export function resolveRoundFast(
  state: BattleState,
  options: RoundResolutionOptions = {},
): BattleState {
  return resolveRoundInternal(state, {
    ...options, recordBattleLog: false, onSkillTrace: undefined,
  }, false).end.state;
}

function resolveRoundInternal(
  state: BattleState,
  options: RoundResolutionOptions,
  retainTrace: boolean,
) {
  const skillRound = options.troopSkillSystem?.prepareRound(state);
  const heroRound = options.heroSkillSystem?.prepareRound(
    skillRound?.state ?? state,
  );
  const roundState = heroRound?.state ?? skillRound?.state ?? state;
  const snapshot = createRoundStartSnapshot(roundState);
  const action = runActionPhase(roundState, snapshot, {
    ...options,
    additionalDamageGenerators: [
      ...(options.additionalDamageGenerators ?? []),
      ...(skillRound === undefined ? [] : [skillRound.additionalDamageGenerator]),
      ...(heroRound === undefined ? [] : [heroRound.additionalDamageGenerator]),
    ],
    targetingEffectProviders: [
      ...(options.targetingEffectProviders ?? []),
      ...(skillRound === undefined ? [] : [skillRound.targetingEffectProvider]),
      ...(heroRound === undefined ? [] : [heroRound.targetingEffectProvider]),
    ],
    damageEventEffectProviders: [
      ...(options.damageEventEffectProviders ?? []),
      ...(skillRound === undefined ? [] : [skillRound.damageEventEffectProvider]),
      ...(heroRound === undefined ? [] : [heroRound.damageEventEffectProvider]),
    ],
    mainAttackLifecycleProviders: [
      ...(options.mainAttackLifecycleProviders ?? []),
      ...(heroRound === undefined ? [] : [heroRound.mainAttackLifecycleProvider]),
    ],
  });
  const troopFinalized =
    skillRound?.finalizeActionState(action.state) ?? action.state;
  const stateAfterAction =
    heroRound?.finalizeActionState(troopFinalized) ?? troopFinalized;
  const end = resolveRoundEnd(stateAfterAction, options);
  const troopTrace = retainTrace || options.onSkillTrace !== undefined
    ? skillRound?.getTraceEntries() ?? [] : [];
  const heroTrace = retainTrace || options.onSkillTrace !== undefined
    ? heroRound?.getTraceEntries() ?? [] : [];
  options.onSkillTrace?.(troopTrace, heroTrace);
  return { snapshot, action, end, stateAfterAction, troopTrace, heroTrace };
}

function advanceSideEffects(side: BattleSide, completedRound: number): BattleSide {
  return {
    ...side,
    armyEffects: advanceEffectDurations(side.armyEffects),
    troops: Object.fromEntries(
      TROOP_TYPES.map((type) => {
        const troop = side.troops[type];
        const temporaryShields = troop.temporaryShields.filter((shield) =>
          troop.aliveCount > 0 && shield.remainingShieldHp > 0 &&
          shield.expiresAfterRound > completedRound);
        const next: TroopState = {
          ...troop,
          temporaryShieldHp: temporaryShields.reduce((sum, shield) =>
            sum + (shield.activeFromRound <= completedRound + 1
              ? shield.remainingShieldHp : 0), 0),
          temporaryShields,
          buffs: advanceEffectDurations(troop.buffs),
          debuffs: advanceEffectDurations(troop.debuffs).filter(
            (effect) => troop.aliveCount > 0 ||
              effect.definition.kind !== "oneUseIncomingDamageIncrease",
          ),
        };
        return [type, next];
      }),
    ) as unknown as BattleSide["troops"],
  };
}
