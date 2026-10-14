import { replaceTroop } from "../battle/createBattleState";
import { createActiveEffect, upsertActiveEffect } from "../effects";
import { getTroopSkillUiSummary } from "../skillPresentation";
import type {
  AdditionalDamageContext,
  AdditionalDamageGenerator,
  DamageEventEffectProvider,
  DamageEventEffectContext,
  MainAttackHitContext,
  TargetingEffectContext,
  TargetingEffectProvider,
} from "../round/actionPhase";
import { otherSide, SIDE_IDS, TROOP_TYPES, type SideId, type TroopType } from "../types/combat";
import { sideFromState, type BattleSide, type BattleState } from "../types/battle";
import type { DamageEventInput } from "../types/damage";
import type {
  ActiveEffect,
  EffectDefinition,
  EffectLifecycle,
  EffectScope,
} from "../types/effect";
import type {
  RandomSource,
} from "./runtime";
import { validateTroopSkillDefinition } from "./runtime";
import type {
  TroopSkillDefinition,
  TroopSkillEffect,
  TroopSkillLevelValue,
  TroopSkillLifecycleChange,
  TroopSkillRuntimeState,
  TroopSkillReportActivation,
  TroopSkillTraceEntry,
  TroopSkillTrigger,
  TroopSkillTriggerOverrides,
} from "./types";

export interface TroopSkillSystemConfig {
  readonly definitions: readonly TroopSkillDefinition[];
  readonly randomSource?: RandomSource;
  /** Explicit debug/test/known-result decisions; most-specific key wins. */
  readonly triggerOverrides?: TroopSkillTriggerOverrides;
  /** Batch modes do not retain per-check diagnostic entries. */
  readonly recordTrace?: boolean;
  /** Additional inherited effect-use segments, separate from probability decisions. */
  readonly onReportActivation?: (activation: TroopSkillReportActivation) => void;
  readonly onProbabilityDecision?: (decision: {
    readonly side: SideId;
    readonly skillId: string;
    readonly probability: number;
    readonly triggered: boolean;
  }) => void;
}

export interface TroopSkillRoundPreparation {
  readonly state: BattleState;
  readonly targetingEffectProvider: TargetingEffectProvider;
  readonly additionalDamageGenerator: AdditionalDamageGenerator;
  readonly damageEventEffectProvider: DamageEventEffectProvider;
  readonly finalizeActionState: (state: BattleState) => BattleState;
  readonly getTraceEntries: () => readonly TroopSkillTraceEntry[];
}

export interface TroopSkillSystem {
  readonly prepareRound: (state: BattleState) => TroopSkillRoundPreparation;
}

interface SkillDecision {
  readonly round: number;
  readonly definition: TroopSkillDefinition;
  readonly levelValue: TroopSkillLevelValue | undefined;
  readonly runtimeBefore: TroopSkillRuntimeState;
  readonly runtimeAfter: TroopSkillRuntimeState;
  readonly probability: number | null;
  readonly rngRoll: number | null;
  readonly eligible: boolean;
  readonly triggered: boolean;
  readonly reason: string;
}

interface QueuedEffectApplication {
  readonly side: SideId;
  readonly sourceTroop: TroopType;
  readonly skillId: string;
  readonly effect: ActiveEffect;
}

export const IMPLEMENTED_TROOP_SKILL_TRIGGERS = [
  "passive",
  "roundStart",
  "beforeAttack",
  "beforeDamage",
  "afterNormalAttack",
] as const satisfies readonly TroopSkillTrigger[];

export function createTroopSkillSystem(
  config: TroopSkillSystemConfig,
): TroopSkillSystem {
  const definitions = new Map<string, TroopSkillDefinition>();
  for (const definition of config.definitions) {
    validateTroopSkillDefinition(definition);
    if (definitions.has(definition.id)) {
      throw new Error(`Duplicate troop skill definition: ${definition.id}.`);
    }
    definitions.set(definition.id, definition);
  }
  return {
    prepareRound(state): TroopSkillRoundPreparation {
      return prepareTroopSkillRound(state, definitions, config);
    },
  };
}

function prepareTroopSkillRound(
  initialState: BattleState,
  definitions: ReadonlyMap<string, TroopSkillDefinition>,
  config: TroopSkillSystemConfig,
): TroopSkillRoundPreparation {
  validateRuntimeBindings(initialState, definitions);
  let preparedState = advanceRuntimeCounters(initialState);
  const traces: TroopSkillTraceEntry[] = [];
  const recordTrace = config.recordTrace !== false;
  const runtimeUpdates = new Map<string, TroopSkillRuntimeState>();
  const queuedEffects: QueuedEffectApplication[] = [];
  const actionEffects = new Map<string, readonly ActiveEffect[]>();
  const defensiveEffectsByPrimaryEvent = new Map<string, readonly ActiveEffect[]>();
  const beforeAttackExtraDamageDecisions = new Map<string, SkillDecision[]>();
  const preDodgeDamageDecisions = new Map<string, SkillDecision[]>();

  const linkedExtraCoefficient = (
    sideId: SideId,
    troopType: TroopType,
    skillId: string,
  ): number => sideFromState(preparedState, sideId).troops[troopType].skillStates
    .filter((runtime) => runtime.enabled)
    .flatMap((runtime) => definitions.get(runtime.skillId)?.levelValues[runtime.level]?.effects ?? [])
    .filter((effect): effect is Extract<TroopSkillEffect, { readonly kind: "extraDamageContribution" }> =>
      effect.kind === "extraDamageContribution" && effect.linkedToSkillId === skillId)
    .reduce((sum, effect) => sum + effect.coefficient, 0);

  for (const trigger of ["passive", "roundStart"] as const) {
    for (const sideId of SIDE_IDS) {
      for (const troopType of TROOP_TYPES) {
        const skillStates = sideFromState(preparedState, sideId).troops[troopType]
          .skillStates;
        for (const runtime of skillStates) {
          const definition = definitions.get(runtime.skillId);
          if (definition?.trigger !== trigger || definition.troopType !== troopType) {
            continue;
          }
          if (definition.id === "marksman-blazing-star-t12") {
            const stacks = runtime.enabled ? Math.floor((preparedState.round - 1) / 5) : 0;
            const levelValue = definition.levelValues[runtime.level];
            const decision: SkillDecision = {
              round: preparedState.round,
              definition,
              levelValue,
              runtimeBefore: runtime,
              runtimeAfter: {
                ...runtime,
                stacks,
                triggerCount: stacks,
                ...(stacks > runtime.stacks ? { lastTriggeredRound: preparedState.round } : {}),
              },
              probability: null,
              rngRoll: null,
              eligible: runtime.enabled && levelValue !== undefined,
              triggered: stacks > runtime.stacks,
              reason: stacks > runtime.stacks
                ? "newPermanentStack"
                : stacks > 0 ? "existingPermanentStack" : "stackNotYetAvailable",
            };
            const effects = stacks > 0
              ? compileActiveEffects(decision, sideId, troopType, preparedState.round)
                  .map((effect) => ({ ...effect, stackCount: stacks }))
              : [];
            const lifecycleChanges: TroopSkillLifecycleChange[] = [];
            for (const effect of effects) {
              const applied = applyEffectToState(preparedState, sideId, troopType, definition.id, effect);
              preparedState = applied.state;
              lifecycleChanges.push(applied.change);
            }
            preparedState = setRuntimeState(preparedState, sideId, troopType, decision.runtimeAfter);
            if (recordTrace) traces.push({
              ...toTrace(decision, sideId, troopType, {
                producedActiveEffectIds: effects.map((effect) => effect.instanceId),
                producedDamageEventIds: [],
                targetingChanged: false,
                lifecycleChanges,
              }),
              currentStacks: stacks,
              currentBonus: stacks * 0.005 * runtime.level,
            });
            continue;
          }
          const decision = decideTrigger(
            definition,
            runtime,
            preparedState.round,
            sideId,
            troopType,
            config,
          );
          let effects: ActiveEffect[] = [];
          const appliedEffects: ActiveEffect[] = [];
          let lifecycleChanges: TroopSkillLifecycleChange[] = [];
          if (decision.triggered && decision.levelValue !== undefined) {
            effects = compileActiveEffects(
              decision,
              sideId,
              troopType,
              preparedState.round,
            );
            for (const effect of effects) {
              const applied = applyEffectToState(
                preparedState,
                sideId,
                troopType,
                definition.id,
                effect,
              );
              preparedState = applied.state;
              appliedEffects.push(applied.effect);
              lifecycleChanges = [...lifecycleChanges, applied.change];
            }
            preparedState = setRuntimeState(
              preparedState,
              sideId,
              troopType,
              withEffectRuntime(decision.runtimeAfter, appliedEffects),
            );
          }
          if (recordTrace) traces.push(
            toTrace(decision, sideId, troopType, {
              producedActiveEffectIds: effects.map((effect) => effect.instanceId),
              producedDamageEventIds: [],
              targetingChanged: effects.some(
                (effect) => effect.definition.kind === "targetingOverride",
              ),
              lifecycleChanges,
            }),
          );
        }
      }
    }
  }

  for (const sideId of SIDE_IDS) {
    for (const troopType of TROOP_TYPES) {
      for (const runtime of sideFromState(preparedState, sideId).troops[troopType]
        .skillStates) {
        const definition = definitions.get(runtime.skillId);
        if (
          definition === undefined ||
          (IMPLEMENTED_TROOP_SKILL_TRIGGERS as readonly TroopSkillTrigger[]).includes(
            definition.trigger,
          )
        ) {
          continue;
        }
        if (recordTrace) traces.push({
          round: preparedState.round,
          side: sideId,
          troop: troopType,
          skillId: definition.id,
          skillName: definition.name,
          uiSummary: getTroopSkillUiSummary(definition),
          level: runtime.level,
          skillVersion:
            definition.levelValues[runtime.level]?.versionLabel ?? `L${runtime.level}`,
          trigger: definition.trigger,
          checked: true,
          eligible: false,
          triggered: false,
          probability:
            definition.levelValues[runtime.level]?.probability ??
            definition.probability ??
            null,
          rngRoll: null,
          reason: "TRIGGER_RESERVED_NOT_IMPLEMENTED",
          producedActiveEffectIds: [],
          producedDamageEventIds: [],
          targetingChanged: false,
          lifecycleChanges: [],
        });
      }
    }
  }

  const currentRuntime = (
    sideId: SideId,
    troopType: TroopType,
    skillId: string,
  ): TroopSkillRuntimeState => {
    const key = runtimeKey(sideId, troopType, skillId);
    const updated = runtimeUpdates.get(key);
    if (updated !== undefined) return updated;
    const runtime = sideFromState(preparedState, sideId).troops[
      troopType
    ].skillStates.find((state) => state.skillId === skillId);
    if (runtime === undefined) {
      throw new Error(`Missing runtime state for troop skill ${key}.`);
    }
    return runtime;
  };

  const defenderCanDodge = (targetSide: SideId): boolean =>
    sideFromState(preparedState, targetSide).heroStates.some((hero) =>
      hero.skillStates.some((runtime) =>
        runtime.enabled && runtime.skillId === "hero-skill.lingnai.swift-shadow-dance"));

  const resolveActionTrigger = (
    trigger: TroopSkillTrigger,
    context: TargetingEffectContext | AdditionalDamageContext | MainAttackHitContext,
    include?: (definition: TroopSkillDefinition) => boolean,
  ): {
    readonly activeEffects: readonly ActiveEffect[];
    readonly damageInputs: readonly DamageEventInput[];
  } => {
    const sideId = context.action.side;
    const troopType = context.action.troop;
    const runtimeStates = sideFromState(preparedState, sideId).troops[troopType]
      .skillStates;
    const activeEffects: ActiveEffect[] = [];
    const damageInputs: DamageEventInput[] = [];
    for (const originalRuntime of runtimeStates) {
      const definition = definitions.get(originalRuntime.skillId);
      if (definition?.trigger !== trigger || definition.troopType !== troopType ||
        (include !== undefined && !include(definition))) {
        continue;
      }
      const runtime = currentRuntime(sideId, troopType, definition.id);
      const decision = decideTrigger(
        definition,
        runtime,
        preparedState.round,
        sideId,
        troopType,
        config,
      );
      const compiledEffects =
        decision.triggered && decision.levelValue !== undefined
          ? compileActiveEffects(decision, sideId, troopType, preparedState.round)
          : [];
      const parent = "primaryDamageEvent" in context
        ? context.primaryDamageEvent
        : undefined;
      const extras =
        decision.triggered && decision.levelValue !== undefined && parent !== undefined
          ? compileExtraDamageInputs(decision, parent, linkedExtraCoefficient(sideId, troopType, definition.id))
          : [];
      const sameMainAttackSegments =
        decision.triggered && decision.levelValue !== undefined && parent !== undefined
          ? compileSameMainAttackSegments(decision, parent)
          : [];
      if (
        trigger === "beforeAttack" &&
        parent === undefined &&
        decision.triggered &&
        decision.levelValue?.effects.some((effect) => effect.kind === "extraDamage")
      ) {
        const key = actionKey(sideId, troopType);
        beforeAttackExtraDamageDecisions.set(key, [
          ...(beforeAttackExtraDamageDecisions.get(key) ?? []),
          decision,
        ]);
      }
      if (trigger === "afterNormalAttack" && parent === undefined && decision.triggered) {
        const key = actionKey(sideId, troopType);
        preDodgeDamageDecisions.set(key, [
          ...(preDodgeDamageDecisions.get(key) ?? []), decision,
        ]);
      }
      for (const effect of compiledEffects) {
        activeEffects.push(effect);
        if (trigger !== "beforeAttack") {
          queuedEffects.push({
            side: sideId,
            sourceTroop: troopType,
            skillId: definition.id,
            effect,
          });
        }
      }
      damageInputs.push(...extras, ...sameMainAttackSegments);
      const nextRuntime = withEffectRuntime(decision.runtimeAfter, compiledEffects);
      runtimeUpdates.set(runtimeKey(sideId, troopType, definition.id), nextRuntime);
      if (recordTrace) traces.push(
        toTrace(decision, sideId, troopType, {
          producedActiveEffectIds: compiledEffects.map((effect) => effect.instanceId),
          producedDamageEventIds: [
            ...extras.map((event) => event.id),
            ...(parent === undefined ? [] : sameMainAttackSegments.map(() => parent.id)),
          ],
          targetingChanged: compiledEffects.some(
            (effect) => effect.definition.kind === "targetingOverride",
          ),
          lifecycleChanges: [],
          ...(parent === undefined ? {} : { parentEventId: parent.id }),
        }),
      );
    }
    return { activeEffects, damageInputs };
  };

  return {
    state: preparedState,
    targetingEffectProvider: {
      id: "troop-skill-targeting",
      beforeTargetSelection(context): readonly ActiveEffect[] {
        const dodgePossible = defenderCanDodge(otherSide(context.action.side));
        const effects = resolveActionTrigger("beforeAttack", context,
          (definition) => !dodgePossible || definition.id !== "lancer-crystal-spear").activeEffects;
        actionEffects.set(actionKey(context.action.side, context.action.troop), effects);
        return effects;
      },
    },
    damageEventEffectProvider: {
      id: "troop-skill-event-effects",
      beforeDamageEvent(context): readonly ActiveEffect[] {
        if (context.input.parentEventId !== undefined) {
          const prior = defensiveEffectsByPrimaryEvent.get(
            context.input.rootEventId ?? context.input.parentEventId,
          ) ?? [];
          if (context.input.sameMainAttackSegment === true) {
            // Rapid fire inherits the existing defensive result. Count Crystal's
            // additional effect use in reports only; never reroll or advance runtime.
            if (context.input.sourceSkillId === "marksman-rapid-fire" &&
              prior.some((effect) => effect.identity.sourceSkillId === "shield-crystal-shield" &&
                effect.definition.kind === "damageReduction")) {
              const rootId = context.input.rootEventId ?? context.input.parentEventId;
              if (recordTrace) {
                const traceIndex = traces.findIndex((trace) =>
                  trace.side === context.input.targetSide && trace.troop === context.input.targetTroop &&
                  trace.skillId === "shield-crystal-shield" && trace.parentEventId === rootId);
                if (traceIndex >= 0) {
                  const trace = traces[traceIndex]!;
                  traces[traceIndex] = { ...trace,
                    reportActivationCount: (trace.reportActivationCount ?? 1) + 1 };
                }
              }
              config.onReportActivation?.({
                side: context.input.targetSide, troop: context.input.targetTroop,
                skillId: "shield-crystal-shield", count: 1,
                inheritedFromRootEventId: rootId, damageEventId: context.input.id,
              });
            }
            return prior;
          }
          const outgoing = actionEffects.get(actionKey(context.action.side, context.action.troop)) ?? [];
          return [
            ...outgoing,
            ...resolveDefensiveEffects(context, preparedState, definitions, config,
              currentRuntime, runtimeUpdates, traces),
          ];
        }
        const outgoing = actionEffects.get(
          actionKey(context.action.side, context.action.troop),
        ) ?? [];
        const defensive = resolveDefensiveEffects(
          context,
          preparedState,
          definitions,
          config,
          currentRuntime,
          runtimeUpdates,
          traces,
        );
        if (context.input.damageType === "normalAttack" && (context.input.depth ?? 0) === 0) {
          defensiveEffectsByPrimaryEvent.set(context.input.id, defensive);
        }
        return [...outgoing, ...defensive];
      },
    },
    additionalDamageGenerator: {
      id: "troop-skill-extra-damage",
      runsAfterCancelledHit: true,
      beforeDodge(context): void {
        if (!defenderCanDodge(context.targetSide)) return;
        // Attack-attempt procs settle even when the normal hit is later dodged.
        resolveActionTrigger("afterNormalAttack", context);
      },
      afterNormalAttack(context): readonly DamageEventInput[] {
        const key = actionKey(context.action.side, context.action.troop);
        const deferred = beforeAttackExtraDamageDecisions.get(key) ?? [];
        beforeAttackExtraDamageDecisions.delete(key);
        const beforeAttackInputs = deferred.flatMap((decision) => {
          const inputs = compileExtraDamageInputs(
            decision,
            context.primaryDamageEvent,
            linkedExtraCoefficient(context.action.side, context.action.troop, decision.definition.id),
          );
          for (let index = traces.length - 1; index >= 0; index -= 1) {
            const trace = traces[index];
            if (
              trace?.side === context.action.side &&
              trace.troop === context.action.troop &&
              trace.skillId === decision.definition.id &&
              trace.triggered
            ) {
              traces[index] = {
                ...trace,
                producedDamageEventIds: inputs.map((input) => input.id),
                parentEventId: context.primaryDamageEvent.id,
              };
              break;
            }
          }
          return inputs;
        });
        const preDodgeInputs = (preDodgeDamageDecisions.get(key) ?? []).flatMap((decision) => {
          const inputs = [
            ...compileExtraDamageInputs(decision, context.primaryDamageEvent,
              linkedExtraCoefficient(context.action.side, context.action.troop, decision.definition.id)),
            ...compileSameMainAttackSegments(decision, context.primaryDamageEvent),
          ];
          if (recordTrace) {
            let traceIndex = -1;
            for (let index = traces.length - 1; index >= 0; index -= 1) {
              const trace = traces[index]!;
              if (trace.side === context.action.side &&
                trace.troop === context.action.troop &&
                trace.skillId === decision.definition.id && trace.triggered) {
                traceIndex = index;
                break;
              }
            }
            if (traceIndex >= 0) traces[traceIndex] = {
              ...traces[traceIndex]!,
              producedDamageEventIds: inputs.map((input) =>
                input.sameMainAttackSegment ? context.primaryDamageEvent.id : input.id),
              parentEventId: context.primaryDamageEvent.id,
            };
          }
          return inputs;
        });
        preDodgeDamageDecisions.delete(key);
        if (context.hitCancelled) return preDodgeInputs;
        const dodgePossible = defenderCanDodge(context.primaryDamageEvent.targetSide);
        return [
          ...beforeAttackInputs,
          ...preDodgeInputs,
          ...(dodgePossible
            ? resolveActionTrigger("beforeAttack", context,
                (definition) => definition.id === "lancer-crystal-spear").damageInputs
            : resolveActionTrigger("afterNormalAttack", context).damageInputs),
          ...compilePassiveExtraDamageInputs(preparedState, definitions, context),
        ];
      },
    },
    finalizeActionState(state): BattleState {
      let finalized = state;
      for (const application of queuedEffects) {
        const applied = applyEffectToState(
          finalized,
          application.side,
          application.sourceTroop,
          application.skillId,
          application.effect,
        );
        finalized = applied.state;
        const trace = recordTrace ? [...traces]
          .reverse()
          .find(
            (entry) =>
              entry.side === application.side &&
              entry.troop === application.sourceTroop &&
              entry.skillId === application.skillId &&
              entry.producedActiveEffectIds.includes(application.effect.instanceId),
          ) : undefined;
        if (trace !== undefined) {
          const index = traces.indexOf(trace);
          traces[index] = {
            ...trace,
            lifecycleChanges: [...trace.lifecycleChanges, applied.change],
          };
        }
        const nextRuntime = withEffectRuntime(
          runtimeUpdates.get(
            runtimeKey(
              application.side,
              application.sourceTroop,
              application.skillId,
            ),
          ) ?? currentRuntime(
            application.side,
            application.sourceTroop,
            application.skillId,
          ),
          [applied.effect],
        );
        runtimeUpdates.set(
          runtimeKey(
            application.side,
            application.sourceTroop,
            application.skillId,
          ),
          nextRuntime,
        );
      }
      for (const [key, runtime] of runtimeUpdates) {
        const [side, troop] = key.split(":") as [SideId, TroopType, string];
        finalized = setRuntimeState(finalized, side, troop, runtime);
      }
      return finalized;
    },
    getTraceEntries(): readonly TroopSkillTraceEntry[] {
      return traces;
    },
  };
}

function resolveDefensiveEffects(
  context: DamageEventEffectContext,
  state: BattleState,
  definitions: ReadonlyMap<string, TroopSkillDefinition>,
  config: TroopSkillSystemConfig,
  currentRuntime: (
    side: SideId,
    troop: TroopType,
    skillId: string,
  ) => TroopSkillRuntimeState,
  runtimeUpdates: Map<string, TroopSkillRuntimeState>,
  traces: TroopSkillTraceEntry[],
): readonly ActiveEffect[] {
  const sideId = context.input.targetSide;
  const troopType = context.input.targetTroop;
  const runtimeStates = sideFromState(state, sideId).troops[troopType]
    .skillStates;
  const output: ActiveEffect[] = [];
  for (const originalRuntime of runtimeStates) {
    const definition = definitions.get(originalRuntime.skillId);
    if (definition?.trigger !== "beforeDamage" || definition.troopType !== troopType) {
      continue;
    }
    // Each independent incoming DamageEvent gets its own defensive roll.
    // Rapid-fire's merged same-main-attack segment reuses the primary roll.
    if (context.input.sameMainAttackSegment === true) continue;
    const runtime = currentRuntime(sideId, troopType, definition.id);
    const decision = decideTrigger(
      definition,
      runtime,
      state.round,
      sideId,
      troopType,
      config,
    );
    const compiled = decision.triggered
      ? compileActiveEffects(decision, sideId, troopType, state.round)
      : [];
    const linkedReduction = decision.triggered && definition.id === "shield-crystal-shield"
      ? linkedDefensiveReduction(
          definition.id,
          runtimeStates,
          definitions,
        )
      : 0;
    const effects = compiled.map((effect) => effect.definition.kind === "damageReduction" && linkedReduction > 0
      ? { ...effect, definition: { ...effect.definition, value: effect.definition.value + linkedReduction } }
      : effect);
    output.push(...effects);
    runtimeUpdates.set(
      runtimeKey(sideId, troopType, definition.id),
      withEffectRuntime(decision.runtimeAfter, effects),
    );
    if (config.recordTrace !== false) traces.push(toTrace(decision, sideId, troopType, {
      producedActiveEffectIds: effects.map(
        (effect) => effect.instanceId,
      ),
      producedDamageEventIds: [],
      targetingChanged: false,
      lifecycleChanges: [],
      parentEventId: context.input.id,
    }));
  }
  return output;
}

function linkedDefensiveReduction(
  triggeredSkillId: string,
  runtimeStates: readonly TroopSkillRuntimeState[],
  definitions: ReadonlyMap<string, TroopSkillDefinition>,
): number {
  return runtimeStates.reduce((sum, runtime) => {
    if (!runtime.enabled) return sum;
    const definition = definitions.get(runtime.skillId);
    const levelValue = definition?.levelValues[runtime.level];
    if (levelValue === undefined) return sum;
    return sum + levelValue.effects.reduce((value, effect) =>
      value + (effect.kind === "damageReduction" && effect.linkedToSkillId === triggeredSkillId
        ? effect.value : 0), 0);
  }, 0);
}

function validateRuntimeBindings(
  state: BattleState,
  definitions: ReadonlyMap<string, TroopSkillDefinition>,
): void {
  for (const sideId of SIDE_IDS) {
    for (const troopType of TROOP_TYPES) {
      for (const runtime of sideFromState(state, sideId).troops[troopType]
        .skillStates) {
        const definition = definitions.get(runtime.skillId);
        if (definition === undefined) {
          throw new Error(`Missing troop skill definition: ${runtime.skillId}.`);
        }
        if (definition.troopType !== troopType) {
          throw new Error(
            `Troop skill ${definition.id} belongs to ${definition.troopType}, not ${troopType}.`,
          );
        }
      }
    }
  }
}

function decideTrigger(
  definition: TroopSkillDefinition,
  runtime: TroopSkillRuntimeState,
  round: number,
  side: SideId,
  troop: TroopType,
  config: TroopSkillSystemConfig,
): SkillDecision {
  const levelValue = definition.levelValues[runtime.level];
  const probability = levelValue?.probability ?? definition.probability ?? null;
  const base = {
    round,
    definition,
    levelValue,
    runtimeBefore: runtime,
    probability,
    rngRoll: null,
  } as const;
  const report = (decision: SkillDecision): SkillDecision => {
    if (decision.eligible && decision.probability !== null) {
      config.onProbabilityDecision?.({
        side,
        skillId: definition.id,
        probability: decision.probability,
        triggered: decision.triggered,
      });
    }
    return decision;
  };
  if (!runtime.enabled) return noTrigger(base, runtime, "disabled");
  if (levelValue === undefined) return noTrigger(base, runtime, "levelValueMissing");
  if (definition.trigger === "passive" && runtime.triggerCount > 0) {
    return noTrigger(base, runtime, "passiveAlreadyAttached");
  }
  if (runtime.cooldown > 0) return noTrigger(base, runtime, "cooldown");
  if (
    levelValue.periodRounds !== undefined &&
    levelValue.periodStartRound !== undefined &&
    (round < levelValue.periodStartRound ||
      (round - levelValue.periodStartRound) % levelValue.periodRounds !== 0)
  ) {
    return noTrigger(base, runtime, "periodNotDue");
  }
  const override = lookupTriggerOverride(config.triggerOverrides, side, troop, definition.id);
  if (override !== undefined) {
    return report(finishDecision(base, runtime, round, override, null, override ? "forcedTrigger" : "forcedNoTrigger"));
  }
  if (
    definition.metadata.ruleStatus === "RULE_UNKNOWN" ||
    definition.metadata.requiresExplicitTriggerOverride === true
  ) {
    return noTrigger(base, runtime, "RULE_UNKNOWN_requiresExplicitOverride");
  }
  if (probability === null) {
    return report(finishDecision(base, runtime, round, true, null, "deterministic"));
  }
  if (config.randomSource === undefined) {
    throw new Error(`Troop skill ${definition.id} needs an injected RandomSource.`);
  }
  const roll = config.randomSource.next();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError("RandomSource.next() must return a value in [0, 1).");
  }
  const triggered = roll < probability;
  return report(finishDecision(
    base,
    runtime,
    round,
    triggered,
    roll,
    triggered ? "probabilityPassed" : "probabilityFailed",
  ));
}

function noTrigger(
  base: Omit<SkillDecision, "runtimeAfter" | "eligible" | "triggered" | "reason">,
  runtime: TroopSkillRuntimeState,
  reason: string,
): SkillDecision {
  return {
    ...base,
    runtimeAfter: runtime,
    eligible: false,
    triggered: false,
    reason,
  };
}

function finishDecision(
  base: Omit<SkillDecision, "runtimeAfter" | "eligible" | "triggered" | "reason">,
  runtime: TroopSkillRuntimeState,
  round: number,
  triggered: boolean,
  rngRoll: number | null,
  reason: string,
): SkillDecision {
  if (!triggered) {
    return { ...base, rngRoll, runtimeAfter: runtime, eligible: true, triggered, reason };
  }
  const levelValue = base.levelValue;
  const cooldown = levelValue?.cooldownRounds ?? base.definition.cooldownRounds ?? 0;
  const duration = levelValue?.durationRounds ?? base.definition.durationRounds ?? 0;
  return {
    ...base,
    rngRoll,
    runtimeAfter: {
      ...runtime,
      remainingDuration: duration,
      // +1 means cooldown=1 skips one complete later round.
      cooldown: cooldown === 0 ? 0 : cooldown + 1,
      lastTriggeredRound: round,
      triggerCount: runtime.triggerCount + 1,
    },
    eligible: true,
    triggered,
    reason,
  };
}

function compileActiveEffects(
  decision: SkillDecision,
  side: SideId,
  troop: TroopType,
  round: number,
): ActiveEffect[] {
  const levelValue = decision.levelValue;
  if (levelValue === undefined) return [];
  return levelValue.effects.flatMap((effect) => {
    if (
      effect.kind === "extraDamage" ||
      effect.kind === "sameMainAttackSegment" ||
      effect.kind === "extraDamageContribution" ||
      ("linkedToSkillId" in effect && effect.linkedToSkillId !== undefined)
    ) return [];
    const definition = toActiveEffectDefinition(
      effect,
      decision.definition,
      levelValue,
      troop,
    );
    return [
      createActiveEffect({
        identity: {
          sourceId: `troop:${side}:${troop}`,
          sourceSkillId: decision.definition.id,
          effectId: effect.id,
        },
        definition,
        appliedRound: round,
        holderScope: resolveHolderScope(effect, troop),
      }),
    ];
  });
}

function toActiveEffectDefinition(
  effect: Exclude<
    TroopSkillEffect,
    { readonly kind: "extraDamage" | "sameMainAttackSegment" | "extraDamageContribution" }
  >,
  skill: TroopSkillDefinition,
  level: TroopSkillLevelValue,
  sourceTroop: TroopType,
): EffectDefinition {
  const scope = toEffectScope(effect, sourceTroop);
  const lifecycle = mergeLifecycle(
    effect.lifecycle,
    level.durationRounds ?? skill.durationRounds,
  );
  const common = {
    id: effect.id,
    name: effect.name,
    ruleStatus: "supported" as const,
    ...(scope === undefined ? {} : { scope }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
  };
  if (effect.kind === "targetingOverride") {
    return { ...common, kind: effect.kind, priority: effect.priority };
  }
  if (effect.kind === "attributeModifier") {
    return {
      ...common,
      kind: effect.kind,
      attribute: effect.attribute,
      operation: effect.operation,
      group: effect.group,
      value: effect.value,
    };
  }
  return {
    ...common,
    kind: effect.kind,
    group: effect.group,
    value: effect.value,
  };
}

function toEffectScope(
  effect: Exclude<
    TroopSkillEffect,
    { readonly kind: "extraDamage" | "sameMainAttackSegment" | "extraDamageContribution" }
  >,
  sourceTroop: TroopType,
): EffectScope | undefined {
  const source = effect.scope.source;
  const target = effect.scope.target;
  const damageType = effect.scope.damageType;
  const defensive =
    effect.kind === "damageReduction" ||
    effect.kind === "baseDefenseMultiplier" ||
    effect.kind === "defenseModifier" ||
    effect.kind === "directDamageCancellation";
  if (effect.kind === "attributeModifier" &&
      effect.attribute === "defense" &&
      effect.scope.incomingSourceTroop !== undefined) {
    return {
      sourceTroops: [sourceTroop],
      targetTroops: [effect.scope.incomingSourceTroop],
      ...(damageType === undefined || damageType === "all"
        ? {} : { damageTypes: [damageType] }),
    };
  }
  const sourceTroops = defensive
    ? effect.scope.incomingSourceTroop === undefined
      ? undefined
      : [effect.scope.incomingSourceTroop] as const
    : source === "army"
      ? undefined
      : [source === "self" ? sourceTroop : source] as const;
  const targetTroops =
    target === undefined || target === "all" || target === "currentTarget"
      ? undefined
      : [target] as const;
  const damageTypes =
    damageType === undefined || damageType === "all"
      ? undefined
      : [damageType] as const;
  if (sourceTroops === undefined && targetTroops === undefined && damageTypes === undefined) {
    return undefined;
  }
  return {
    ...(sourceTroops === undefined ? {} : { sourceTroops }),
    ...(targetTroops === undefined ? {} : { targetTroops }),
    ...(damageTypes === undefined ? {} : { damageTypes }),
  };
}

function resolveHolderScope(
  effect: TroopSkillEffect,
  sourceTroop: TroopType,
): "army" | TroopType {
  return effect.scope.source === "army"
    ? "army"
    : effect.scope.source === "self"
      ? sourceTroop
      : effect.scope.source;
}

function mergeLifecycle(
  lifecycle: EffectLifecycle | undefined,
  defaultDuration: number | undefined,
): EffectLifecycle | undefined {
  if (lifecycle === undefined && defaultDuration === undefined) return undefined;
  return {
    ...(lifecycle ?? {}),
    ...(lifecycle?.durationRounds !== undefined
      ? {}
      : defaultDuration === undefined
        ? {}
        : { durationRounds: defaultDuration }),
  };
}

function compileExtraDamageInputs(
  decision: SkillDecision,
  parent: AdditionalDamageContext["primaryDamageEvent"],
  linkedCoefficient = 0,
): DamageEventInput[] {
  if (decision.levelValue === undefined) return [];
  return decision.levelValue.effects.flatMap((effect, index) => {
    if (effect.kind !== "extraDamage") return [];
    if (!matchesExtraDamageScope(effect, parent, decision.definition.troopType)) {
      return [];
    }
    const basis =
      effect.basis === "parentBaseDamage"
        ? parent.baseDamage
        : effect.basis === "parentRawDamage"
          ? parent.rawDamage
          : effect.basis === "parentModifiedDamage"
            ? parent.modifiedDamage
            : parent.finalDamage;
    return [{
      id: `${parent.id}:skill:${decision.definition.id}:effect:${effect.id}:${index}`,
      sourceSide: parent.sourceSide,
      sourceTroop: parent.sourceTroop,
      targetSide: parent.targetSide,
      targetTroop: parent.targetTroop,
      damageType: "skillDamage" as const,
      damageSubtype: "extraDamage" as const,
      baseDamage: basis * (effect.coefficient + linkedCoefficient),
      skillCoefficient: effect.coefficient + linkedCoefficient,
      damageBasis: effect.basis,
      sourceSkillId: decision.definition.id,
      parentEventId: parent.id,
      rootEventId: parent.rootEventId,
      depth: parent.depth + 1,
      round: parent.round,
      actionOrder: parent.actionOrder,
    }];
  });
}

function compilePassiveExtraDamageInputs(
  state: BattleState,
  definitions: ReadonlyMap<string, TroopSkillDefinition>,
  context: AdditionalDamageContext,
): DamageEventInput[] {
  const side = sideFromState(state, context.action.side);
  const parent = context.primaryDamageEvent;
  const output: DamageEventInput[] = [];
  for (const ownerTroop of TROOP_TYPES) {
    for (const runtime of side.troops[ownerTroop].skillStates) {
      if (!runtime.enabled) continue;
      const definition = definitions.get(runtime.skillId);
      const level = definition?.levelValues[runtime.level];
      if (definition?.trigger !== "passive" || level === undefined) continue;
      level.effects.forEach((effect, index) => {
        if (effect.kind !== "extraDamage") return;
        const activeRounds = effect.lifecycle?.activeRounds;
        if (activeRounds !== undefined && !activeRounds.includes(state.round)) return;
        if (!matchesExtraDamageScope(effect, parent, definition.troopType)) return;
        const basis = effect.basis === "parentBaseDamage"
          ? parent.baseDamage
          : effect.basis === "parentRawDamage"
            ? parent.rawDamage
            : effect.basis === "parentModifiedDamage"
              ? parent.modifiedDamage
              : parent.finalDamage;
        output.push({
          id: `${parent.id}:passive:${definition.id}:effect:${effect.id}:${index}`,
          sourceSide: parent.sourceSide,
          sourceTroop: parent.sourceTroop,
          targetSide: parent.targetSide,
          targetTroop: parent.targetTroop,
          damageType: "skillDamage",
          damageSubtype: "extraDamage",
          baseDamage: basis * effect.coefficient,
          skillCoefficient: effect.coefficient,
          damageBasis: effect.basis,
          sourceSkillId: definition.id,
          parentEventId: parent.id,
          rootEventId: parent.rootEventId,
          depth: parent.depth + 1,
          round: parent.round,
          actionOrder: parent.actionOrder,
        });
      });
    }
  }
  return output;
}

function compileSameMainAttackSegments(
  decision: SkillDecision,
  parent: AdditionalDamageContext["primaryDamageEvent"],
): DamageEventInput[] {
  if (decision.levelValue === undefined) return [];
  return decision.levelValue.effects.flatMap((effect, index) => {
    if (effect.kind !== "sameMainAttackSegment") return [];
    return [{
      id: `${parent.id}:skill:${decision.definition.id}:internal-segment:${index}`,
      sourceSide: parent.sourceSide,
      sourceTroop: parent.sourceTroop,
      targetSide: parent.targetSide,
      targetTroop: parent.targetTroop,
      damageType: "normalAttack" as const,
      damageSubtype: "normalAttack" as const,
      sameMainAttackSegment: true,
      baseDamage: parent.baseDamage * effect.damageScale,
      baseDamageAttributeEffects: parent.baseDamageAttributeEffects,
      ...(parent.baseDamageFormula === undefined
        ? {}
        : { baseDamageFormula: parent.baseDamageFormula }),
      sourceSkillId: decision.definition.id,
      parentEventId: parent.id,
      rootEventId: parent.rootEventId,
      depth: parent.depth + 1,
      round: parent.round,
      actionOrder: parent.actionOrder,
    }];
  });
}

function matchesExtraDamageScope(
  effect: Extract<TroopSkillEffect, { readonly kind: "extraDamage" }>,
  parent: AdditionalDamageContext["primaryDamageEvent"],
  skillTroop: TroopType,
): boolean {
  const source = effect.scope.source;
  const sourceMatches =
    source === "army" ||
    (source === "self" ? parent.sourceTroop === skillTroop : parent.sourceTroop === source);
  const target = effect.scope.target;
  const targetMatches =
    target === undefined ||
    target === "all" ||
    target === "currentTarget" ||
    parent.targetTroop === target;
  const damageType = effect.scope.damageType;
  const damageTypeMatches =
    damageType === undefined || damageType === "all" || damageType === "skillDamage";
  return sourceMatches && targetMatches && damageTypeMatches;
}

function applyEffectToState(
  state: BattleState,
  sideId: SideId,
  sourceTroop: TroopType,
  skillId: string,
  incoming: ActiveEffect,
): { readonly state: BattleState; readonly effect: ActiveEffect; readonly change: TroopSkillLifecycleChange } {
  const side = sideFromState(state, sideId);
  const sourceScope = getDefinitionSourceScope(incoming, sourceTroop);
  const previousEffects =
    sourceScope === "army"
      ? side.armyEffects
      : side.troops[sourceScope].buffs;
  const previous = previousEffects.find(
    (effect) => effect.instanceId === incoming.instanceId,
  );
  const nextEffects = upsertActiveEffect(previousEffects, incoming);
  const next = nextEffects.find((effect) => effect.instanceId === incoming.instanceId)!;
  const mode = previous === undefined
    ? "create"
    : incoming.definition.lifecycle?.refreshMode ?? "replace";
  const change: TroopSkillLifecycleChange = {
    effectId: incoming.definition.id,
    mode,
    previousStacks: previous?.stackCount ?? 0,
    nextStacks: next.stackCount,
    ...(previous?.remainingRounds === undefined
      ? {}
      : { previousRemainingRounds: previous.remainingRounds }),
    ...(next.remainingRounds === undefined
      ? {}
      : { nextRemainingRounds: next.remainingRounds }),
  };
  let nextSide: BattleSide;
  if (sourceScope === "army") {
    nextSide = { ...side, armyEffects: nextEffects };
  } else {
    nextSide = replaceTroop(side, sourceScope, {
      ...side.troops[sourceScope],
      buffs: nextEffects,
    });
  }
  return {
    state: replaceSide(state, sideId, nextSide),
    effect: next,
    change,
  };
}

function getDefinitionSourceScope(
  effect: ActiveEffect,
  sourceTroop: TroopType,
): "army" | TroopType {
  if (effect.holderScope !== undefined) return effect.holderScope;
  const sourceTroops = effect.definition.scope?.sourceTroops;
  if (sourceTroops === undefined) return "army";
  return sourceTroops[0] ?? sourceTroop;
}

function setRuntimeState(
  state: BattleState,
  sideId: SideId,
  troopType: TroopType,
  runtime: TroopSkillRuntimeState,
): BattleState {
  const side = sideFromState(state, sideId);
  const troop = side.troops[troopType];
  const index = troop.skillStates.findIndex(
    (candidate) => candidate.skillId === runtime.skillId,
  );
  if (index < 0) throw new Error(`Missing runtime state for ${runtime.skillId}.`);
  const skillStates = troop.skillStates.map((candidate, candidateIndex) =>
    candidateIndex === index ? runtime : candidate,
  );
  return replaceSide(
    state,
    sideId,
    replaceTroop(side, troopType, { ...troop, skillStates }),
  );
}

function advanceRuntimeCounters(state: BattleState): BattleState {
  let result = state;
  for (const sideId of SIDE_IDS) {
    let side = sideFromState(result, sideId);
    for (const troopType of TROOP_TYPES) {
      const troop = side.troops[troopType];
      const skillStates = troop.skillStates.map((runtime) => ({
        ...runtime,
        remainingDuration: Math.max(0, runtime.remainingDuration - 1),
        cooldown: Math.max(0, runtime.cooldown - 1),
      }));
      side = replaceTroop(side, troopType, { ...troop, skillStates });
    }
    result = replaceSide(result, sideId, side);
  }
  return result;
}

function withEffectRuntime(
  runtime: TroopSkillRuntimeState,
  effects: readonly ActiveEffect[],
): TroopSkillRuntimeState {
  return {
    ...runtime,
    stacks: effects.reduce(
      (maximum, effect) => Math.max(maximum, effect.stackCount),
      runtime.stacks,
    ),
    remainingDuration: effects.reduce(
      (maximum, effect) => Math.max(maximum, effect.remainingRounds ?? 0),
      runtime.remainingDuration,
    ),
  };
}

function toTrace(
  decision: SkillDecision,
  side: SideId,
  troop: TroopType,
  output: Pick<
    TroopSkillTraceEntry,
    | "producedActiveEffectIds"
    | "producedDamageEventIds"
    | "targetingChanged"
    | "lifecycleChanges"
    | "parentEventId"
  >,
): TroopSkillTraceEntry {
  return {
    round: decision.round,
    side,
    troop,
    skillId: decision.definition.id,
    skillName: decision.definition.name,
    uiSummary: getTroopSkillUiSummary(decision.definition),
    level: decision.runtimeBefore.level,
    skillVersion:
      decision.levelValue?.versionLabel ?? `L${decision.runtimeBefore.level}`,
    trigger: decision.definition.trigger,
    checked: true,
    eligible: decision.eligible,
    triggered: decision.triggered,
    probability: decision.probability,
    rngRoll: decision.rngRoll,
    reason: decision.reason,
    producedActiveEffectIds: output.producedActiveEffectIds,
    producedDamageEventIds: output.producedDamageEventIds,
    targetingChanged: output.targetingChanged,
    lifecycleChanges: output.lifecycleChanges,
    ...(decision.definition.id === "shield-crystal-shield"
      ? { reportActivationCount: decision.triggered ? 1 : 0 } : {}),
    ...(output.parentEventId === undefined
      ? {}
      : { parentEventId: output.parentEventId }),
  };
}

function actionKey(side: SideId, troop: TroopType): string {
  return `${side}:${troop}`;
}

function lookupTriggerOverride(
  overrides: TroopSkillTriggerOverrides | undefined,
  side: SideId,
  troop: TroopType,
  skillId: string,
): boolean | undefined {
  if (overrides === undefined) return undefined;
  for (const key of [`${side}:${troop}:${skillId}`, `${side}:${skillId}`, skillId]) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
  }
  return undefined;
}

function runtimeKey(side: SideId, troop: TroopType, skillId: string): string {
  return `${side}:${troop}:${skillId}`;
}

function replaceSide(
  state: BattleState,
  sideId: SideId,
  side: BattleSide,
): BattleState {
  return sideId === "A" ? { ...state, sideA: side } : { ...state, sideB: side };
}
