import { heroDefinitionId, heroRuntimeId } from "./identity";
import { targetMarkDamageCoefficient } from "./targetMarkStacking";
import { replaceTroop } from "../battle/createBattleState";
import { calculateBaseTroopDamage } from "../formulas/damage";
import { getHeroSkillUiSummary } from "../skillPresentation";
import {
  createActiveEffect,
  isEffectActiveInRound,
  resolveTroopAttribute,
  upsertActiveEffect,
} from "../effects";
import type {
  AdditionalDamageContext,
  AdditionalDamageGenerator,
  DamageEventEffectProvider,
  MainAttackLifecycleProvider,
  TargetingEffectProvider,
} from "../round/actionPhase";
import type { DamageEventInput } from "../types/damage";
import {
  isBattleContextAllowedForSide,
  otherSide,
  SIDE_IDS,
  TROOP_TYPES,
  type SideId,
  type TroopType,
} from "../types/combat";
import {
  sideFromState,
  type BattleSide,
  type BattleState,
} from "../types/battle";
import type {
  ActiveEffect,
  EffectDefinition,
  EffectLifecycle,
  EffectScope,
} from "../types/effect";
import type { TemporaryShieldLayer } from "../types/troop";
import { calculateGatotShield } from "./gatotShield";
import type { RandomSource } from "../troopSkills";
import {
  DEFAULT_HERO_POSITION_ACTIVATION_POLICY,
} from "./loadout";
import {
  validateHeroSkillDefinition,
  validateHeroSkillRuntimeState,
} from "./runtime";
import type {
  HeroPositionActivationPolicy,
  HeroSkillDefinition,
  HeroSkillEffect,
  HeroSkillLevelValue,
  HeroSkillRuntimeState,
  HeroSkillTraceEntry,
  HeroSkillTriggerOverrides,
  HeroState,
} from "./types";

export interface HeroSkillSystemConfig {
  readonly definitions: readonly HeroSkillDefinition[];
  readonly randomSource?: RandomSource;
  readonly triggerOverrides?: HeroSkillTriggerOverrides;
  readonly positionPolicy?: HeroPositionActivationPolicy;
  readonly recordTrace?: boolean;
  readonly onProbabilityDecision?: (decision: {
    readonly side: SideId;
    readonly skillId: string;
    readonly probability: number;
    readonly triggered: boolean;
  }) => void;
}

export interface HeroSkillRoundPreparation {
  readonly state: BattleState;
  readonly targetingEffectProvider: TargetingEffectProvider;
  readonly additionalDamageGenerator: AdditionalDamageGenerator;
  readonly damageEventEffectProvider: DamageEventEffectProvider;
  readonly mainAttackLifecycleProvider: MainAttackLifecycleProvider;
  readonly finalizeActionState: (state: BattleState) => BattleState;
  readonly getTraceEntries: () => readonly HeroSkillTraceEntry[];
}

export interface HeroSkillSystem {
  readonly prepareRound: (state: BattleState) => HeroSkillRoundPreparation;
}

interface HeroDecision {
  readonly definition: HeroSkillDefinition;
  readonly levelValue: HeroSkillLevelValue | undefined;
  readonly runtimeBefore: HeroSkillRuntimeState;
  readonly runtimeAfter: HeroSkillRuntimeState;
  readonly probability: number | null;
  readonly rngRoll: number | null;
  readonly eligible: boolean;
  readonly triggered: boolean;
  readonly reason: string;
}

export function createHeroSkillSystem(
  config: HeroSkillSystemConfig,
): HeroSkillSystem {
  const definitions = new Map<string, HeroSkillDefinition>();
  for (const definition of config.definitions) {
    validateHeroSkillDefinition(definition);
    if (definitions.has(definition.id)) {
      throw new Error(`Duplicate hero skill definition: ${definition.id}.`);
    }
    definitions.set(definition.id, definition);
  }
  return {
    prepareRound(state): HeroSkillRoundPreparation {
      return prepareHeroSkillRound(state, definitions, config);
    },
  };
}

function prepareHeroSkillRound(
  initialState: BattleState,
  definitions: ReadonlyMap<string, HeroSkillDefinition>,
  config: HeroSkillSystemConfig,
): HeroSkillRoundPreparation {
  const policy = config.positionPolicy ?? DEFAULT_HERO_POSITION_ACTIVATION_POLICY;
  validateRuntimeBindings(initialState, definitions, policy);
  let state = initialState;
  const traces: HeroSkillTraceEntry[] = [];
  const hpChangedSides = new Set<SideId>();
  const runtimeUpdates = new Map<string, HeroSkillRuntimeState>();
  const actionEffects = new Map<string, readonly ActiveEffect[]>();
  const beforeAttackExtraDamage = new Map<string, HeroDecision[]>();
  const preDodgeShadowBlade = new Map<string, HeroDecision[]>();
  const preDodgeDemolitionSquad = new Map<string, HeroDecision[]>();
  const preDodgeFlankingStrike = new Map<string, HeroDecision[]>();
  const attackAttemptDecisions = new Map<string, HeroDecision[]>();
  const hitTargetDebuffs = new Map<string, readonly ActiveEffect[]>();
  const oneUseOriginRoot = new Map<string, string>();
  const queuedArmyEffects = new Map<SideId, readonly ActiveEffect[]>();
  const temporaryShieldUpdates = new Map<string, readonly TemporaryShieldLayer[]>();
  const consumedOneUseEffects = new Map<string, Set<string>>();
  const defenderCanDodge = (targetSide: SideId): boolean =>
    sideFromState(state, targetSide).heroStates.some((hero) =>
      hero.skillStates.some((runtime) =>
        runtime.enabled && runtime.skillId === "hero-skill.lingnai.swift-shadow-dance"));

  for (const sideId of SIDE_IDS) {
    const heroes = [...sideFromState(state, sideId).heroStates];
    for (let heroIndex = 0; heroIndex < heroes.length; heroIndex += 1) {
      const hero = heroes[heroIndex]!;
      const nextSkillStates: HeroSkillRuntimeState[] = [];
      for (const runtime of hero.skillStates) {
        const definition = definitions.get(runtime.skillId)!;
        if (definition.trigger !== "passive" && definition.trigger !== "roundStart") {
          nextSkillStates.push(runtime);
          if (
            definition.actionMechanic === undefined &&
            definition.trigger !== "beforeAttack" &&
            definition.trigger !== "afterNormalAttack"
          ) {
            if (config.recordTrace !== false) traces.push(toReservedTrace(state.round, sideId, hero, definition, runtime));
          }
          continue;
        }
        const decision = decideTrigger(
          state.round,
          sideId,
          definition,
          runtime,
          config,
          state.battleContext,
        );
        const activeEffects = decision.triggered && decision.levelValue !== undefined
          ? compileActiveEffects(decision, sideId, hero, state.round)
          : [];
        for (let effectIndex = 0; effectIndex < activeEffects.length; effectIndex += 1) {
          const sourceEffect = decision.levelValue!.effects.filter(
            isCompilableActiveEffect,
          )[effectIndex];
          if (sourceEffect === undefined) continue;
          state = applyEffectToRecipient(state, sideId, sourceEffect.recipient, activeEffects[effectIndex]!);
          if (
            sourceEffect.kind === "attributeModifier" &&
            sourceEffect.attribute === "life"
          ) {
            hpChangedSides.add(sideId);
          }
        }
        nextSkillStates.push(decision.runtimeAfter);
        if (config.recordTrace !== false && definition.id !== "hero-skill.weien.thunder-raid") {
          traces.push(toTrace(state.round, sideId, hero, decision, activeEffects));
        }
      }
      heroes[heroIndex] = { ...hero, skillStates: nextSkillStates };
      state = replaceHeroStates(state, sideId, heroes);
    }
  }

  for (const sideId of hpChangedSides) {
    if (state.round !== 1) {
      throw new Error("Hero HP attribute modifiers are prebattle-only and cannot rebase damaged stacks.");
    }
    state = applyPrebattleHpModifiers(state, sideId);
  }

  return {
    state,
    mainAttackLifecycleProvider: {
      id: "hero-skill-main-attack-lifecycle",
      beforeMainAttack(context) {
        let skipped = false;
        const side = sideFromState(state, context.action.side);
        const stun = side.troops[context.action.troop].debuffs.find(
          (effect) =>
            effect.definition.kind === "skipNextRoundAction" &&
            isEffectActiveInRound(effect, state.round),
        );
        if (stun !== undefined) {
          if (config.recordTrace !== false) appendSkippedActionTrace(
            traces,
            state,
            definitions,
            stun,
            context.action.side,
            context.action.troop,
          );
          return { skip: true, reason: "skipNextRoundAction" };
        }
        for (const hero of side.heroStates) {
          for (const originalRuntime of hero.skillStates) {
            const definition = definitions.get(originalRuntime.skillId);
            const mechanic = definition?.actionMechanic;
            if (
              definition === undefined || mechanic?.kind !== "skipMainAttack" ||
              mechanic.sourceTroop !== context.action.troop
            ) continue;
            const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
            const runtime = runtimeUpdates.get(key) ?? originalRuntime;
            const attackCountBefore = runtime.mainAttackCounts[context.action.troop];
            const due = attackCountBefore > 0 &&
              attackCountBefore ===
                (runtime.triggerCount + 1) * mechanic.afterCompletedAttacks;
            if (!due) continue;
            const decision = decideTrigger(
              state.round,
              context.action.side,
              definition,
              runtime,
              config,
              state.battleContext,
              context.action.troop,
            );
            if (!decision.triggered) continue;
            const effects = compileActiveEffects(
              decision,
              context.action.side,
              hero,
              state.round,
              context.action.troop,
            );
            for (const effect of effects) {
              queueArmyEffect(queuedArmyEffects, context.action.side, effect);
            }
            runtimeUpdates.set(key, decision.runtimeAfter);
            if (config.recordTrace !== false) traces.push({
              ...toTrace(
                state.round,
                context.action.side,
                hero,
                decision,
                effects,
                context.action.troop,
              ),
              attackCountBefore,
              attackCountAfter: attackCountBefore,
              skippedMainAttack: true,
              ...(effects[0]?.definition.lifecycle?.durationRounds === undefined
                ? {}
                : {
                    durationRemaining:
                      effects[0].definition.lifecycle.durationRounds,
                  }),
            });
            skipped = true;
          }
        }
        return { skip: skipped, ...(skipped ? { reason: "heroSkipMainAttack" } : {}) };
      },
      beforeDodge(context) {
        const side = sideFromState(state, context.action.side);
        for (const hero of side.heroStates) {
          for (const originalRuntime of hero.skillStates) {
            const definition = definitions.get(originalRuntime.skillId);
            if (definition?.triggerTiming === "mainAttackAttempt") {
              const mechanic = definition.actionMechanic;
              if (mechanic !== undefined && mechanic.kind !== "attackCountTrigger" &&
                mechanic.kind !== "naturalRoundTrigger") continue;
              if (mechanic?.kind === "attackCountTrigger" &&
                mechanic.schedule.source !== "army" &&
                mechanic.schedule.source !== context.action.troop) continue;
              if (mechanic?.kind === "naturalRoundTrigger" &&
                mechanic.source !== context.action.troop) continue;
              const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
              const counted = mechanic?.kind === "attackCountTrigger"
                ? incrementMainAttackCount(runtimeUpdates.get(key) ?? originalRuntime,
                    context.action.troop)
                : runtimeUpdates.get(key) ?? originalRuntime;
              const scheduled = decideAfterNormalTrigger(
                state.round, context.action.side, definition, counted, config,
                state.battleContext, context.action.troop,
              );
              runtimeUpdates.set(key, scheduled.decision.runtimeAfter);
              const action = actionKey(context.action.side, context.action.troop);
              if (scheduled.decision.triggered) {
                attackAttemptDecisions.set(action, [
                  ...(attackAttemptDecisions.get(action) ?? []), scheduled.decision,
                ]);
              }
              const applications = scheduled.decision.triggered
                ? compileAfterNormalActiveEffects(
                    scheduled.decision, context.action.side, hero, state.round,
                    context.targetSide, context.targetTroop, definitions, side,
                  ) : [];
              const refreshedExistingState = applications.some((application) =>
                application.targetTroop !== undefined && [
                  ...sideFromState(state, application.side)
                    .troops[application.targetTroop].debuffs,
                  ...(hitTargetDebuffs.get(hitTargetKey(
                    application.side, application.targetTroop,
                  )) ?? []),
                ].some((existing) => existing.instanceId === application.effect.instanceId &&
                  isEffectActiveInRound(existing, state.round)),
              );
              for (const application of applications) {
                if (application.targetTroop === undefined) {
                  queueArmyEffect(queuedArmyEffects, application.side, application.effect);
                } else {
                  upsertHitTargetDebuff(hitTargetDebuffs, application.side,
                    application.targetTroop, application.effect);
                }
              }
              if (config.recordTrace !== false) traces.push({
                ...toTrace(state.round, context.action.side, hero,
                  scheduled.decision, applications.map((item) => item.effect),
                  context.action.troop),
                targetTroop: context.targetTroop,
                mainAttackAttempted: true,
                ...(scheduled.attackCountAfter === undefined ? {} : {
                  mainAttackAttemptCount: scheduled.attackCountAfter,
                  attackCountBefore: scheduled.attackCountBefore!,
                  attackCountAfter: scheduled.attackCountAfter,
                }),
                ...(definition.id === "hero-skill.magenusi.steel-phalanx" ? {
                  steelPhalanxEligible: scheduled.decision.eligible,
                  steelPhalanxRoll: scheduled.decision.rngRoll,
                  steelPhalanxTriggered: scheduled.decision.triggered,
                  defenseBuffActivationRound: state.round,
                  defenseBuffCurrentRoundOnly: true,
                  defenseBuffActivation: "immediateCurrentRound" as const,
                } : {}),
                ...(definition.id === "hero-skill.fuleide.tidal-offensive" ? {
                  lancerAttackAttemptCount: scheduled.attackCountAfter!,
                  tidalOffensiveTriggered: scheduled.decision.triggered,
                  nextRoundOutgoingReductionScheduled: scheduled.decision.triggered,
                  ...(scheduled.decision.triggered ? { effectiveFromRound: state.round + 1 } : {}),
                } : {}),
                ...(definition.id === "hero-skill.xiula.piercing-arrow" ? {
                  marksmanAttackAttemptCount: scheduled.attackCountAfter!,
                  piercingArrowTriggered: scheduled.decision.triggered,
                  vulnerabilityTarget: context.targetTroop,
                  ...(scheduled.decision.triggered ? {
                    vulnerabilityActivationRound: state.round + 1,
                  } : {}),
                } : {}),
                ...(definition.id === "hero-skill.blanchette.crimson-burst" ? {
                  crimsonBurstNaturalRoundTrigger: scheduled.decision.triggered,
                  currentTarget: context.targetTroop,
                } : {}),
                ...(definition.metadata.tags?.includes("soaringFlameTemplate") ? {
                  shieldMainAttackAttempted: true,
                  shieldMainAttackAttemptCount: scheduled.attackCountAfter!,
                  soaringFlameTriggered: scheduled.decision.triggered,
                  ...(scheduled.decision.triggered ? {
                    activationRound: state.round + 1,
                    activeRounds: [state.round + 1, state.round + 2],
                  } : {}),
                } : {}),
                ...(definition.id === "hero-skill.rufus.violent-blast" ? {
                  violentBlastEligible: scheduled.decision.eligible,
                  violentBlastRoll: scheduled.decision.rngRoll,
                  violentBlastTriggered: scheduled.decision.triggered,
                  debuffTarget: context.targetTroop,
                  penetrationReduction: .50,
                  refreshedExistingState,
                  ...(scheduled.decision.triggered ? { remainingDuration: 2 } : {}),
                } : {}),
              });
              continue;
            }
            if (
              definition?.id === "hero-skill.ruini.dream-mark" &&
              context.action.troop === "lancer" ||
              definition?.id === "hero-skill.weien.flanking-strike" &&
              context.action.troop === "marksman" ||
              definition?.metadata.tags?.includes("wayneFlankingTemplate") &&
              context.action.troop === "marksman"
            ) {
              const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
              const counted = incrementMainAttackCount(
                runtimeUpdates.get(key) ?? originalRuntime, context.action.troop,
              );
              const scheduled = decideAfterNormalTrigger(
                state.round, context.action.side, definition, counted, config,
                state.battleContext, context.action.troop,
              );
              runtimeUpdates.set(key, scheduled.decision.runtimeAfter);
              if (scheduled.decision.triggered) {
                if (definition.id === "hero-skill.ruini.dream-mark") {
                  const applications = compileAfterNormalActiveEffects(
                    scheduled.decision, context.action.side, hero, state.round,
                    context.targetSide, context.targetTroop, definitions, side,
                  );
                  for (const application of applications) {
                    if (application.targetTroop !== undefined) {
                      upsertHitTargetDebuff(
                        hitTargetDebuffs, application.side,
                        application.targetTroop, application.effect,
                      );
                    }
                  }
                } else {
                  const action = actionKey(context.action.side, context.action.troop);
                  preDodgeFlankingStrike.set(action, [
                    ...(preDodgeFlankingStrike.get(action) ?? []), scheduled.decision,
                  ]);
                }
              }
              if (config.recordTrace !== false) traces.push({
                ...toTrace(state.round, context.action.side, hero,
                  scheduled.decision, [], context.action.troop),
                targetTroop: context.targetTroop,
                ...(definition.metadata.tags?.includes("wayneFlankingTemplate") ? {
                  mainAttackAttempted: true,
                  mainAttackAttemptCount: scheduled.attackCountAfter,
                  dawnSniperAttackCount: scheduled.attackCountAfter,
                  lancerEventCoefficient: .4,
                  marksmanEventCoefficient: .2,
                } : {}),
                ...(scheduled.attackCountBefore === undefined ? {} : {
                  attackCountBefore: scheduled.attackCountBefore,
                  attackCountAfter: scheduled.attackCountAfter,
                }),
                ...(definition.id !== "hero-skill.ruini.dream-mark" ||
                  !scheduled.decision.triggered ? {} : {
                    dreamMarkTarget: context.targetTroop,
                    appliedDebuffTargetTroop: context.targetTroop,
                    vulnerabilityActivationRound: state.round + 1,
                    effectiveFromRound: state.round + 1,
                    expiresAfterRound: state.round + 1,
                    durationRemaining: 1,
                  }),
              });
              continue;
            }
            if (definition?.id === "hero-skill.gewen.demolition-squad" &&
              context.action.troop === "marksman") {
              const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
              const runtime = incrementMainAttackCount(
                runtimeUpdates.get(key) ?? originalRuntime, context.action.troop,
              );
              const scheduled = decideAfterNormalTrigger(
                state.round, context.action.side, definition, runtime, config,
                state.battleContext, context.action.troop,
              );
              runtimeUpdates.set(key, scheduled.decision.runtimeAfter);
              if (scheduled.decision.triggered) {
                const action = actionKey(context.action.side, context.action.troop);
                preDodgeDemolitionSquad.set(action, [
                  ...(preDodgeDemolitionSquad.get(action) ?? []), scheduled.decision,
                ]);
              }
              if (config.recordTrace !== false) traces.push({
                ...toTrace(state.round, context.action.side, hero,
                  scheduled.decision, [], context.action.troop),
                ...(scheduled.attackCountBefore === undefined ? {} : {
                  attackCountBefore: scheduled.attackCountBefore,
                  attackCountAfter: scheduled.attackCountAfter,
                }),
                targetTroop: context.targetTroop,
              });
              continue;
            }
            if (context.action.troop !== "lancer") continue;
            if (definition?.id !== "hero-skill.lingnai.shadow-blade") continue;
            const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
            const runtime = runtimeUpdates.get(key) ?? originalRuntime;
            const decision = decideTrigger(
              state.round, context.action.side, definition, runtime, config,
              state.battleContext, context.action.troop,
            );
            runtimeUpdates.set(key, decision.runtimeAfter);
            if (decision.triggered) {
              const action = actionKey(context.action.side, context.action.troop);
              preDodgeShadowBlade.set(action, [
                ...(preDodgeShadowBlade.get(action) ?? []), decision,
              ]);
            }
            if (config.recordTrace !== false) traces.push(toTrace(
              state.round, context.action.side, hero, decision, [], context.action.troop,
            ));
          }
        }
      },
      beforeHit(context) {
        const defenderSide = context.targetSide;
        const side = sideFromState(state, defenderSide);
        const cancellationEffects: ActiveEffect[] = [];
        let cancelled = false;
        for (const hero of side.heroStates) {
          for (const originalRuntime of hero.skillStates) {
            const definition = definitions.get(originalRuntime.skillId);
            if (definition?.actionMechanic?.kind !== "dodgeNormalAttack") continue;
            const key = runtimeKey(defenderSide, heroRuntimeId(hero), definition.id);
            const runtime = runtimeUpdates.get(key) ?? originalRuntime;
            const decision = decideTrigger(
              state.round,
              defenderSide,
              definition,
              runtime,
              config,
              state.battleContext,
              context.action.troop,
            );
            runtimeUpdates.set(key, decision.runtimeAfter);
            const effect = decision.triggered
              ? createDodgeCancellationEffect(
                  defenderSide,
                  hero,
                  definition,
                  state.round,
                  context.action.troop,
                  context.targetTroop,
                )
              : undefined;
            if (effect !== undefined) cancellationEffects.push(effect);
            cancelled ||= decision.triggered;
            if (config.recordTrace !== false) traces.push({
              ...toTrace(
                state.round,
                defenderSide,
                hero,
                decision,
                effect === undefined ? [] : [effect],
                context.action.troop,
              ),
              targetTroop: context.targetTroop,
              dodgeResult: decision.triggered,
            });
          }
        }
        return {
          cancelHit: cancelled,
          transientEffects: cancellationEffects,
          ...(cancelled ? { reason: "heroDodgeNormalAttack" } : {}),
        };
      },
      afterDodge(context) {
        const side = sideFromState(state, context.action.side);
        for (const hero of side.heroStates) {
          for (const originalRuntime of hero.skillStates) {
            const definition = definitions.get(originalRuntime.skillId);
            if (definition?.id !== "hero-skill.baxiti.unstable-field" &&
              !definition?.metadata.tags?.includes("criticalNormalAttack")) continue;
            if (definition.id === "hero-skill.baxiti.unstable-field" &&
              !defenderCanDodge(context.targetSide)) continue;
            const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
            const runtime = runtimeUpdates.get(key) ?? originalRuntime;
            const decision = decideTrigger(
              state.round, context.action.side, definition, runtime, config,
              state.battleContext, context.action.troop,
            );
            runtimeUpdates.set(key, decision.runtimeAfter);
            if (decision.triggered && definition.metadata.tags?.includes("criticalNormalAttack")) {
              const action = actionKey(context.action.side, context.action.troop);
              const criticalEffects = compileActiveEffects(
                decision, context.action.side, hero, state.round, context.action.troop,
              );
              actionEffects.set(action, [
                ...(actionEffects.get(action) ?? []), ...criticalEffects,
              ]);
            } else if (decision.triggered) {
              const action = actionKey(context.action.side, context.action.troop);
              beforeAttackExtraDamage.set(action, [
                ...(beforeAttackExtraDamage.get(action) ?? []), decision,
              ]);
            }
            if (config.recordTrace !== false) traces.push(toTrace(
              state.round, context.action.side, hero, decision, [], context.action.troop,
            ));
          }
        }
      },
      afterMainAttack(context) {
        const side = sideFromState(state, context.action.side);
        if (config.recordTrace !== false) {
          for (let index = traces.length - 1; index >= 0; index -= 1) {
            const trace = traces[index]!;
            if (trace.side !== context.action.side ||
              trace.sourceTroop !== context.action.troop ||
              trace.mainAttackAttempted !== true ||
              trace.successfulNormalAttackHit !== undefined) continue;
            traces[index] = {
              ...trace,
              successfulNormalAttackHit: !context.hitCancelled,
              normalAttackDodged: context.hitCancelled,
              ...(trace.shieldMainAttackAttempted ? {
                shieldNormalAttackDodged: context.hitCancelled,
              } : {}),
            };
          }
        }
        for (const hero of side.heroStates) {
          for (const originalRuntime of hero.skillStates) {
            const definition = definitions.get(originalRuntime.skillId);
            if (
              definition === undefined ||
              !definitionObservesMainAttack(definition, context.action.troop)
            ) continue;
            if (definition.triggerTiming === "mainAttackAttempt") continue;
            if (definition.id === "hero-skill.gewen.demolition-squad" ||
              definition.id === "hero-skill.ruini.dream-mark" ||
              definition.id === "hero-skill.weien.flanking-strike" ||
              definition.metadata.tags?.includes("wayneFlankingTemplate") ||
              (definition.id === "hero-skill.gedun.poisoned-blade" && context.hitCancelled) ||
              (context.hitCancelled && definition.metadata.tags?.includes("S5"))) continue;
            const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
            const runtime = runtimeUpdates.get(key) ?? originalRuntime;
            runtimeUpdates.set(key, incrementMainAttackCount(runtime, context.action.troop));
          }
        }
        if (context.hitCancelled && config.recordTrace !== false) {
          for (const hero of side.heroStates) {
            for (const runtime of hero.skillStates) {
              const definition = definitions.get(runtime.skillId);
              if (definition?.triggerTiming !== "successfulNormalAttackHit" ||
                !definitionMatchesHitSource(definition, runtime.level, context.action.troop)) continue;
              traces.push({
                ...toTrace(state.round, context.action.side, hero,
                  noTrigger({ definition, levelValue: definition.levelValues[runtime.level],
                    runtimeBefore: runtime,
                    probability: definition.levelValues[runtime.level]?.probability ??
                      definition.probability ?? null }, runtime, "normalAttackDodged"),
                  [], context.action.troop),
                targetTroop: context.targetTroop,
                mainAttackAttempted: true,
                successfulNormalAttackHit: false,
                normalAttackDodged: true,
                ...(definition.id === "hero-skill.freya.crescent-scythe" ? {
                  lancerMainAttackAttempted: true,
                  lancerNormalAttackHit: false,
                  crescentScytheEligible: false,
                  crescentScytheRoll: null,
                  crescentScytheTriggered: false,
                } : {}),
                ...(definition.id === "hero-skill.rufus.armor-breaking-strike" ? {
                  marksmanMainAttackAttempted: true,
                  armorBreakingStrikeEligible: false,
                  extraDamageCoefficient: .60,
                } : {}),
              });
            }
          }
        }
      },
    },
    targetingEffectProvider: {
      id: "hero-skill-targeting",
      beforeTargetSelection(context): readonly ActiveEffect[] {
        const effects: ActiveEffect[] = [];
        const side = sideFromState(state, context.action.side);
        for (const hero of side.heroStates) {
          for (const originalRuntime of hero.skillStates) {
            const definition = definitions.get(originalRuntime.skillId);
            if (
              definition?.trigger !== "beforeAttack" ||
              definition.metadata.tags?.includes("criticalNormalAttack") ||
              (definition.id === "hero-skill.baxiti.unstable-field" &&
                defenderCanDodge(otherSide(context.action.side))) ||
              definition.actionMechanic !== undefined ||
              definition.metadata.tags?.includes("hitTargetTroop")
            ) continue;
            const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
            const runtime = runtimeUpdates.get(key) ?? originalRuntime;
            const decision = decideTrigger(
              state.round,
              context.action.side,
              definition,
              runtime,
              config,
              state.battleContext,
              context.action.troop,
            );
            const compiled = decision.triggered && decision.levelValue !== undefined
              ? compileActiveEffects(
                  decision,
                  context.action.side,
                  hero,
                  state.round,
                  context.action.troop,
                )
              : [];
            effects.push(...compiled);
            if (decision.triggered && decision.levelValue?.effects.some(
              (effect) => effect.kind === "extraDamage",
            )) {
              const action = actionKey(context.action.side, context.action.troop);
              beforeAttackExtraDamage.set(action, [
                ...(beforeAttackExtraDamage.get(action) ?? []), decision,
              ]);
            }
            runtimeUpdates.set(key, decision.runtimeAfter);
            if (config.recordTrace !== false) traces.push(
              toTrace(
                state.round,
                context.action.side,
                hero,
                decision,
                compiled,
                context.action.troop,
              ),
            );
          }
        }
        actionEffects.set(actionKey(context.action.side, context.action.troop), effects);
        const immediateAttributeDebuffs = (
          hitTargetDebuffs.get(
            hitTargetKey(context.action.side, context.action.troop),
          ) ?? []
        ).filter((effect) => effect.definition.kind === "attributeReduction");
        return [
          ...effects,
          ...(queuedArmyEffects.get(context.action.side) ?? []),
          ...immediateAttributeDebuffs,
        ];
      },
    },
    additionalDamageGenerator: {
      id: "hero-skill-extra-damage",
      runsAfterCancelledHit: true,
      afterNormalAttack(context): readonly DamageEventInput[] {
        const outputs: DamageEventInput[] = [];
        const action = actionKey(context.action.side, context.action.troop);
        for (const decision of preDodgeShadowBlade.get(action) ?? []) {
          const damageInputs = compileExtraDamageInputs(decision, context, state);
          outputs.push(...damageInputs);
          if (config.recordTrace !== false) appendProducedDamageIds(
            traces, context.action.side, decision.definition.id,
            damageInputs.map((input) => input.id), context.primaryDamageEvent.id,
            decision.runtimeBefore.ownerRuntimeInstanceId,
          );
        }
        preDodgeShadowBlade.delete(action);
        for (const decision of preDodgeDemolitionSquad.get(action) ?? []) {
          const damageInputs = compileExtraDamageInputs(decision, context, state);
          outputs.push(...damageInputs);
          if (config.recordTrace !== false) appendProducedDamageIds(
            traces, context.action.side, decision.definition.id,
            damageInputs.map((input) => input.id), context.primaryDamageEvent.id,
            decision.runtimeBefore.ownerRuntimeInstanceId,
          );
        }
        preDodgeDemolitionSquad.delete(action);
        for (const decision of preDodgeFlankingStrike.get(action) ?? []) {
          const damageInputs = compileExtraDamageInputs(decision, context, state);
          outputs.push(...damageInputs);
          if (config.recordTrace !== false) appendProducedDamageIds(
            traces, context.action.side, decision.definition.id,
            damageInputs.map((input) => input.id), context.primaryDamageEvent.id,
            decision.runtimeBefore.ownerRuntimeInstanceId,
          );
        }
        preDodgeFlankingStrike.delete(action);
        for (const decision of attackAttemptDecisions.get(action) ?? []) {
          const damageInputs = compileExtraDamageInputs(decision, context, state);
          outputs.push(...damageInputs);
          if (config.recordTrace !== false) appendProducedDamageIds(
            traces, context.action.side, decision.definition.id,
            damageInputs.map((input) => input.id), context.primaryDamageEvent.id,
            decision.runtimeBefore.ownerRuntimeInstanceId,
          );
        }
        attackAttemptDecisions.delete(action);
        const side = sideFromState(state, context.action.side);
        for (const hero of side.heroStates) {
          for (const originalRuntime of hero.skillStates) {
            const definition = definitions.get(originalRuntime.skillId);
            if (definition === undefined) continue;
            const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
            const runtime = runtimeUpdates.get(key) ?? originalRuntime;
            if (definition.actionMechanic?.kind === "targetBoundMark") {
              const markMechanic = definition.actionMechanic;
              const delayed = compileTargetBoundMarkDamageInputs(state, definition, context, hero);
              outputs.push(...delayed);
              const markSources = delayed.flatMap((input) => sideFromState(state, input.targetSide).troops[input.targetTroop].debuffs
                .flatMap((effect) => effect.definition.kind === "targetBoundMark" &&
                  effect.definition.markId === markMechanic.markId &&
                  effect.appliedRound + markMechanic.damageDelayRounds === state.round
                  ? effect.definition.damageContributors ?? [] : []));
              if (config.recordTrace !== false && delayed.length > 0) traces.push({
                ...toSyntheticTrace(state.round, context.action.side, hero,
                  definition, runtime, context.action.troop, "targetBoundMarkDamage"),
                targetTroop: delayed[0]!.targetTroop,
                dreamMarkTarget: delayed[0]!.targetTroop,
                reportActivationCount: 0,
                ...(definition.actionMechanic.duplicateSourceStacking ? {
                  dreamMarkSourceCount: markSources.length,
                  dreamMarkDamageCoefficient: delayed[0]!.skillCoefficient!,
                  dreamMarkContributingRuntimeIds: markSources.map((source) => source.runtimeInstanceId),
                  dreamMarkStackingStatus: "PROVISIONAL" as const,
                } : {}),
                producedDamageEventIds: delayed.map((input) => input.id),
                extraDamageEvents: delayed.map((input) => input.id),
                parentEventId: context.primaryDamageEvent.id,
              });
            }
            if (definition.id === "hero-skill.weien.thunder-raid" &&
              runtime.enabled && runtime.lastTriggeredRound === state.round) {
              const decision = syntheticTriggeredDecision(definition, runtime);
              const damageInputs = compileExtraDamageInputs(decision, context, state);
              outputs.push(...damageInputs);
              if (config.recordTrace !== false && damageInputs.length > 0) traces.push({
                ...toSyntheticTrace(state.round, context.action.side, hero,
                  definition, runtime, context.action.troop, "periodicExtraDamage"),
                targetTroop: context.primaryDamageEvent.targetTroop,
                producedDamageEventIds: damageInputs.map((input) => input.id),
                extraDamageEvents: damageInputs.map((input) => input.id),
                parentEventId: context.primaryDamageEvent.id,
              });
            }
          }
        }
        if (context.hitCancelled) return outputs;
        for (const decision of beforeAttackExtraDamage.get(action) ?? []) {
          const damageInputs = compileExtraDamageInputs(decision, context, state);
          outputs.push(...damageInputs);
          if (config.recordTrace !== false) appendProducedDamageIds(
            traces,
            context.action.side,
            decision.definition.id,
            damageInputs.map((input) => input.id),
            context.primaryDamageEvent.id,
            decision.runtimeBefore.ownerRuntimeInstanceId,
          );
        }
        beforeAttackExtraDamage.delete(action);
        for (const hero of side.heroStates) {
          for (const originalRuntime of hero.skillStates) {
            const definition = definitions.get(originalRuntime.skillId);
            if (definition === undefined) continue;
            const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
            const runtime = runtimeUpdates.get(key) ?? originalRuntime;

            if (
              definition.trigger === "roundStart" &&
              definition.id !== "hero-skill.weien.thunder-raid" &&
              runtime.lastTriggeredRound === state.round &&
              definition.levelValues[runtime.level]?.effects.some(
                (effect) => effect.kind === "extraDamage",
              )
            ) {
              const decision = syntheticTriggeredDecision(definition, runtime);
              const damageInputs = compileExtraDamageInputs(
                decision,
                context,
                state,
              );
              outputs.push(...damageInputs);
              if (config.recordTrace !== false) appendProducedDamageIds(
                traces,
                context.action.side,
                definition.id,
                damageInputs.map((input) => input.id), undefined, heroRuntimeId(hero),
              );
              continue;
            }

            if (definition.trigger !== "afterNormalAttack" ||
              definition.triggerTiming === "mainAttackAttempt" ||
              definition.id === "hero-skill.ruini.dream-mark" ||
              definition.id === "hero-skill.weien.flanking-strike" ||
              definition.metadata.tags?.includes("wayneFlankingTemplate") ||
              definition.id === "hero-skill.gewen.demolition-squad" ||
              definition.id === "hero-skill.lingnai.shadow-blade") continue;
            if (definition.triggerTiming === "successfulNormalAttackHit" &&
              !definitionMatchesHitSource(definition, runtime.level, context.action.troop)) continue;
            const scheduled = decideAfterNormalTrigger(
              state.round,
              context.action.side,
              definition,
              runtime,
              config,
              state.battleContext,
              context.action.troop,
            );
            const decision = scheduled.decision;
            const damageInputs = decision.triggered
              ? compileExtraDamageInputs(decision, context, state)
              : [];
            outputs.push(...damageInputs);
            const activeEffects = decision.triggered
              ? compileAfterNormalActiveEffects(
                  decision,
                  context.action.side,
                  hero,
                  state.round,
                  context.primaryDamageEvent.targetSide,
                  context.primaryDamageEvent.targetTroop,
                  definitions,
                  side,
                )
              : [];
            for (const application of activeEffects) {
              if (application.targetTroop === undefined) {
                queueArmyEffect(
                  queuedArmyEffects,
                  application.side,
                  application.effect,
                );
              } else {
                const applied = upsertHitTargetDebuff(
                  hitTargetDebuffs,
                  application.side,
                  application.targetTroop,
                  application.effect,
                );
                if (definition.metadata.tags?.includes("gwenAerialTemplate") &&
                  applied.definition.kind === "oneUseIncomingDamageIncrease") {
                  oneUseOriginRoot.set(applied.instanceId, context.primaryDamageEvent.rootEventId);
                  // The prior token may have been consumed by this main hit;
                  // the newly issued token must survive for a later event.
                  consumedOneUseEffects.get(hitTargetKey(application.side, application.targetTroop))
                    ?.delete(applied.instanceId);
                }
              }
            }
            const shieldKey = hitTargetKey(context.action.side, context.action.troop);
            const persistedShields = temporaryShieldUpdates.get(shieldKey) ??
              sideFromState(state, context.action.side)
                .troops[context.action.troop].temporaryShields;
            const generatedShields = decision.triggered
              ? compileTemporaryShieldLayers(
                  decision,
                  context,
                  hero,
                  persistedShields,
                )
              : [];
            for (const layer of generatedShields) {
              temporaryShieldUpdates.set(
                shieldKey,
                upsertTemporaryShield(temporaryShieldUpdates.get(shieldKey) ?? persistedShields, layer),
              );
            }
            runtimeUpdates.set(key, decision.runtimeAfter);
            const targetEffects = activeEffects.filter(
              (application) => application.targetTroop !== undefined,
            );
            const interval = traceInterval(
              targetEffects.map((application) => application.effect),
            );
            const temporaryShield = generatedShields[0];
            const hasVulnerability = decision.triggered && targetEffects.some(
              (application) =>
                application.effect.definition.kind === "incomingDamageIncrease",
            );
            const hasPoison = decision.triggered && decision.definition.metadata.tags?.includes(
              "poisonTarget",
            ) === true;
            const hasStun = decision.triggered && targetEffects.some(
              (application) =>
                application.effect.definition.kind === "skipNextRoundAction",
            );
            if (config.recordTrace !== false) traces.push({
              ...toTrace(
                state.round,
                context.action.side,
                hero,
                decision,
                activeEffects.map((application) => application.effect),
                context.action.troop,
              ),
              producedDamageEventIds: damageInputs.map((input) => input.id),
              extraDamageEvents: damageInputs.map((input) => input.id),
              parentEventId: context.primaryDamageEvent.id,
              targetTroop: context.primaryDamageEvent.targetTroop,
              mainAttackAttempted: true,
              successfulNormalAttackHit: true,
              normalAttackDodged: false,
              ...(definition.id === "hero-skill.freya.crescent-scythe" ? {
                lancerMainAttackAttempted: true,
                lancerNormalAttackHit: true,
                crescentScytheEligible: decision.eligible,
                crescentScytheRoll: decision.rngRoll,
                crescentScytheTriggered: decision.triggered,
              } : {}),
              ...(definition.id === "hero-skill.rufus.armor-breaking-strike" ? {
                marksmanMainAttackAttempted: true,
                armorBreakingStrikeEligible: decision.eligible,
                extraDamageCoefficient: .60,
                vulnerabilityTarget: context.primaryDamageEvent.targetTroop,
                ...(decision.triggered ? {
                  vulnerabilityActivationRound: state.round + 1,
                } : {}),
              } : {}),
              ...(definition.id === "hero-skill.blanchette.crimson-burst" ? {
                crimsonBurstNaturalRoundTrigger: decision.triggered,
                currentTarget: context.primaryDamageEvent.targetTroop,
              } : {}),
              ...(targetEffects.length === 0
                ? {}
                : {
                    appliedDebuffTargetTroop:
                      context.primaryDamageEvent.targetTroop,
                    ...interval,
                  }),
              ...(scheduled.attackCountBefore === undefined
                ? {}
                : {
                    attackCountBefore: scheduled.attackCountBefore,
                    attackCountAfter: scheduled.attackCountAfter,
                    attackCount: scheduled.attackCountAfter,
                  }),
              ...(definition.actionMechanic?.kind === "targetBoundMark" &&
              decision.triggered
                ? {
                    dreamMarkTarget: context.primaryDamageEvent.targetTroop,
                    vulnerabilityActivationRound: state.round + 1,
                    durationRemaining:
                      definition.actionMechanic.markDurationRounds,
                  }
                : {}),
              ...(hasVulnerability
                ? { vulnerabilityActivationRound: interval.effectiveFromRound }
                : {}),
              ...(hasPoison
                ? {
                    poisonTarget: context.primaryDamageEvent.targetTroop,
                    poisonActivationRound: interval.effectiveFromRound,
                  }
                : {}),
              ...(hasStun
                ? {
                    stunTarget: context.primaryDamageEvent.targetTroop,
                    skippedRound: interval.effectiveFromRound,
                  }
                : {}),
              ...(temporaryShield === undefined
                ? {}
                : {
                    temporaryShieldGenerated: true,
                    triggerRound: state.round,
                    activationRound: temporaryShield.activeFromRound,
                    ...(temporaryShield.rawDamageBasis === undefined
                      ? {}
                      : { rawDamageBasis: temporaryShield.rawDamageBasis }),
                    generatedShieldHp: temporaryShield.generatedShieldHp,
                    temporaryShieldRuleStatus: temporaryShield.ruleStatus,
                    ...(temporaryShield.gatotShield === undefined
                      ? {}
                      : { gatotShield: temporaryShield.gatotShield }),
                  }),
              ...(definition.id === "hero-skill.suoniya.bounty-temptation"
                ? {
                    ...(scheduled.attackCountAfter === undefined ? {} : {
                      lancerCompletedAttackCount: scheduled.attackCountAfter,
                    }),
                    ...(decision.triggered ? {
                      bountyExtraDamageCoefficient: .75,
                      bountyAttackBuffActivationRound: state.round + 1,
                    } : {}),
                  } : {}),
              ...(definition.id === "hero-skill.suoniya.torrent-impact" && decision.triggered
                ? { torrentTriggerRound: state.round,
                    stunActivationRound: state.round + 1 } : {}),
              ...(definition.id === "hero-skill.s8.hengdelike.heir-of-forest" && decision.triggered
                ? { heirOfForestTriggerRound: state.round,
                    heirOfForestTargets: damageInputs.map((input) => input.targetTroop),
                    perTargetExtraDamageCoefficient: .40 } : {}),
              ...(decision.definition.metadata.tags?.includes(
                "immediateCurrentRoundDefenseBuff",
              )
                ? { defenseBuffActivation: "immediateCurrentRound" as const }
                : {}),
              ...(decision.definition.metadata.tags?.includes(
                "multiTargetExtraDamage",
              )
                ? {
                    multiTargetExtraDamageEvents: damageInputs.map(
                      (input) => input.id,
                    ),
                  }
                : {}),
            });
          }
        }
        return outputs;
      },
    },
    damageEventEffectProvider: {
      id: "hero-skill-event-effects",
      beforeDamageEvent(context): readonly ActiveEffect[] {
        const decayingEffects = compileDecayingEventEffects(
          state,
          definitions,
          runtimeUpdates,
          context.input,
        );
        if (
          context.input.damageType === "normalAttack" &&
          (context.input.depth ?? 0) === 0
        ) {
          const side = sideFromState(state, context.action.side);
          for (const hero of side.heroStates) {
            for (const originalRuntime of hero.skillStates) {
              const definition = definitions.get(originalRuntime.skillId);
              if (
                definition?.trigger !== "beforeAttack" ||
                definition.triggerTiming === "mainAttackAttempt" ||
                definition.id === "hero-skill.ruini.dream-mark" ||
                !definition.metadata.tags?.includes("hitTargetTroop")
              ) continue;
              const key = runtimeKey(context.action.side, heroRuntimeId(hero), definition.id);
              const runtime = runtimeUpdates.get(key) ?? originalRuntime;
              const decision = decideTrigger(
                state.round,
                context.action.side,
                definition,
                runtime,
                config,
                state.battleContext,
                context.action.troop,
              );
              const compiled = decision.triggered
                ? compileHitTargetEffects(
                    decision,
                    context.action.side,
                    hero,
                    state.round,
                    context.input.targetSide,
                    context.input.targetTroop,
                  )
                : [];
              const applied = compiled.map((effect) => upsertHitTargetDebuff(
                hitTargetDebuffs,
                context.input.targetSide,
                context.input.targetTroop,
                effect,
              ));
              const interval = traceInterval(applied);
              runtimeUpdates.set(key, decision.runtimeAfter);
              if (config.recordTrace !== false) traces.push({
                ...toTrace(
                  state.round,
                  context.action.side,
                  hero,
                  decision,
                  applied,
                  context.action.troop,
                ),
                targetTroop: context.input.targetTroop,
                ...(decision.triggered
                  ? {
                      appliedDebuffTargetTroop: context.input.targetTroop,
                      ...interval,
                    }
                  : {}),
                parentEventId: context.input.id,
              });
            }
          }
        }
        const oneUseIncomingEffects = consumeOneUseIncomingEffects(
          state,
          hitTargetDebuffs,
          consumedOneUseEffects,
          context.input,
          oneUseOriginRoot,
        );
        return [
          ...(actionEffects.get(
          actionKey(context.action.side, context.action.troop),
          ) ?? []),
          ...(queuedArmyEffects.get(context.input.sourceSide) ?? []).filter(
            isOutgoingEventEffect,
          ),
          ...(queuedArmyEffects.get(context.input.targetSide) ?? []).filter(
            isIncomingEventEffect,
          ),
          ...decayingEffects,
          ...(hitTargetDebuffs.get(
            hitTargetKey(context.input.sourceSide, context.input.sourceTroop),
          ) ?? []),
          ...oneUseIncomingEffects,
        ];
      },
    },
    finalizeActionState(actionState): BattleState {
      let finalized = actionState;
      for (const [sideId, effects] of queuedArmyEffects) {
        const side = sideFromState(finalized, sideId);
        finalized = replaceSide(finalized, sideId, {
          ...side,
          armyEffects: effects.reduce(upsertActiveEffect, side.armyEffects),
        });
      }
      for (const [key, effects] of hitTargetDebuffs) {
        const [sideId, troopType] = key.split(":") as [SideId, TroopType];
        const side = sideFromState(finalized, sideId);
        const troop = side.troops[troopType];
        finalized = replaceSide(
          finalized,
          sideId,
          replaceTroop(side, troopType, {
            ...troop,
            debuffs: effects.reduce(upsertActiveEffect, troop.debuffs),
          }),
        );
      }
      for (const [key, consumedIds] of consumedOneUseEffects) {
        const [sideId, troopType] = key.split(":") as [SideId, TroopType];
        const side = sideFromState(finalized, sideId);
        const troop = side.troops[troopType];
        finalized = replaceSide(
          finalized,
          sideId,
          replaceTroop(side, troopType, {
            ...troop,
            debuffs: troop.debuffs.filter(
              (effect) => !consumedIds.has(effect.instanceId),
            ),
          }),
        );
      }
      for (const [key, shields] of temporaryShieldUpdates) {
        const [sideId, troopType] = key.split(":") as [SideId, TroopType];
        const side = sideFromState(finalized, sideId);
        finalized = replaceSide(
          finalized,
          sideId,
          replaceTroop(side, troopType, {
            ...side.troops[troopType],
            temporaryShields: shields,
            temporaryShieldHp: shields.reduce(
              (sum, shield) => sum + (shield.activeFromRound <= finalized.round &&
                finalized.round <= shield.expiresAfterRound ? shield.remainingShieldHp : 0),
              0,
            ),
          }),
        );
      }
      for (const [key, runtime] of runtimeUpdates) {
        const [sideId, heroId] = JSON.parse(key) as [SideId, string, string];
        finalized = setHeroRuntime(finalized, sideId, heroId, runtime);
      }
      return finalized;
    },
    getTraceEntries: () => traces,
  };
}

interface TriggeredEffectApplication {
  readonly side: SideId;
  readonly targetTroop?: TroopType;
  readonly effect: ActiveEffect;
}

function definitionObservesMainAttack(
  definition: HeroSkillDefinition,
  troop: TroopType,
): boolean {
  const mechanic = definition.actionMechanic;
  if (mechanic?.kind === "skipMainAttack") {
    return mechanic.sourceTroop === troop;
  }
  if (mechanic?.kind === "attackCountTrigger" || mechanic?.kind === "targetBoundMark") {
    return mechanic.schedule.source === "army" || mechanic.schedule.source === troop;
  }
  return Object.values(definition.levelValues).some((level) =>
    level.effects.some(
      (effect) => effect.kind === "decayingDamageIncrease" &&
        effect.initialValues[troop] !== undefined,
    )
  );
}

function definitionMatchesHitSource(
  definition: HeroSkillDefinition,
  level: number,
  troop: TroopType,
): boolean {
  const effects = definition.levelValues[level]?.effects ?? [];
  const damage = effects.filter((effect) => effect.kind === "extraDamage");
  const defining = damage.length > 0 ? damage : effects;
  return defining.some((effect) =>
    effect.scope.source === "army" || effect.scope.source === troop);
}

function incrementMainAttackCount(
  runtime: HeroSkillRuntimeState,
  troop: TroopType,
): HeroSkillRuntimeState {
  return {
    ...runtime,
    mainAttackCounts: {
      ...runtime.mainAttackCounts,
      [troop]: runtime.mainAttackCounts[troop] + 1,
    },
  };
}

function decideAfterNormalTrigger(
  round: number,
  side: SideId,
  definition: HeroSkillDefinition,
  runtime: HeroSkillRuntimeState,
  config: HeroSkillSystemConfig,
  battleContext: BattleState["battleContext"],
  sourceTroop: TroopType,
): {
  readonly decision: HeroDecision;
  readonly attackCountBefore?: number;
  readonly attackCountAfter?: number;
} {
  const mechanic = definition.actionMechanic;
  if (mechanic?.kind === "naturalRoundTrigger") {
    if (mechanic.source !== sourceTroop) {
      const levelValue = definition.levelValues[runtime.level];
      return { decision: noTrigger({ definition, levelValue,
        runtimeBefore: runtime,
        probability: levelValue?.probability ?? definition.probability ?? null,
      }, runtime, "sourceTroopMismatch") };
    }
    return { decision: decideTrigger(round, side, definition, runtime, config,
      battleContext, sourceTroop) };
  }
  if (mechanic?.kind !== "attackCountTrigger" && mechanic?.kind !== "targetBoundMark") {
    return {
      decision: decideTrigger(
        round,
        side,
        definition,
        runtime,
        config,
        battleContext,
        sourceTroop,
      ),
    };
  }
  const schedule = mechanic.schedule;
  const sourceMatches = schedule.source === "army" || schedule.source === sourceTroop;
  const attackCountAfter = runtime.mainAttackCounts[sourceTroop];
  const attackCountBefore = Math.max(0, attackCountAfter - 1);
  const due = sourceMatches && (schedule.mode === "onCompleted"
    ? attackCountAfter > 0 && attackCountAfter % schedule.interval === 0
    : attackCountBefore > 0 && attackCountBefore % schedule.interval === 0);
  if (!due) {
    const levelValue = definition.levelValues[runtime.level];
    return {
      decision: noTrigger(
        {
          definition,
          levelValue,
          runtimeBefore: runtime,
          probability: levelValue?.probability ?? definition.probability ?? null,
        },
        runtime,
        sourceMatches ? "attackCountScheduleNotDue" : "sourceTroopMismatch",
      ),
      attackCountBefore,
      attackCountAfter,
    };
  }
  return {
    decision: decideTrigger(
      round,
      side,
      definition,
      runtime,
      config,
      battleContext,
      sourceTroop,
    ),
    attackCountBefore,
    attackCountAfter,
  };
}

function syntheticTriggeredDecision(
  definition: HeroSkillDefinition,
  runtime: HeroSkillRuntimeState,
): HeroDecision {
  return {
    definition,
    levelValue: definition.levelValues[runtime.level],
    runtimeBefore: runtime,
    runtimeAfter: runtime,
    probability:
      definition.levelValues[runtime.level]?.probability ??
      definition.probability ?? null,
    rngRoll: null,
    eligible: true,
    triggered: true,
    reason: "activeRoundStartProc",
  };
}

function compileAfterNormalActiveEffects(
  decision: HeroDecision,
  ownerSide: SideId,
  hero: HeroState,
  round: number,
  targetSide: SideId,
  targetTroop: TroopType,
  definitions: ReadonlyMap<string, HeroSkillDefinition>,
  ownerBattleSide: BattleSide,
): TriggeredEffectApplication[] {
  const output: TriggeredEffectApplication[] = [];
  const mechanic = decision.definition.actionMechanic;
  for (const effect of decision.levelValue?.effects ?? []) {
    if (effect.kind === "targetBoundMark") {
      if (mechanic?.kind !== "targetBoundMark") continue;
      output.push({
        side: targetSide,
        targetTroop,
        effect: createActiveEffect({
          identity: {
            sourceId: mechanic.duplicateSourceStacking
              ? `hero:${ownerSide}:merged-mark:${decision.definition.id}:${targetSide}:${targetTroop}:R${round}`
              : `hero:${ownerSide}:${heroRuntimeId(hero)}:${hero.position}:mark:${targetSide}:${targetTroop}`,
            sourceSkillId: decision.definition.id,
            effectId: effect.id,
          },
          definition: {
            id: effect.id,
            name: effect.name,
            kind: "targetBoundMark",
            markId: effect.markId,
            ...(mechanic.duplicateSourceStacking ? {
              additionalSourceCoefficient: mechanic.duplicateSourceStacking.additionalCoefficient,
              damageContributors: [{ runtimeInstanceId: heroRuntimeId(hero), coefficient: mechanic.damageCoefficient }],
            } : {}),
            ruleStatus: decision.definition.metadata.ruleStatus,
            lifecycle: {
              activationTiming: "nextRound",
              durationRounds: mechanic.markDurationRounds,
              refreshMode: "replace",
            },
          },
          appliedRound: round,
          holderScope: targetTroop,
        }),
      });
      for (const runtime of hero.skillStates) {
        if (!runtime.enabled) continue;
        const related = definitions.get(runtime.skillId);
        for (const markedEffect of related?.levelValues[runtime.level]?.effects ?? []) {
          if (
            markedEffect.kind !== "markedTargetDamageIncrease" ||
            markedEffect.markId !== effect.markId
          ) continue;
          const sourceTroops = markedEffect.scope.source === "army"
            ? undefined
            : [markedEffect.scope.source];
          output.push({
            side: targetSide,
            targetTroop,
            effect: createActiveEffect({
              identity: {
                sourceId: mechanic.duplicateSourceStacking
                  ? `hero:${ownerSide}:marked-target:${related!.id}:${targetSide}:${targetTroop}`
                  : `hero:${ownerSide}:${heroRuntimeId(hero)}:${hero.position}:marked-target:${targetSide}:${targetTroop}`,
                sourceSkillId: related!.id,
                effectId: markedEffect.id,
              },
              definition: {
                id: markedEffect.id,
                name: markedEffect.name,
                kind: "incomingDamageIncrease",
                group: markedEffect.group,
                value: markedEffect.value,
                ruleStatus: related!.metadata.ruleStatus,
                ...(sourceTroops === undefined ? {} : { scope: { sourceTroops } }),
                lifecycle: {
                  activationTiming: "nextRound",
                  durationRounds: 1,
                  refreshMode: "replace",
                },
              },
              appliedRound: round,
              holderScope: targetTroop,
            }),
          });
        }
      }
      continue;
    }
    if (!isCompilableActiveEffect(effect) || effect.kind === "targetingOverride") {
      continue;
    }
    const active = createActiveEffect({
      identity: {
        sourceId: `hero:${ownerSide}:${heroRuntimeId(hero)}:${hero.position}:after:${targetSide}:${targetTroop}`,
        sourceSkillId: decision.definition.id,
        effectId: effect.id,
      },
      definition: toActiveEffectDefinition(effect, decision.definition),
      appliedRound: round,
      holderScope:
        effect.scope.target === "currentTarget" ? targetTroop : "army",
    });
    const targetBound = effect.scope.target === "currentTarget" ||
      decision.definition.metadata.tags?.includes("hitTargetTroop");
    output.push(targetBound
      ? { side: targetSide, targetTroop, effect: active }
      : {
          side: effect.recipient === "selfArmy" ? ownerSide : otherSide(ownerSide),
          effect: active,
        });
  }
  void ownerBattleSide;
  return output;
}

function compileTemporaryShieldLayers(
  decision: HeroDecision,
  context: AdditionalDamageContext,
  hero: HeroState,
  existingLayers: readonly TemporaryShieldLayer[],
): TemporaryShieldLayer[] {
  const parent = context.primaryDamageEvent;
  return (decision.levelValue?.effects ?? []).flatMap((effect) => {
    if (effect.kind !== "temporaryShield") return [];
    if (
      effect.scope.source !== "army" &&
      effect.scope.source !== parent.sourceTroop
    ) return [];
    const id = `temporary-shield:${parent.sourceSide}:${parent.sourceTroop}:${decision.definition.id}${hero.position === "member" ? `:${heroRuntimeId(hero)}` : ""}`;
    const previousShield = existingLayers.find((layer) => layer.id === id &&
      layer.activeFromRound <= parent.round && parent.round <= layer.expiresAfterRound)
      ?.remainingShieldHp ?? 0;
    const gatotShield = effect.basis === "gatotReportAttackPower"
      ? (() => {
          if (parent.sourceTroop !== "shield" ||
              (decision.runtimeBefore.level !== 4 && decision.runtimeBefore.level !== 5)) {
            throw new RangeError("Gatot shield requires shield troops and expedition skill level 4 or 5.");
          }
          const source = sideFromState(context.snapshot, parent.sourceSide).troops.shield;
          return calculateGatotShield({
            skillLevel: decision.runtimeBefore.level,
            troopConstant: source.troopConstant,
            currentShieldCount: source.aliveCount,
            reportAttackBonus: source.attack,
            previousShield,
          });
        })()
      : undefined;
    const rawDamageBasis = effect.basis === "parentRawDamage" ? parent.rawDamage : undefined;
    if (gatotShield !== undefined && effect.coefficient !== gatotShield.shieldRatio) {
      throw new Error("Gatot shield level and configured ratio disagree.");
    }
    const generatedShieldHp = gatotShield === undefined
      ? parent.rawDamage * effect.coefficient
      : gatotShield.generatedShield;
    const durationRounds =
      effect.lifecycle?.durationRounds ??
      decision.levelValue?.durationRounds ??
      decision.definition.durationRounds ??
      1;
    const activeFromRound = parent.round +
      (effect.lifecycle?.activationTiming === "nextRound" ? 1 : 0);
    return [{
      id,
      sourceSkillId: decision.definition.id,
      sourceHeroId: heroDefinitionId(hero),
      sourceRuntimeInstanceId: heroRuntimeId(hero),
      ruleStatus: decision.definition.metadata.ruleStatus,
      ...(rawDamageBasis === undefined ? {} : { rawDamageBasis }),
      ...(gatotShield === undefined ? {} : { gatotShield }),
      generatedShieldHp,
      remainingShieldHp: generatedShieldHp,
      generatedRound: parent.round,
      generatedActionOrder: parent.actionOrder,
      activeFromRound,
      expiresAfterRound: activeFromRound + durationRounds - 1,
    }];
  });
}

function upsertTemporaryShield(
  current: readonly TemporaryShieldLayer[],
  incoming: TemporaryShieldLayer,
): readonly TemporaryShieldLayer[] {
  const index = current.findIndex((layer) => layer.id === incoming.id &&
    layer.activeFromRound === incoming.activeFromRound);
  return index < 0
    ? [...current, incoming]
    : current.map((layer, candidate) =>
        candidate === index ? incoming : layer
      );
}

function appendSkippedActionTrace(
  traces: HeroSkillTraceEntry[],
  state: BattleState,
  definitions: ReadonlyMap<string, HeroSkillDefinition>,
  status: ActiveEffect,
  skippedSide: SideId,
  skippedTroop: TroopType,
): void {
  const definition = definitions.get(status.identity.sourceSkillId);
  if (definition === undefined) return;
  for (const ownerSide of SIDE_IDS) {
    const hero = sideFromState(state, ownerSide).heroStates.find(
      (candidate) => heroDefinitionId(candidate) === definition.heroId &&
        status.identity.sourceId.startsWith(`hero:${ownerSide}:${heroRuntimeId(candidate)}:${candidate.position}`),
    );
    const runtime = hero?.skillStates.find(
      (candidate) => candidate.skillId === definition.id,
    );
    if (hero === undefined || runtime === undefined) continue;
    const sourceTroop =
      definition.actionMechanic?.kind === "attackCountTrigger" &&
      definition.actionMechanic.schedule.source !== "army"
        ? definition.actionMechanic.schedule.source
        : skippedTroop;
    traces.push({
      ...toSyntheticTrace(
        state.round,
        ownerSide,
        hero,
        definition,
        runtime,
        sourceTroop,
        "skipNextRoundAction",
      ),
      targetTroop: skippedTroop,
      appliedDebuffTargetTroop: skippedTroop,
      stunTarget: skippedTroop,
      skippedRound: state.round,
      reason: `skipNextRoundAction:${skippedSide}.${skippedTroop}`,
    });
    return;
  }
}

function compileTargetBoundMarkDamageInputs(
  state: BattleState,
  definition: HeroSkillDefinition,
  context: AdditionalDamageContext,
  hero: HeroState,
): DamageEventInput[] {
  const mechanic = definition.actionMechanic;
  if (
    mechanic?.kind !== "targetBoundMark" ||
    (mechanic.schedule.source !== "army" &&
      mechanic.schedule.source !== context.action.troop)
  ) return [];
  const targetSide = context.primaryDamageEvent.targetSide;
  return TROOP_TYPES.flatMap((targetTroop) => {
    const troop = sideFromState(state, targetSide).troops[targetTroop];
    if (troop.aliveCount === 0) return [];
    const mark = troop.debuffs.find((effect) =>
      effect.definition.kind === "targetBoundMark" &&
      effect.definition.markId === mechanic.markId &&
      effect.identity.sourceSkillId === definition.id &&
      (mechanic.duplicateSourceStacking
        ? effect.identity.sourceId.startsWith(`hero:${context.action.side}:merged-mark:`)
        : effect.identity.sourceId.startsWith(`hero:${context.action.side}:${heroRuntimeId(hero)}:${hero.position}:`)) &&
      effect.appliedRound + mechanic.damageDelayRounds === state.round
    );
    if (mark === undefined) return [];
    if (mark.definition.kind !== "targetBoundMark") return [];
    const contributors = mark.definition.damageContributors;
    // Exactly one owner emits the merged payload; all owners retain their trigger traces/counters.
    if (contributors && contributors[0]?.runtimeInstanceId !== heroRuntimeId(hero)) return [];
    const coefficient = contributors ? targetMarkDamageCoefficient(
      contributors.map((source) => source.coefficient), mark.definition.additionalSourceCoefficient,
    ) : mechanic.damageCoefficient;
    const parent = context.primaryDamageEvent;
    return [{
      id: `${parent.id}:hero:${definition.id}${hero.position === "member" ?
        `:instance:${heroRuntimeId(hero)}` : ""}:mark:${mechanic.markId}:target:${targetTroop}`,
      sourceSide: parent.sourceSide,
      sourceTroop: parent.sourceTroop,
      targetSide,
      targetTroop,
      damageType: "skillDamage" as const,
      damageSubtype: "extraDamage" as const,
      baseDamage: parent.baseDamage * coefficient,
      damageBasis: "parentBaseDamage",
      skillCoefficient: coefficient,
      sourceSkillId: definition.id,
      parentEventId: parent.id,
      rootEventId: parent.rootEventId,
      depth: parent.depth + 1,
      round: parent.round,
      actionOrder: parent.actionOrder,
    }];
  });
}

function compileDecayingEventEffects(
  state: BattleState,
  definitions: ReadonlyMap<string, HeroSkillDefinition>,
  runtimeUpdates: ReadonlyMap<string, HeroSkillRuntimeState>,
  input: DamageEventInput,
): ActiveEffect[] {
  const output: ActiveEffect[] = [];
  const side = sideFromState(state, input.sourceSide);
  for (const hero of side.heroStates) {
    for (const originalRuntime of hero.skillStates) {
      const definition = definitions.get(originalRuntime.skillId);
      if (definition === undefined) continue;
      const runtime = runtimeUpdates.get(
        runtimeKey(input.sourceSide, heroRuntimeId(hero), definition.id),
      ) ?? originalRuntime;
      if (!runtime.enabled) continue;
      for (const effect of definition.levelValues[runtime.level]?.effects ?? []) {
        if (effect.kind !== "decayingDamageIncrease") continue;
        const initial = effect.initialValues[input.sourceTroop];
        const count = Math.max(0, runtime.mainAttackCounts[input.sourceTroop] -
          (input.parentEventId === undefined ? 0 : 1));
        if (initial === undefined || count >= effect.maxMainAttacks) continue;
        output.push(createActiveEffect({
          identity: {
            sourceId: `hero:${input.sourceSide}:${heroRuntimeId(hero)}:${hero.position}:decay:${input.sourceTroop}:${count}`,
            sourceSkillId: definition.id,
            effectId: effect.id,
          },
          definition: {
            id: effect.id,
            name: effect.name,
            kind: "damageIncrease",
            group: effect.group,
            value: initial * effect.decayFactor ** count,
            ruleStatus: definition.metadata.ruleStatus,
            scope: {
              sourceTroops: [input.sourceTroop],
            },
          },
          appliedRound: state.round,
          holderScope: "army",
        }));
      }
    }
  }
  return output;
}

function createDodgeCancellationEffect(
  side: SideId,
  hero: HeroState,
  definition: HeroSkillDefinition,
  round: number,
  sourceTroop: TroopType,
  targetTroop: TroopType,
): ActiveEffect {
  return createActiveEffect({
    identity: {
      sourceId: `hero:${side}:${heroRuntimeId(hero)}:${hero.position}:dodge:${round}:${sourceTroop}`,
      sourceSkillId: definition.id,
      effectId: `${definition.id}.cancel-hit`,
    },
    definition: {
      id: `${definition.id}.cancel-hit`,
      name: `${definition.name}·闪避`,
      kind: "directDamageCancellation",
      group: "dodgeNormalAttack",
      value: 1,
      ruleStatus: definition.metadata.ruleStatus,
      scope: {
        sourceTroops: [sourceTroop],
        targetTroops: [targetTroop],
        damageTypes: ["normalAttack"],
      },
    },
    appliedRound: round,
    holderScope: targetTroop,
  });
}

function queueArmyEffect(
  effects: Map<SideId, readonly ActiveEffect[]>,
  side: SideId,
  effect: ActiveEffect,
): void {
  effects.set(side, upsertActiveEffect(effects.get(side) ?? [], effect));
}

function isOutgoingEventEffect(effect: ActiveEffect): boolean {
  return effect.definition.kind === "damageIncrease" ||
    effect.definition.kind === "outgoingDamageReduction" ||
    (effect.definition.kind === "attributeModifier" &&
      (effect.definition.attribute === "attack" || effect.definition.attribute === "penetration"));
}

function isIncomingEventEffect(effect: ActiveEffect): boolean {
  return effect.definition.kind === "damageReduction" ||
    effect.definition.kind === "incomingDamageIncrease" ||
    effect.definition.kind === "defenseModifier" ||
    effect.definition.kind === "defenseReduction" ||
    effect.definition.kind === "directDamageCancellation" ||
    (effect.definition.kind === "attributeModifier" && effect.definition.attribute === "defense") ||
    (effect.definition.kind === "attributeReduction" && effect.definition.attribute === "defense");
}

function appendProducedDamageIds(
  traces: HeroSkillTraceEntry[],
  side: SideId,
  skillId: string,
  ids: readonly string[],
  parentEventId?: string,
  runtimeInstanceId?: string,
): void {
  if (ids.length === 0) return;
  let index = -1;
  for (let candidate = traces.length - 1; candidate >= 0; candidate -= 1) {
    const trace = traces[candidate]!;
    if (trace.side === side && trace.skillId === skillId &&
      (runtimeInstanceId === undefined || trace.runtimeInstanceId === runtimeInstanceId)) {
      index = candidate;
      break;
    }
  }
  if (index < 0) return;
  const previous = traces[index]!;
  traces[index] = {
    ...previous,
    producedDamageEventIds: [...previous.producedDamageEventIds, ...ids],
    extraDamageEvents: [...(previous.extraDamageEvents ?? []), ...ids],
    ...(parentEventId === undefined ? {} : { parentEventId }),
  };
}

function toSyntheticTrace(
  round: number,
  side: SideId,
  hero: HeroState,
  definition: HeroSkillDefinition,
  runtime: HeroSkillRuntimeState,
  sourceTroop: TroopType,
  reason: string,
): HeroSkillTraceEntry {
  return {
    ...toTrace(
      round,
      side,
      hero,
      { ...syntheticTriggeredDecision(definition, runtime), reason },
      [],
      sourceTroop,
    ),
  };
}

function isCompilableActiveEffect(
  effect: HeroSkillEffect,
): effect is Extract<HeroSkillEffect, {
  readonly kind:
    | "attributeModifier"
    | "attributeReduction"
    | "defenseModifier"
    | "defenseReduction"
    | "damageIncrease"
    | "damageReduction"
    | "outgoingDamageReduction"
    | "incomingDamageIncrease"
    | "oneUseIncomingDamageIncrease"
    | "targetingOverride"
    | "skipNextRoundAction";
}> {
  return effect.kind !== "extraDamage" &&
    effect.kind !== "targetBoundMark" &&
    effect.kind !== "temporaryShield" &&
    effect.kind !== "markedTargetDamageIncrease" &&
    effect.kind !== "decayingDamageIncrease";
}

function decideTrigger(
  round: number,
  side: SideId,
  definition: HeroSkillDefinition,
  runtime: HeroSkillRuntimeState,
  config: HeroSkillSystemConfig,
  battleContext: BattleState["battleContext"],
  sourceTroop?: TroopType,
): HeroDecision {
  const levelValue = definition.levelValues[runtime.level];
  const probability = levelValue?.probability ?? definition.probability ?? null;
  const base = { definition, levelValue, runtimeBefore: runtime, probability };
  if (!runtime.enabled) return noTrigger(base, runtime, "disabled");
  if (levelValue === undefined) return noTrigger(base, runtime, "levelValueMissing");
  if (!isBattleContextAllowedForSide(
    definition.battleContexts,
    battleContext,
    side,
  )) {
    return noTrigger(base, runtime, "battleContextMismatch");
  }
  if (definition.trigger === "passive" && runtime.triggerCount > 0) {
    return noTrigger(base, runtime, "passiveAlreadyAttached");
  }
  if (
    levelValue.periodRounds !== undefined &&
    levelValue.periodStartRound !== undefined &&
    (round < levelValue.periodStartRound ||
      (round - levelValue.periodStartRound) % levelValue.periodRounds !== 0)
  ) {
    return noTrigger(base, runtime, "periodNotDue");
  }
  const override =
    (sourceTroop === undefined
      ? undefined
      : config.triggerOverrides?.[`${round}:${side}:${sourceTroop}:${definition.id}`]) ??
    (sourceTroop === undefined
      ? undefined
      : config.triggerOverrides?.[`${side}:${sourceTroop}:${definition.id}`]) ??
    config.triggerOverrides?.[`${round}:${side}:${definition.id}`] ??
    config.triggerOverrides?.[`${side}:${definition.id}`] ??
    config.triggerOverrides?.[definition.id];
  if (definition.metadata.ruleStatus === "RULE_UNKNOWN" && override === undefined) {
    return noTrigger(base, runtime, "RULE_UNKNOWN_requiresExplicitOverride");
  }
  let triggered = true;
  let rngRoll: number | null = null;
  let reason = "deterministic";
  if (override !== undefined) {
    triggered = override;
    reason = override ? "forcedTrigger" : "forcedNoTrigger";
  } else if (probability !== null) {
    if (config.randomSource === undefined) {
      throw new Error(`Hero skill ${definition.id} needs an injected RandomSource.`);
    }
    rngRoll = config.randomSource.next();
    if (!Number.isFinite(rngRoll) || rngRoll < 0 || rngRoll >= 1) {
      throw new RangeError("RandomSource.next() must return a value in [0, 1). ");
    }
    triggered = rngRoll < probability;
    reason = triggered ? "probabilityPassed" : "probabilityFailed";
  }
  const decision: HeroDecision = {
    ...base,
    rngRoll,
    eligible: true,
    triggered,
    reason,
    runtimeAfter: triggered
      ? {
          ...runtime,
          triggerCount: runtime.triggerCount + 1,
          lastTriggeredRound: round,
          remainingDuration:
            levelValue.durationRounds ?? definition.durationRounds ?? 0,
          cooldown: levelValue.cooldownRounds ?? definition.cooldownRounds ?? 0,
        }
      : runtime,
  };
  if (probability !== null) {
    config.onProbabilityDecision?.({
      side,
      skillId: definition.id,
      probability,
      triggered,
    });
  }
  return decision;
}

function noTrigger(
  base: Pick<HeroDecision, "definition" | "levelValue" | "runtimeBefore" | "probability">,
  runtime: HeroSkillRuntimeState,
  reason: string,
): HeroDecision {
  return {
    ...base,
    runtimeAfter: runtime,
    rngRoll: null,
    eligible: false,
    triggered: false,
    reason,
  };
}

function compileActiveEffects(
  decision: HeroDecision,
  side: SideId,
  hero: HeroState,
  round: number,
  sourceTroop?: TroopType,
): ActiveEffect[] {
  return (decision.levelValue?.effects ?? []).flatMap((effect) => {
    if (!isCompilableActiveEffect(effect)) return [];
    return [createActiveEffect({
      identity: {
        sourceId: `hero:${side}:${heroRuntimeId(hero)}:${hero.position}${sourceTroop === undefined ? "" : `:${sourceTroop}`}`,
        sourceSkillId: decision.definition.id,
        effectId: effect.id,
      },
      definition: toActiveEffectDefinition(effect, decision.definition),
      appliedRound: round,
      holderScope: "army",
    })];
  });
}

function compileHitTargetEffects(
  decision: HeroDecision,
  side: SideId,
  hero: HeroState,
  round: number,
  targetSide: SideId,
  targetTroop: TroopType,
): ActiveEffect[] {
  return (decision.levelValue?.effects ?? []).flatMap((effect) => {
    if (!isCompilableActiveEffect(effect) || effect.kind === "targetingOverride") return [];
    return [createActiveEffect({
      identity: decision.definition.procEffectFamilyId === undefined ? {
        sourceId: `hero:${side}:${heroRuntimeId(hero)}:${hero.position}:target:${targetSide}:${targetTroop}`,
        sourceSkillId: decision.definition.id,
        effectId: effect.id,
      } : {
        // Every source still rolls and updates its own runtime. Only the target
        // effect identity is shared, so the existing refresh policy keeps one.
        sourceId: `hero-family:${side}:${decision.definition.procEffectFamilyId}:target:${targetSide}:${targetTroop}`,
        sourceSkillId: decision.definition.procEffectFamilyId,
        effectId: `${effect.kind}:${"group" in effect ? effect.group : ""}:${"value" in effect ? effect.value : ""}`,
      },
      definition: toActiveEffectDefinition(effect, decision.definition),
      appliedRound: round,
      holderScope: targetTroop,
    })];
  });
}

function upsertHitTargetDebuff(
  effectsByTarget: Map<string, readonly ActiveEffect[]>,
  side: SideId,
  troop: TroopType,
  effect: ActiveEffect,
): ActiveEffect {
  const key = hitTargetKey(side, troop);
  const existing = (effectsByTarget.get(key) ?? []).find((candidate) => candidate.instanceId === effect.instanceId);
  if (existing?.definition.kind === "targetBoundMark" && effect.definition.kind === "targetBoundMark" &&
      effect.definition.damageContributors && existing.definition.damageContributors &&
      existing.appliedRound === effect.appliedRound) {
    const contributors = new Map([...existing.definition.damageContributors, ...effect.definition.damageContributors]
      .map((source) => [source.runtimeInstanceId, source]));
    effect = { ...effect, definition: { ...effect.definition, damageContributors: [...contributors.values()] } };
  }
  const effects = upsertActiveEffect(effectsByTarget.get(key) ?? [], effect);
  effectsByTarget.set(key, effects);
  return effects.find((candidate) => candidate.instanceId === effect.instanceId)!;
}

function consumeOneUseIncomingEffects(
  state: BattleState,
  queuedByTarget: ReadonlyMap<string, readonly ActiveEffect[]>,
  consumedByTarget: Map<string, Set<string>>,
  input: DamageEventInput,
  originRootByEffect: ReadonlyMap<string, string>,
): ActiveEffect[] {
  const key = hitTargetKey(input.targetSide, input.targetTroop);
  const consumed = consumedByTarget.get(key) ?? new Set<string>();
  const troop = sideFromState(state, input.targetSide).troops[input.targetTroop];
  const byId = new Map<string, ActiveEffect>();
  for (const effect of [
    ...troop.debuffs,
    ...(queuedByTarget.get(key) ?? []),
  ]) {
    if (
      effect.definition.kind !== "oneUseIncomingDamageIncrease" ||
      consumed.has(effect.instanceId) ||
      originRootByEffect.get(effect.instanceId) === (input.rootEventId ?? input.id) ||
      !isEffectActiveInRound(effect, input.round)
    ) continue;
    byId.set(effect.instanceId, effect);
  }
  const markers = [...byId.values()];
  if (markers.length === 0) return [];
  for (const marker of markers) consumed.add(marker.instanceId);
  consumedByTarget.set(key, consumed);
  return markers.flatMap((marker): ActiveEffect[] => {
    const definition = marker.definition;
    if (definition.kind !== "oneUseIncomingDamageIncrease") return [];
    return [{
      ...marker,
      definition: {
        ...definition,
        kind: "incomingDamageIncrease",
      },
    }];
  });
}

function compileExtraDamageInputs(
  decision: HeroDecision,
  context: AdditionalDamageContext,
  state: BattleState,
): DamageEventInput[] {
  const parent = context.primaryDamageEvent;
  return (decision.levelValue?.effects ?? []).flatMap((effect, index) => {
    if (effect.kind !== "extraDamage") return [];
    const sourceMatches = effect.scope.source === "army" ||
      effect.scope.source === parent.sourceTroop;
    const targetMatches = effect.scope.target === undefined ||
      effect.scope.target === "all" ||
      effect.scope.target === "currentTarget" ||
      effect.scope.target === "shield" ||
      effect.scope.target === "lancer" ||
      effect.scope.target === "marksman";
    if (!sourceMatches || !targetMatches) return [];
    const basis = effect.basis === "parentBaseDamage"
      ? parent.baseDamage
      : effect.basis === "parentRawDamage"
        ? parent.rawDamage
        : effect.basis === "parentModifiedDamage"
          ? parent.modifiedDamage
          : parent.finalDamage;
    const targets = effect.scope.target === "all"
      ? TROOP_TYPES.filter((troop) =>
          sideFromState(state, parent.targetSide).troops[troop].aliveCount > 0
        )
      : effect.scope.target === "shield" ||
          effect.scope.target === "lancer" ||
          effect.scope.target === "marksman"
        ? sideFromState(state, parent.targetSide).troops[effect.scope.target].aliveCount > 0
          ? [effect.scope.target]
          : []
        : [parent.targetTroop];
    return targets.map((targetTroop) => {
      const retargeted = targetTroop !== parent.targetTroop &&
        effect.basis === "parentBaseDamage";
      const sourceSide = sideFromState(state, parent.sourceSide);
      const attack = retargeted ? resolveTroopAttribute(
        sourceSide, parent.sourceTroop, "attack", state.round,
        { targetTroop, damageType: "skillDamage" },
      ) : undefined;
      const penetration = retargeted ? resolveTroopAttribute(
        sourceSide, parent.sourceTroop, "penetration", state.round,
        { targetTroop, damageType: "skillDamage" },
      ) : undefined;
      const targetBasis = attack !== undefined && penetration !== undefined
        ? calculateBaseTroopDamage({
            fixedInitialMinTroops: state.fixedInitialMinTroops,
            aliveCount: sourceSide.troops[parent.sourceTroop].aliveCount,
            damageCoefficient: sourceSide.troops[parent.sourceTroop].damageCoefficient,
            troopConstant: sourceSide.troops[parent.sourceTroop].troopConstant,
            attack: attack.effectiveValue,
            penetration: penetration.effectiveValue,
          }).damage * (parent.baseDamageFormula?.baseDamageMultiplier ?? 1)
        : basis;
      return {
      id: `${parent.id}:hero:${decision.definition.id}${decision.runtimeBefore.ownerRuntimeInstanceId === undefined ||
        decision.runtimeBefore.ownerRuntimeInstanceId === decision.definition.heroId ? "" :
          `:instance:${decision.runtimeBefore.ownerRuntimeInstanceId}`}:effect:${effect.id}:${index}:target:${targetTroop}`,
      sourceSide: parent.sourceSide,
      sourceTroop: parent.sourceTroop,
      targetSide: parent.targetSide,
      targetTroop,
      damageType: "skillDamage" as const,
      damageSubtype: "extraDamage" as const,
      baseDamage: targetBasis * effect.coefficient,
      skillCoefficient: effect.coefficient,
      ...(retargeted ? { attributeResolutions: [
            { attribute: "attack" as const, baseAttribute: attack!.baseValue,
              buffedAttribute: attack!.buffedValue, modifierGroups: attack!.groups,
              reductionGroups: attack!.reductionGroups,
              divisionFactor: attack!.reductionGroups.reduce((p, g) => p * g.divisionFactor, 1),
              finalAttribute: attack!.effectiveValue },
            { attribute: "penetration" as const, baseAttribute: penetration!.baseValue,
              buffedAttribute: penetration!.buffedValue, modifierGroups: penetration!.groups,
              reductionGroups: penetration!.reductionGroups,
              divisionFactor: penetration!.reductionGroups.reduce((p, g) => p * g.divisionFactor, 1),
              finalAttribute: penetration!.effectiveValue },
          ] }
        : parent.attributeResolutions === undefined ? {}
          : { attributeResolutions: parent.attributeResolutions.filter(
              (item) => item.attribute !== "defense") }),
      damageBasis: effect.basis,
      ...(parent.baseDamageFormula === undefined ? {} : {
        baseDamageFormula: {
          ...parent.baseDamageFormula,
          ...(retargeted ? {
            attackMultiplier: attack!.multiplier,
            penetrationMultiplier: penetration!.multiplier,
          } : {}),
        },
      }),
      sourceSkillId: decision.definition.id,
      parentEventId: parent.id,
      rootEventId: parent.rootEventId,
      depth: parent.depth + 1,
      round: parent.round,
      actionOrder: parent.actionOrder,
      };
    });
  });
}

function toActiveEffectDefinition(
  effect: Extract<HeroSkillEffect, {
    readonly kind:
      | "attributeModifier"
      | "attributeReduction"
      | "defenseModifier"
      | "defenseReduction"
      | "damageIncrease"
      | "damageReduction"
      | "outgoingDamageReduction"
      | "incomingDamageIncrease"
      | "oneUseIncomingDamageIncrease"
      | "targetingOverride"
      | "skipNextRoundAction";
  }>,
  skill: HeroSkillDefinition,
): EffectDefinition {
  const scope = toEffectScope(effect);
  const lifecycle = mergeLifecycle(effect.lifecycle, skill);
  const common = {
    id: effect.id,
    name: effect.name,
    ruleStatus: skill.metadata.ruleStatus,
    ...(scope === undefined ? {} : { scope }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
  };
  if (effect.kind === "targetingOverride") {
    return { ...common, kind: effect.kind, priority: effect.priority };
  }
  if (effect.kind === "skipNextRoundAction") {
    return { ...common, kind: effect.kind };
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
  if (effect.kind === "attributeReduction") {
    return {
      ...common,
      kind: effect.kind,
      attribute: effect.attribute,
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
  effect: Extract<HeroSkillEffect, {
    readonly kind:
      | "attributeModifier"
      | "attributeReduction"
      | "defenseModifier"
      | "defenseReduction"
      | "damageIncrease"
      | "damageReduction"
      | "outgoingDamageReduction"
      | "incomingDamageIncrease"
      | "oneUseIncomingDamageIncrease"
      | "targetingOverride"
      | "skipNextRoundAction";
  }>,
): EffectScope | undefined {
  const defensive =
    effect.kind === "damageReduction" ||
    effect.kind === "defenseModifier" ||
    effect.kind === "defenseReduction";
  const sourceTroops = defensive
    ? effect.scope.incomingSourceTroop === undefined
      ? undefined
      : [effect.scope.incomingSourceTroop]
    : effect.scope.source === "army"
      ? undefined
      : [effect.scope.source];
  const targetTroops =
    effect.scope.target === undefined ||
    effect.scope.target === "all" ||
    effect.scope.target === "currentTarget"
      ? undefined
      : [effect.scope.target];
  const damageTypes =
    effect.scope.damageType === undefined || effect.scope.damageType === "all"
      ? undefined
      : [effect.scope.damageType];
  if (sourceTroops === undefined && targetTroops === undefined && damageTypes === undefined) {
    return undefined;
  }
  return {
    ...(sourceTroops === undefined ? {} : { sourceTroops }),
    ...(targetTroops === undefined ? {} : { targetTroops }),
    ...(damageTypes === undefined ? {} : { damageTypes }),
  };
}

function mergeLifecycle(
  effectLifecycle: EffectLifecycle | undefined,
  skill: HeroSkillDefinition,
): EffectLifecycle | undefined {
  const duration = effectLifecycle?.durationRounds ?? skill.durationRounds;
  const activationTiming =
    effectLifecycle?.activationTiming ?? skill.activationTiming;
  if (
    effectLifecycle === undefined &&
    duration === undefined &&
    activationTiming === undefined
  ) {
    return undefined;
  }
  return {
    ...(effectLifecycle ?? {}),
    ...(duration === undefined ? {} : { durationRounds: duration }),
    ...(activationTiming === undefined ? {} : { activationTiming }),
  };
}

function applyEffectToRecipient(
  state: BattleState,
  ownerSide: SideId,
  recipient: HeroSkillEffect["recipient"],
  effect: ActiveEffect,
): BattleState {
  const recipientSide = recipient === "selfArmy" ? ownerSide : otherSide(ownerSide);
  const side = sideFromState(state, recipientSide);
  const armyEffects = upsertActiveEffect(side.armyEffects, effect);
  return replaceSide(state, recipientSide, { ...side, armyEffects });
}

function applyPrebattleHpModifiers(
  state: BattleState,
  sideId: SideId,
): BattleState {
  let side = sideFromState(state, sideId);
  for (const troopType of TROOP_TYPES) {
    const troop = side.troops[troopType];
    const resolvedLife = resolveTroopAttribute(
      side,
      troopType,
      "life",
      state.round,
      { targetTroop: troopType, damageType: "normalAttack" },
    );
    const maxHpPerUnit =
      troop.baseHpPerUnit *
      (1 + resolvedLife.effectiveValue);
    if (!Number.isFinite(maxHpPerUnit) || maxHpPerUnit <= 0) {
      throw new RangeError("Hero HP effects produced invalid maxHpPerUnit.");
    }
    side = replaceTroop(side, troopType, {
      ...troop,
      maxHpPerUnit,
      frontUnitHp: troop.aliveCount === 0 ? 0 : maxHpPerUnit,
    });
  }
  return replaceSide(state, sideId, side);
}

function validateRuntimeBindings(
  state: BattleState,
  definitions: ReadonlyMap<string, HeroSkillDefinition>,
  policy: HeroPositionActivationPolicy,
): void {
  for (const sideId of SIDE_IDS) {
    for (const hero of sideFromState(state, sideId).heroStates) {
      const ids = new Set<string>();
      for (const runtime of hero.skillStates) {
        validateHeroSkillRuntimeState(runtime);
        if (ids.has(runtime.skillId)) {
          throw new Error(`Duplicate hero runtime ${hero.heroId}:${runtime.skillId}.`);
        }
        ids.add(runtime.skillId);
        const definition = definitions.get(runtime.skillId);
        if (definition === undefined || definition.heroId !== heroDefinitionId(hero)) {
          throw new Error(`Invalid hero skill binding ${hero.heroId}:${runtime.skillId}.`);
        }
        const slots = hero.position === "leader"
          ? policy.leaderSkillSlots
          : policy.memberSkillSlots;
        if (
          !definition.positionRule.allowedPositions.includes(hero.position) ||
          (definition.positionRule.kind === "expeditionSkillSlot" &&
            !slots.includes(definition.positionRule.expeditionSkillSlot))
        ) {
          throw new Error(
            `Hero skill ${definition.id} is inactive at ${hero.position} position.`,
          );
        }
      }
    }
  }
}

function toTrace(
  round: number,
  side: SideId,
  hero: HeroState,
  decision: HeroDecision,
  activeEffects: readonly ActiveEffect[],
  sourceTroop?: TroopType,
): HeroSkillTraceEntry {
  return {
    round,
    ...(decision.definition.procEffectFamilyId === undefined ? {} : {
      procEffectFamilyId: decision.definition.procEffectFamilyId,
      familyEffectValue: (decision.levelValue?.effects ?? []).reduce((value, effect) =>
        effect.kind === "incomingDamageIncrease" ? effect.value : value, 0),
    }),
    side,
    ...(sourceTroop === undefined ? {} : { sourceTroop }),
    heroId: heroDefinitionId(hero),
    heroDefinitionId: heroDefinitionId(hero),
    runtimeInstanceId: heroRuntimeId(hero),
    skillId: decision.definition.id,
    ...(decision.definition.metadata.generation === undefined ? {} : { generation: decision.definition.metadata.generation }),
    ruleStatus: decision.definition.metadata.ruleStatus,
    ...(decision.definition.metadata.verificationStatus === undefined ? {} : { verificationStatus: decision.definition.metadata.verificationStatus }),
    ...(decision.definition.metadata.templateSource === undefined ? {} : { templateSource: decision.definition.metadata.templateSource }),
    skillName: decision.definition.name,
    uiSummary: getHeroSkillUiSummary(decision.definition),
    skillLevel: decision.runtimeBefore.level,
    skillVersion:
      decision.levelValue?.versionLabel ?? `L${decision.runtimeBefore.level}`,
    position: hero.position,
    weaponLevel: hero.weaponLevel,
    trigger: decision.definition.trigger,
    checked: true,
    eligible: decision.eligible,
    triggered: decision.triggered,
    probability: decision.probability,
    rngRoll: decision.rngRoll,
    procRoll: decision.rngRoll,
    procResult: decision.triggered,
    producedActiveEffectIds: activeEffects.map((effect) => effect.instanceId),
    producedDamageEventIds: [],
    activationTiming:
      decision.definition.activationTiming ?? "RULE_UNKNOWN",
    groups: effectGroups(decision.levelValue),
    appliedGroupValues: decision.triggered
      ? (decision.levelValue?.effects ?? []).flatMap((effect) =>
          "group" in effect && "value" in effect &&
          typeof effect.group === "string" && typeof effect.value === "number"
            ? [{ group: effect.group, value: effect.value }] : [])
      : [],
    damageIncrease: decision.triggered
      ? (decision.levelValue?.effects ?? []).reduce(
          (sum, effect) => sum +
            (effect.kind === "damageIncrease" ? effect.value : 0),
          0,
        )
      : 0,
    damageReduction: decision.triggered
      ? (decision.levelValue?.effects ?? []).reduce(
          (sum, effect) => sum +
            (effect.kind === "damageReduction" ? effect.value : 0),
          0,
        )
      : 0,
    reason: decision.reason,
    ...(decision.definition.metadata.tags?.includes("criticalNormalAttack")
      ? {
          criticalResult: decision.triggered,
          criticalMultiplier: 2,
        }
      : {}),
  };
}

function actionKey(side: SideId, troop: TroopType): string {
  return `${side}:${troop}`;
}

function hitTargetKey(side: SideId, troop: TroopType): string {
  return `${side}:${troop}`;
}

function traceInterval(
  effects: readonly ActiveEffect[],
): Pick<HeroSkillTraceEntry, "effectiveFromRound" | "expiresAfterRound"> {
  const effect = effects[0];
  if (effect === undefined) return {};
  const duration = effect.definition.lifecycle?.durationRounds;
  return {
    effectiveFromRound: effect.activeFromRound,
    ...(duration === undefined
      ? {}
      : { expiresAfterRound: effect.activeFromRound + duration - 1 }),
  };
}

function runtimeKey(side: SideId, heroId: string, skillId: string): string {
  return JSON.stringify([side, heroId, skillId]);
}

function setHeroRuntime(
  state: BattleState,
  sideId: SideId,
  heroId: string,
  runtime: HeroSkillRuntimeState,
): BattleState {
  const side = sideFromState(state, sideId);
  const heroIndex = side.heroStates.findIndex((hero) => heroRuntimeId(hero) === heroId);
  if (heroIndex < 0) throw new Error(`Missing hero runtime owner: ${heroId}.`);
  const hero = side.heroStates[heroIndex]!;
  const skillIndex = hero.skillStates.findIndex(
    (candidate) => candidate.skillId === runtime.skillId,
  );
  if (skillIndex < 0) throw new Error(`Missing hero skill runtime: ${runtime.skillId}.`);
  const skillStates = hero.skillStates.map((candidate, index) =>
    index === skillIndex ? runtime : candidate,
  );
  const heroStates = side.heroStates.map((candidate, index) =>
    index === heroIndex ? { ...hero, skillStates } : candidate,
  );
  return replaceSide(state, sideId, { ...side, heroStates });
}

function toReservedTrace(
  round: number,
  side: SideId,
  hero: HeroState,
  definition: HeroSkillDefinition,
  runtime: HeroSkillRuntimeState,
): HeroSkillTraceEntry {
  return {
    round,
    side,
    heroId: heroDefinitionId(hero),
    heroDefinitionId: heroDefinitionId(hero),
    runtimeInstanceId: heroRuntimeId(hero),
    skillId: definition.id,
    ...(definition.metadata.generation === undefined ? {} : { generation: definition.metadata.generation }),
    ruleStatus: definition.metadata.ruleStatus,
    ...(definition.metadata.verificationStatus === undefined ? {} : { verificationStatus: definition.metadata.verificationStatus }),
    ...(definition.metadata.templateSource === undefined ? {} : { templateSource: definition.metadata.templateSource }),
    skillName: definition.name,
    uiSummary: getHeroSkillUiSummary(definition),
    skillLevel: runtime.level,
    skillVersion: definition.levelValues[runtime.level]?.versionLabel ?? `L${runtime.level}`,
    position: hero.position,
    weaponLevel: hero.weaponLevel,
    trigger: definition.trigger,
    checked: true,
    eligible: false,
    triggered: false,
    probability:
      definition.levelValues[runtime.level]?.probability ??
      definition.probability ??
      null,
    rngRoll: null,
    procRoll: null,
    procResult: false,
    producedActiveEffectIds: [],
    producedDamageEventIds: [],
    activationTiming: definition.activationTiming ?? "RULE_UNKNOWN",
    groups: effectGroups(definition.levelValues[runtime.level]),
    reason: "TRIGGER_RESERVED_NOT_IMPLEMENTED",
  };
}

function effectGroups(
  levelValue: HeroSkillLevelValue | undefined,
): readonly string[] {
  return [...new Set((levelValue?.effects ?? []).flatMap((effect) =>
    effect.kind === "targetingOverride" ||
      effect.kind === "extraDamage" ||
      effect.kind === "targetBoundMark" ||
      effect.kind === "temporaryShield" ||
      effect.kind === "skipNextRoundAction"
      ? []
      : effect.kind === "markedTargetDamageIncrease" ||
          effect.kind === "decayingDamageIncrease"
        ? [effect.group]
        : [effect.group],
  ))];
}

function replaceHeroStates(
  state: BattleState,
  sideId: SideId,
  heroStates: readonly HeroState[],
): BattleState {
  const side = sideFromState(state, sideId);
  return replaceSide(state, sideId, { ...side, heroStates });
}

function replaceSide(
  state: BattleState,
  sideId: SideId,
  side: BattleSide,
): BattleState {
  return sideId === "A" ? { ...state, sideA: side } : { ...state, sideB: side };
}
