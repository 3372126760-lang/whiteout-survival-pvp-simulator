import { DEFAULT_ACTION_ORDER } from "../constants";
import { createDamageEvent } from "../damage";
import { isEffectActiveInRound, matchesEffectScope, resolveTroopAttribute } from "../effects";
import { calculateBaseTroopDamage } from "../formulas";
import {
  createActivatedLancerSurpriseEffect,
  selectTarget,
} from "../targeting";
import {
  otherSide,
  type ActionSlot,
  type SideId,
  type TroopType,
} from "../types/combat";
import {
  sideFromState,
  type BattleState,
  type RoundStartSnapshot,
} from "../types/battle";
import type {
  AppliedAttributeEffect,
  AttributeResolutionTrace,
  DamageEvent,
  DamageEventInput,
} from "../types/damage";
import type {
  ActiveAttributeModifierEffect,
  ActiveEffect,
} from "../types/effect";
import type { CasualtyRoundingStrategy } from "../strategies";
import { assertSnapshotMatchesState } from "./snapshot";

export interface AdditionalDamageContext {
  readonly snapshot: RoundStartSnapshot;
  readonly action: ActionSlot;
  readonly primaryDamageEvent: DamageEvent;
  readonly hitCancelled: boolean;
}

export interface MainAttackStartContext {
  readonly snapshot: RoundStartSnapshot;
  readonly action: ActionSlot;
}

export interface MainAttackHitContext extends MainAttackStartContext {
  readonly targetSide: SideId;
  readonly targetTroop: TroopType;
}

export interface MainAttackCompletedContext extends MainAttackHitContext {
  readonly primaryDamageEvent: DamageEvent;
  readonly hitCancelled: boolean;
}

export interface MainAttackStartDecision {
  readonly skip: boolean;
  readonly reason?: string;
}

export interface MainAttackHitDecision {
  readonly cancelHit: boolean;
  readonly transientEffects?: readonly ActiveEffect[];
  readonly reason?: string;
}

/** Action-level mechanics such as skip, dodge and normal-main-attack counters. */
export interface MainAttackLifecycleProvider {
  readonly id: string;
  readonly beforeMainAttack?: (
    context: MainAttackStartContext,
  ) => MainAttackStartDecision;
  readonly beforeHit?: (
    context: MainAttackHitContext,
  ) => MainAttackHitDecision;
  /** Resolve attack-attempt procs before a defender's dodge roll. */
  readonly beforeDodge?: (context: MainAttackHitContext) => void;
  /** Resolve hit-dependent procs only when the main normal attack survives dodge. */
  readonly afterDodge?: (context: MainAttackHitContext) => void;
  readonly afterMainAttack?: (
    context: MainAttackCompletedContext,
  ) => void;
}

/**
 * Safe extension point for skill/extraDamage trigger chains. It may only enqueue
 * more events; it cannot mutate troop counts during ActionPhase.
 */
export interface AdditionalDamageGenerator {
  readonly id: string;
  readonly beforeDodge?: (context: MainAttackHitContext) => void;
  /** Only pre-dodge effects may emit damage after a cancelled main hit. */
  readonly runsAfterCancelledHit?: boolean;
  readonly afterNormalAttack: (
    context: AdditionalDamageContext,
  ) => readonly DamageEventInput[];
}

export interface TargetingEffectContext {
  readonly snapshot: RoundStartSnapshot;
  readonly action: ActionSlot;
}

export interface TargetingEffectProvider {
  readonly id: string;
  readonly beforeTargetSelection: (
    context: TargetingEffectContext,
  ) => readonly ActiveEffect[];
}

export interface DamageEventEffectContext {
  readonly snapshot: RoundStartSnapshot;
  readonly action: ActionSlot;
  readonly input: DamageEventInput;
}

export interface DamageEventEffectProvider {
  readonly id: string;
  readonly beforeDamageEvent: (
    context: DamageEventEffectContext,
  ) => readonly ActiveEffect[];
}

export interface ActionPhaseOptions {
  /** Internal performance mode; full remains the default for audit runs. */
  readonly recordBattleLog?: boolean;
  readonly actionOrder?: readonly ActionSlot[];
  readonly additionalDamageGenerators?: readonly AdditionalDamageGenerator[];
  readonly targetingEffectProviders?: readonly TargetingEffectProvider[];
  readonly damageEventEffectProviders?: readonly DamageEventEffectProvider[];
  readonly mainAttackLifecycleProviders?: readonly MainAttackLifecycleProvider[];
  readonly casualtyRoundingStrategy?: CasualtyRoundingStrategy;
  /** Legacy explicit debug/test switch; skill mode uses confirmed 20% RNG. */
  readonly ambushTriggered?: boolean | Readonly<Partial<Record<SideId, boolean>>>;
}

export interface ActionPhaseResult {
  readonly state: BattleState;
  readonly generatedEvents: readonly DamageEvent[];
}

export function runActionPhase(
  state: BattleState,
  snapshot: RoundStartSnapshot,
  options: ActionPhaseOptions = {},
): ActionPhaseResult {
  if (state.status !== "ready") {
    throw new Error("Cannot run actions for a completed battle.");
  }
  if (state.pendingDamageEvents.length > 0) {
    throw new Error("ActionPhase requires an empty pending damage queue.");
  }
  assertSnapshotMatchesState(snapshot, state);
  const generatedEvents: DamageEvent[] = [];
  const ids = new Set<string>();
  const actionOrder = options.actionOrder ?? DEFAULT_ACTION_ORDER;

  actionOrder.forEach((action, actionOrderIndex) => {
    const sourceSide = sideFromState(snapshot, action.side);
    const sourceTroop = sourceSide.troops[action.troop];
    if (sourceTroop.aliveCount === 0) return;
    const startDecisions = (options.mainAttackLifecycleProviders ?? []).map(
      (provider) => {
        if (!provider.id) throw new Error("Main-attack provider id cannot be empty.");
        return provider.beforeMainAttack?.({ snapshot, action }) ?? { skip: false };
      },
    );
    if (startDecisions.some((decision) => decision.skip)) return;
    const targetSide = otherSide(action.side);
    const providedTargetingEffects = (
      options.targetingEffectProviders ?? []
    ).flatMap((provider) => {
      if (!provider.id) throw new Error("Targeting effect provider id cannot be empty.");
      return provider.beforeTargetSelection({ snapshot, action });
    });
    const targetingEffects = [
      ...sourceSide.armyEffects,
      ...sourceTroop.buffs,
      ...sourceTroop.debuffs,
      ...providedTargetingEffects,
      ...(action.troop === "lancer" &&
      isAmbushTriggered(options.ambushTriggered, action.side)
        ? [
            createActivatedLancerSurpriseEffect(
              `debug-ambush:${action.side}`,
              "debug-explicit-ambush",
              snapshot.round,
            ),
          ]
        : []),
    ];
    const selection = selectTarget(
      action.troop,
      snapshot,
      targetSide,
      targetingEffects,
    );
    if (selection.targetTroop === null) return;
    const hitContext: MainAttackHitContext = {
      snapshot,
      action,
      targetSide,
      targetTroop: selection.targetTroop,
    };
    for (const provider of options.mainAttackLifecycleProviders ?? []) {
      provider.beforeDodge?.(hitContext);
    }
    const additionalDrafts: DamageEventInput[] = [];
    for (const generator of options.additionalDamageGenerators ?? []) {
      generator.beforeDodge?.(hitContext);
    }
    const hitDecisions = (options.mainAttackLifecycleProviders ?? []).map(
      (provider) => provider.beforeHit?.(hitContext) ?? { cancelHit: false },
    );
    const hitCancelled = hitDecisions.some((decision) => decision.cancelHit);
    if (!hitCancelled) {
      for (const provider of options.mainAttackLifecycleProviders ?? []) {
        provider.afterDodge?.(hitContext);
      }
    }
    const controlEffects = hitDecisions.flatMap(
      (decision) => decision.transientEffects ?? [],
    );
    const sourceWithActionEffects = providedTargetingEffects.length === 0
      ? sourceSide
      : {
          ...sourceSide,
          armyEffects: [...sourceSide.armyEffects, ...providedTargetingEffects],
        };
    const effectiveAttack = resolveTroopAttribute(
      sourceWithActionEffects,
      action.troop,
      "attack",
      snapshot.round,
      { targetTroop: selection.targetTroop, damageType: "normalAttack" },
    );
    const effectivePenetration = resolveTroopAttribute(
      sourceWithActionEffects,
      action.troop,
      "penetration",
      snapshot.round,
      { targetTroop: selection.targetTroop, damageType: "normalAttack" },
    );
    const baseDamage = calculateBaseTroopDamage({
      fixedInitialMinTroops: snapshot.fixedInitialMinTroops,
      aliveCount: sourceTroop.aliveCount,
      damageCoefficient: sourceTroop.damageCoefficient,
      troopConstant: sourceTroop.troopConstant,
      penetration: effectivePenetration.effectiveValue,
      attack: effectiveAttack.effectiveValue,
    });
    const baseDamageGroups = new Map<string, number>();
    const baseDamageSourceIds = new Map<string, string[]>();
    for (const effect of [
      ...sourceWithActionEffects.armyEffects,
      ...sourceTroop.buffs,
      ...sourceTroop.debuffs,
    ]) {
      if (
        effect.definition.kind === "baseDamageMultiplier" &&
        isEffectActiveInRound(effect, snapshot.round) &&
        matchesEffectScope(effect.definition.scope, {
          sourceSide: action.side,
          sourceTroop: action.troop,
          targetSide,
          targetTroop: selection.targetTroop,
          damageType: "normalAttack",
          damageSubtype: "normalAttack",
          round: snapshot.round,
          actionOrder: actionOrderIndex,
        })
      ) {
        baseDamageGroups.set(
          effect.definition.group,
          (baseDamageGroups.get(effect.definition.group) ?? 0) +
            effect.definition.value * effect.stackCount,
        );
        baseDamageSourceIds.set(effect.definition.group, [
          ...(baseDamageSourceIds.get(effect.definition.group) ?? []),
          effect.instanceId,
        ]);
      }
    }
    const baseDamageMultiplier = [...baseDamageGroups.values()].reduce(
      (product, value) => product * (1 + value), 1,
    );
    const primaryInput: DamageEventInput = {
        id: `round:${snapshot.round}:action:${actionOrderIndex}:${action.side}:${action.troop}:normal`,
        sourceSide: action.side,
        sourceTroop: action.troop,
        targetSide,
        targetTroop: selection.targetTroop,
        damageType: "normalAttack",
        damageSubtype: "normalAttack",
        baseDamage: baseDamage.damage * baseDamageMultiplier,
        baseDamageFormula: {
          fixedInitialMinTroops: snapshot.fixedInitialMinTroops,
          aliveCount: sourceTroop.aliveCount,
          ...baseDamage.factors,
          baseDamageMultiplier,
          specialGroups: [...baseDamageGroups].map(([group, summedValue]) => ({
            group,
            summedValue,
            multiplier: 1 + summedValue,
            effectInstanceIds: baseDamageSourceIds.get(group) ?? [],
          })),
        },
        baseDamageAttributeEffects: [
          ...effectiveAttack.effects.map(toAppliedAttributeEffect),
          ...effectivePenetration.effects.map(toAppliedAttributeEffect),
        ],
        attributeResolutions: [
          toAttributeResolutionTrace("attack", effectiveAttack),
          toAttributeResolutionTrace("penetration", effectivePenetration),
        ],
        round: snapshot.round,
        actionOrder: actionOrderIndex,
      };
    const createdPrimary = createEventWithProviders(
      primaryInput,
      snapshot,
      action,
      options,
      controlEffects,
      hitCancelled,
    );
    const primary: DamageEvent = {
      ...createdPrimary,
      primaryRoundedDamage: createdPrimary.roundedDamage,
      mainHitCancelled: hitCancelled,
    };
    addUniqueEvent(primary, ids, generatedEvents);

    for (const provider of options.mainAttackLifecycleProviders ?? []) {
      provider.afterMainAttack?.({
        ...hitContext,
        primaryDamageEvent: primary,
        hitCancelled,
      });
    }

    for (const generator of options.additionalDamageGenerators ?? []) {
      if (hitCancelled && generator.runsAfterCancelledHit !== true) continue;
      if (!generator.id) throw new Error("Damage generator id cannot be empty.");
      const drafts = generator.afterNormalAttack({
        snapshot,
        action,
        primaryDamageEvent: primary,
        hitCancelled,
      });
      additionalDrafts.push(...drafts);
    }
    const poolKey = (draft: DamageEventInput): string | null =>
      draft.damageType === "skillDamage" && draft.damageSubtype === "extraDamage" &&
      draft.damageBasis === "parentBaseDamage" && draft.parentEventId === primary.id
        ? `${draft.sourceSide}:${draft.sourceTroop}:${draft.targetSide}:${draft.targetTroop}:${draft.actionOrder}`
        : null;
    const pools = new Map<string, DamageEventInput[]>();
    for (const draft of additionalDrafts) {
      const key = poolKey(draft);
      if (key !== null) pools.set(key, [...(pools.get(key) ?? []), draft]);
    }
    const emittedPools = new Set<string>();
    for (const draft of additionalDrafts) {
      const key = poolKey(draft);
      if (key !== null && emittedPools.has(key)) continue;
      if (key !== null) emittedPools.add(key);
      const members = key === null ? [draft] : pools.get(key)!;
      const pooledDraft: DamageEventInput = members.length === 1 ? draft : {
        ...draft,
        baseDamage: members.reduce((sum, member) => sum + member.baseDamage, 0),
        skillCoefficient: members.reduce((sum, member) =>
          sum + (member.skillCoefficient ??
            (primary.baseDamage === 0 ? 0 : member.baseDamage / primary.baseDamage)), 0),
        skillPoolComponents: members.map((member) => ({
          id: member.id,
          sourceSkillId: member.sourceSkillId ?? "unknown",
          coefficient: member.skillCoefficient ??
            (primary.baseDamage === 0 ? 0 : member.baseDamage / primary.baseDamage),
          baseDamage: member.baseDamage,
        })),
      };
      const event = createEventWithProviders(pooledDraft, snapshot, action, options);
      if (draft.sameMainAttackSegment === true) {
          const primaryIndex = generatedEvents.findIndex((candidate) => candidate.id === primary.id);
          if (primaryIndex < 0 || event.sourceSkillId === undefined) {
            throw new Error("Same-main-attack segment requires its primary event and skill source.");
          }
          generatedEvents[primaryIndex] = mergeMainAttackSegment(generatedEvents[primaryIndex]!, event);
      } else {
        addUniqueEvent(event, ids, generatedEvents);
      }
    }
  });

  const aliveCounts = {
    A: {
      shield: snapshot.sideA.troops.shield.aliveCount,
      lancer: snapshot.sideA.troops.lancer.aliveCount,
      marksman: snapshot.sideA.troops.marksman.aliveCount,
    },
    B: {
      shield: snapshot.sideB.troops.shield.aliveCount,
      lancer: snapshot.sideB.troops.lancer.aliveCount,
      marksman: snapshot.sideB.troops.marksman.aliveCount,
    },
  };
  return {
    generatedEvents,
    state: {
      ...state,
      pendingDamageEvents: generatedEvents,
      battleLog: options.recordBattleLog === false ? state.battleLog : [
        ...state.battleLog,
        { type: "roundStart", round: state.round, aliveCounts },
        ...generatedEvents.map((event) => ({
          type: "damageQueued" as const,
          round: state.round,
          event,
        })),
      ],
    },
  };
}

function mergeMainAttackSegment(primary: DamageEvent, segment: DamageEvent): DamageEvent {
  if (primary.rootEventId !== segment.rootEventId || primary.targetTroop !== segment.targetTroop) {
    throw new Error("Same-main-attack segment must inherit root and target.");
  }
  const roundedDamage = primary.roundedDamage + segment.roundedDamage;
  return {
    ...primary,
    baseDamage: primary.baseDamage + segment.baseDamage,
    rawDamage: primary.rawDamage + segment.rawDamage,
    modifiedDamage: primary.modifiedDamage + segment.modifiedDamage,
    roundedDamage,
    finalDamage: roundedDamage,
    internalSegments: [
      ...(primary.internalSegments ?? []),
      {
        sourceSkillId: segment.sourceSkillId!,
        basis: segment.baseDamage,
        rawDamage: segment.rawDamage,
        modifiedDamage: segment.modifiedDamage,
        roundedDamage: segment.roundedDamage,
      },
    ],
  };
}

function toAttributeResolutionTrace(
  attribute: "attack" | "penetration",
  resolved: ReturnType<typeof resolveTroopAttribute>,
): AttributeResolutionTrace {
  return {
    attribute,
    baseAttribute: resolved.baseValue,
    buffedAttribute: resolved.buffedValue,
    modifierGroups: resolved.groups,
    reductionGroups: resolved.reductionGroups,
    divisionFactor: resolved.reductionGroups.reduce(
      (product, group) => product * group.divisionFactor,
      1,
    ),
    finalAttribute: resolved.effectiveValue,
  };
}

function createEventWithProviders(
  input: DamageEventInput,
  snapshot: RoundStartSnapshot,
  action: ActionSlot,
  options: ActionPhaseOptions,
  controlEffects: readonly ActiveEffect[] = [],
  skipEventProviders = false,
): DamageEvent {
  const transientEffects = [
    ...controlEffects,
    ...(skipEventProviders
      ? []
      : (options.damageEventEffectProviders ?? []).flatMap((provider) => {
          if (!provider.id) {
            throw new Error("Damage event effect provider id cannot be empty.");
          }
          return provider.beforeDamageEvent({ snapshot, action, input });
        })),
  ];
  return createDamageEvent(input, snapshot, {
    transientEffects,
    ...(options.casualtyRoundingStrategy === undefined
      ? {}
      : { damageRoundingStrategy: options.casualtyRoundingStrategy }),
  });
}

function toAppliedAttributeEffect(
  effect: ActiveAttributeModifierEffect,
): AppliedAttributeEffect {
  return {
    instanceId: effect.instanceId,
    effectId: effect.definition.id,
    effectName: effect.definition.name,
    sourceId: effect.identity.sourceId,
    sourceSkillId: effect.identity.sourceSkillId,
    attribute: effect.definition.attribute,
    operation: effect.definition.operation,
    group: effect.definition.group,
    valuePerStack: effect.definition.value,
    stackCount: effect.stackCount,
    effectiveValue: effect.definition.value * effect.stackCount,
  };
}

function isAmbushTriggered(
  option: ActionPhaseOptions["ambushTriggered"],
  side: SideId,
): boolean {
  if (typeof option === "boolean") return option;
  return option?.[side] ?? false;
}

function addUniqueEvent(
  event: DamageEvent,
  ids: Set<string>,
  output: DamageEvent[],
): void {
  if (ids.has(event.id)) throw new Error(`Duplicate damage event id: ${event.id}.`);
  ids.add(event.id);
  output.push(event);
}
