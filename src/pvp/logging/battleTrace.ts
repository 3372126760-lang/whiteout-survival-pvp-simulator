import { SIDE_IDS, TROOP_TYPES, type SideId, type TroopType } from "../types/combat";
import type {
  BattleState,
  RoundStartSnapshot,
} from "../types/battle";
import type { DamageEvent } from "../types/damage";
import type {
  MixedLevelTargetCasualtyResolution,
  TargetCasualtyResolution,
} from "../casualty/resolvePendingDamage";
import type { TroopSkillTraceEntry } from "../troopSkills/types";
import type { HeroSkillTraceEntry } from "../heroSkills/types";
import type { HeroStatCorrection } from "../heroSkills/heroStatCorrection";
import type { TroopLevelCompositionEntry, TroopState } from "../types/troop";
import type { MixedLevelCasualtyAllocationEntry } from "../strategies";
import { traceProcEffectFamilies, type ProcEffectFamilyTrace } from "./procEffectFamilies";

export interface TraceTroopState {
  readonly aliveCount: number;
  readonly totalAliveCount: number;
  readonly frontUnitHp: number;
  readonly maxHpPerUnit: number;
  readonly levelCompositionAtRoundStart: readonly TroopLevelCompositionEntry[];
  readonly effectiveTroopConstant: number;
  readonly weightedConstantNumerator: number;
}

export type TraceSideState = Readonly<Record<TroopType, TraceTroopState>>;

export interface RoundEndTroopTrace extends TraceTroopState {
  readonly side: SideId;
  readonly troop: TroopType;
  readonly receivedDamage: number;
  readonly resolvedDamage: number;
  readonly absorbedDamage: number;
  readonly discardedOverflowDamage: number;
  readonly originalFrontUnitHp: number;
  readonly casualties: number;
  readonly totalDeaths: number;
  readonly casualtyAllocationStrategy: string;
  readonly casualtyAllocationRuleUnknown?:
    "mixedLevelCasualtyIntegerAllocation";
  readonly casualtyAllocationRoundingDifference: { readonly deaths: number; readonly survivors: number };
  readonly casualtyAllocationByLevel:
    readonly MixedLevelCasualtyAllocationEntry[];
  readonly levelCompositionAtRoundEnd:
    readonly TroopLevelCompositionEntry[];
}

export interface RoundDamageEventTrace extends DamageEvent {
  readonly appliedDamage: number;
  readonly hpAppliedDamage: number;
  readonly overflowDiscarded: number;
  readonly temporaryShield: TargetCasualtyResolution["temporaryShieldApplications"];
  readonly temporaryShieldAbsorbed: number;
}

export interface RoundBattleTrace {
  readonly round: number;
  readonly roundStart: {
    readonly fixedInitialMinTroops: number;
    readonly battleContext: BattleState["battleContext"];
    readonly sides: Readonly<Record<SideId, TraceSideState>>;
  };
  readonly damageEvents: readonly RoundDamageEventTrace[];
  readonly troopSkills: readonly TroopSkillTraceEntry[];
  readonly heroSkills: readonly HeroSkillTraceEntry[];
  readonly procEffectFamilies?: readonly ProcEffectFamilyTrace[];
  readonly roundEnd: {
    readonly troops: readonly RoundEndTroopTrace[];
    readonly battleStatus: BattleState["status"];
  };
}

export interface BattleTrace {
  readonly heroStatCorrections?: Readonly<Partial<Record<SideId, HeroStatCorrection>>>;
  readonly rounds: readonly RoundBattleTrace[];
  readonly endReason: "elimination" | "roundLimit";
  readonly finalStatus: BattleState["status"];
}

export function createRoundBattleTrace(
  snapshot: RoundStartSnapshot,
  events: readonly DamageEvent[],
  stateAfter: BattleState,
  casualtyResolutions: readonly TargetCasualtyResolution[],
  mixedLevelCasualties: readonly MixedLevelTargetCasualtyResolution[],
  troopSkills: readonly TroopSkillTraceEntry[] = [],
  heroSkills: readonly HeroSkillTraceEntry[] = [],
): RoundBattleTrace {
  const tracedEvents = events.map((event): RoundDamageEventTrace => {
    const resolution = casualtyResolutions.find((candidate) =>
      candidate.sourceEvents.some((sourceEvent) => sourceEvent.id === event.id),
    );
    if (resolution === undefined) {
      throw new Error(`BattleTrace is missing resolution for event ${event.id}.`);
    }
    return {
      ...event,
      appliedDamage: resolution.absorbedDamage,
      hpAppliedDamage: resolution.absorbedDamage -
        resolution.temporaryShieldApplications.reduce((sum, shield) => sum + shield.absorbedDamage, 0),
      overflowDiscarded: resolution.discardedOverflowDamage,
      temporaryShield: resolution.temporaryShieldApplications,
      temporaryShieldAbsorbed: resolution.temporaryShieldApplications.reduce(
        (sum, shield) => sum + shield.absorbedDamage,
        0,
      ),
    };
  });
  const roundEndTroops: RoundEndTroopTrace[] = [];
  for (const sideId of SIDE_IDS) {
    const beforeSide = sideId === "A" ? snapshot.sideA : snapshot.sideB;
    const afterSide = sideId === "A" ? stateAfter.sideA : stateAfter.sideB;
    for (const troopType of TROOP_TYPES) {
      const before = beforeSide.troops[troopType];
      const after = afterSide.troops[troopType];
      const receivedDamageFromEvents = events
        .filter(
          (event) =>
            event.targetSide === sideId && event.targetTroop === troopType,
        )
        .reduce((sum, event) => sum + event.finalDamage, 0);
      const targetResolutions = casualtyResolutions.filter(
        (resolution) =>
          resolution.targetSide === sideId &&
          resolution.targetTroop === troopType,
      );
      const mixedLevelResolution = mixedLevelCasualties.find(
        (resolution) =>
          resolution.targetSide === sideId &&
          resolution.targetTroop === troopType,
      );
      if (mixedLevelResolution === undefined) {
        throw new Error(
          `BattleTrace is missing mixed-level resolution for ${sideId}.${troopType}.`,
        );
      }
      const receivedDamage = targetResolutions.reduce(
        (sum, resolution) => sum + resolution.incomingDamage,
        0,
      );
      if (
        targetResolutions.length <= 1 &&
        Math.abs(receivedDamage - receivedDamageFromEvents) > Number.EPSILON
      ) {
        throw new Error("BattleTrace damage total does not match resolved events.");
      }
      roundEndTroops.push({
        side: sideId,
        troop: troopType,
        receivedDamage,
        resolvedDamage: targetResolutions.reduce(
          (sum, resolution) => sum + resolution.resolvedDamage,
          0,
        ),
        absorbedDamage: targetResolutions.reduce(
          (sum, resolution) => sum + resolution.absorbedDamage,
          0,
        ),
        discardedOverflowDamage: targetResolutions.reduce(
          (sum, resolution) => sum + resolution.discardedOverflowDamage,
          0,
        ),
        originalFrontUnitHp: before.frontUnitHp,
        casualties: before.aliveCount - after.aliveCount,
        totalDeaths: mixedLevelResolution.totalDeaths,
        casualtyAllocationStrategy: mixedLevelResolution.strategyId,
        ...(mixedLevelResolution.ruleUnknown === undefined ? {} :
          { casualtyAllocationRuleUnknown: mixedLevelResolution.ruleUnknown }),
        casualtyAllocationRoundingDifference: mixedLevelResolution.roundingDifference,
        casualtyAllocationByLevel: mixedLevelResolution.allocations.map(
          (entry) => ({ ...entry }),
        ),
        levelCompositionAtRoundEnd: after.levelComposition.map(
          (entry) => ({ ...entry }),
        ),
        aliveCount: after.aliveCount,
        totalAliveCount: after.aliveCount,
        frontUnitHp: after.frontUnitHp,
        maxHpPerUnit: after.maxHpPerUnit,
        levelCompositionAtRoundStart: before.levelComposition.map(
          (entry) => ({ ...entry }),
        ),
        effectiveTroopConstant: after.troopConstant,
        weightedConstantNumerator: after.aliveCount * after.troopConstant,
      });
    }
  }
  return {
    round: snapshot.round,
    roundStart: {
      fixedInitialMinTroops: snapshot.fixedInitialMinTroops,
      battleContext: snapshot.battleContext,
      sides: {
        A: toTraceSide(snapshot.sideA.troops),
        B: toTraceSide(snapshot.sideB.troops),
      },
    },
    damageEvents: tracedEvents,
    troopSkills,
    heroSkills,
    ...(heroSkills.some((entry) => entry.procEffectFamilyId !== undefined)
      ? { procEffectFamilies: traceProcEffectFamilies(heroSkills) } : {}),
    roundEnd: {
      troops: roundEndTroops,
      battleStatus: stateAfter.status,
    },
  };
}

export function formatBattleTrace(trace: BattleTrace): string {
  const lines: string[] = [];
  for (const side of SIDE_IDS) {
    const correction = trace.heroStatCorrections?.[side];
    if (correction === undefined) continue;
    lines.push(`=== HeroStatCorrection ${side} ===`);
    lines.push(`reportHeroes=${correction.reportHeroIds.join(",") || "none"}`);
    lines.push(`simulationHeroes=${correction.simulationHeroIds.join(",") || "none"}`);
    for (const troop of TROOP_TYPES) {
      lines.push(
        `${troop}: reportHero=${formatStatVector(correction.reportHeroContribution[troop])}, simulationHero=${formatStatVector(correction.simulationHeroContribution[troop])}, reportWeapon=${formatStatVector(correction.reportWeaponContribution[troop])}, simulationWeapon=${formatStatVector(correction.simulationWeaponContribution[troop])}, delta=${formatStatVector(correction.delta[troop])}`,
      );
    }
  }
  for (const round of trace.rounds) {
    lines.push(
      `=== Round ${round.round} Start | N0=${formatNumber(round.roundStart.fixedInitialMinTroops)} ===`,
    );
    lines.push(`battleContext=${round.roundStart.battleContext}`);
    for (const side of SIDE_IDS) {
      for (const troop of TROOP_TYPES) {
        const state = round.roundStart.sides[side][troop];
        lines.push(
          `${side}.${troop}: alive=${state.aliveCount}, composition=${formatComposition(state.levelCompositionAtRoundStart)}, effectiveC=${formatNumber(state.effectiveTroopConstant)}, weightedNumerator=${formatNumber(state.weightedConstantNumerator)}, frontHp=${formatNumber(state.frontUnitHp)}, maxHp=${formatNumber(state.maxHpPerUnit)}`,
        );
      }
    }
    lines.push("-- DamageEvents --");
    if (round.damageEvents.length === 0) lines.push("(none)");
    for (const event of round.damageEvents) {
      lines.push(
        `[${event.actionOrder}] ${event.sourceSide}.${event.sourceTroop} -> ${event.targetSide}.${event.targetTroop} ${event.damageType}/${event.damageSubtype}`,
      );
      lines.push(
        `  rootEventId=${event.rootEventId}, basis=${event.damageBasis ?? "baseFormula"}, baseDamage=${formatNumber(event.baseDamage)}, raw=${formatNumber(event.rawDamage)} -> modified=${formatNumber(event.modifiedDamage)} -> rounded=${formatNumber(event.roundedDamage)} -> applied=${formatNumber(event.appliedDamage)}, overflowDiscarded=${formatNumber(event.overflowDiscarded)}`,
      );
      if (event.baseDamageFormula !== undefined) {
        const formula = event.baseDamageFormula;
        const B = formula.fixedInitialCountFactor * formula.aliveCountFactor *
          formula.damageCoefficient * formula.troopConstant;
        lines.push(`  formula N0=${formula.fixedInitialMinTroops}, n_s=${formula.aliveCount}, C_damage=${formatNumber(formula.damageCoefficient)}, C_troopLevel=${formatNumber(formula.troopConstant)}, B=${formatNumber(B)}`);
        lines.push(`  special.baseDamage=${formatGroups(formula.specialGroups ?? [])}`);
      }
      lines.push(`  targetDefenseMultiplier=${formatNumber(event.targetDefenseMultiplier)}, skillCoefficient=${event.skillCoefficient === undefined ? "n/a" : formatNumber(event.skillCoefficient)}, hpAppliedDamage=${formatNumber(event.hpAppliedDamage)}`);
      if (event.skillPoolComponents !== undefined) lines.push(
        `  skillDamagePool=${event.skillPoolComponents.map((component) => `${component.sourceSkillId}{k=${formatNumber(component.coefficient)},base=${formatNumber(component.baseDamage)},id=${component.id}}`).join(" + ")}`,
      );
      if (event.damageSubtype === "extraDamage") lines.push(
        `  baseCoefficientB=${event.skillPoolComponents?.map((component) => formatNumber(component.coefficient)).join("+") ?? formatNumber(event.skillCoefficient ?? 0)}, aggregatedCoefficientB=${formatNumber(event.skillCoefficient ?? 0)}`,
      );
      if (event.primaryRoundedDamage !== undefined) {
        lines.push(`  mainNormalHit=${event.mainHitCancelled ? "dodged" : "hit"}, mainRoundedDamage=${formatNumber(event.primaryRoundedDamage)}`);
        lines.push(`  mainAttackAttempted=true, successfulNormalAttackHit=${!event.mainHitCancelled}, normalAttackDodged=${event.mainHitCancelled === true}`);
      }
      for (const segment of event.internalSegments ?? []) {
        lines.push(`  sameMainAttackSecondSegment=${segment.sourceSkillId}, independentDamageEvent=false, basis=${formatNumber(segment.basis)}, raw=${formatNumber(segment.rawDamage)}, modified=${formatNumber(segment.modifiedDamage)}, rounded=${formatNumber(segment.roundedDamage)}`);
      }
        if (event.parentEventId !== undefined && event.receivedDamageReductionSources.some((effect) => effect.sourceSkillId === "shield-crystal-shield")) {
        lines.push("  crystalShieldIndependentDamageEventCheck=true");
      }
      lines.push(
        `  baseAttributeEffects=${event.baseDamageAttributeEffects.length === 0 ? "none" : event.baseDamageAttributeEffects.map((effect) => `${effect.effectId}{attribute=${effect.attribute},operation=${effect.operation},group=${effect.group},value=${formatNumber(effect.effectiveValue)}}`).join(", ")}`,
      );
      for (const attribute of event.attributeResolutions ?? []) {
        lines.push(
          `  Attribute ${attribute.attribute}: report=${formatNumber(attribute.baseAttribute)}, heroAndBuffGroups=${attribute.modifierGroups.map((group) => `${group.group}{operation=${group.operation},sum=${formatNumber(group.summedValue)},factor=${formatNumber(group.multiplier)}}`).join(", ") || "none"}, buffedAttribute=${formatNumber(attribute.buffedAttribute)}, enemyHeroDebuffGroups=${formatAttributeReductionGroups(attribute.reductionGroups)}, divisionFactor=${formatNumber(attribute.divisionFactor)}, finalFactor=${formatNumber(1 + attribute.finalAttribute)}`,
        );
        if (attribute.attribute === "defense") {
          const sources = attribute.modifierGroups.filter((group) =>
            group.group === "heroDefenseBonus").flatMap((group) => group.effectInstanceIds);
          lines.push(`  heroDefenseBonusSources=${sources.join(",") || "none"}, barnacleArmorActive=${sources.some((id) => id.includes("hengdelike.barnacle-armor"))}`);
        }
      }
      lines.push(
        `  increaseEffects=${formatEffects(event.appliedIncreaseEffects)}`,
      );
      lines.push(`  increaseGroups=${formatGroups(event.increaseGroups)}`);
      lines.push(`  stateConsumed=${event.appliedIncreaseEffects.filter((effect) =>
        effect.group === "aerialSuppressionOverride")
        .map((effect) => effect.instanceId).join(",") || "none"}`);
      for (const [label, names] of [
        ["commonDamageIncrease", ["commonDamageIncrease", "baseDamageIncrease"]],
        ["vulnerability", ["vulnerability", "aerialSuppressionOverride"]],
        ["troopCounterDamage", ["troopCounterDamage", "troopVsTroopDamage"]],
        ["normalAttackDamageIncrease", ["normalAttackDamageIncrease", "normalAttackDamageIndependent"]],
        ["skillDamageIncrease", ["skillDamageIncrease"]],
      ] as const) {
        lines.push(`  ${label}=${formatGroups(event.increaseGroups.filter((group) => names.some((name) => name === group.group)))}`);
      }
      lines.push(
        `  defenseReductionEffects=${formatEffects(event.appliedDefenseReductionEffects)}`,
      );
      lines.push(
        `  defenseReductionGroups=${formatGroups(event.defenseReductionGroups)}`,
      );
      lines.push(
        `  reductionEffects=${formatEffects(event.appliedReductionEffects)}`,
      );
      lines.push(
        `  defenseEffects=${formatEffects(event.appliedDefenseEffects)}`,
      );
      lines.push(`  reductionGroups=${formatGroups(event.reductionGroups)}`);
      lines.push(`  targetReceivedReduction=${formatGroups(event.reductionGroups.filter((group) => event.receivedDamageReductionSources.some((effect) => effect.group === group.group)))}`);
      lines.push(`  receivedDamageReductionSources=${event.receivedDamageReductionSources.length === 0 ? "none" : event.receivedDamageReductionSources.map((effect) => `${effect.sourceSkillId}/${effect.effectId}{source=${effect.sourceId},value=${formatNumber(effect.effectiveValue)}}`).join(", ")}`);
      lines.push(`  receivedDamageReductionTotal=${formatNumber(event.receivedDamageReductionTotal)}, receivedDamageReductionDenominator=${formatNumber(event.receivedDamageReductionDenominator)}, damageBeforeReceivedReduction=${formatNumber(event.damageBeforeReceivedReduction)}, damageAfterReceivedReduction=${formatNumber(event.damageAfterReceivedReduction)}`);
      lines.push(`  attackerOutgoingReduction=${formatGroups(event.reductionGroups.filter((group) => group.group.toLowerCase().includes("outgoing")))}`);
      lines.push(`  special.baseDefense=${formatEffects(event.appliedDefenseEffects.filter((effect) => effect.effectKind === "baseDefenseMultiplier"))}`);
      lines.push(
        `  directCancellationEffects=${formatEffects(event.appliedDirectCancellationEffects)}`,
      );
      lines.push(
        `  directCancellationGroups=${formatGroups(event.directCancellationGroups)}`,
      );
      if (event.sourceSkillId !== undefined) {
        lines.push(`  sourceSkillId=${event.sourceSkillId}`);
      }
      if (event.parentEventId !== undefined) {
        lines.push(`  parentEventId=${event.parentEventId}`);
      }
      for (const shield of event.temporaryShield) {
        lines.push(
          `  temporaryShield shieldSourceSkill=${shield.shieldSourceSkill}, ${shield.gatotShield === undefined ? `rawDamageBasis=${formatNumber(shield.rawDamageBasis ?? 0)}` : `gatotCalculatedAttackX=${formatNumber(shield.gatotShield.calculatedAttackX)}`}, generatedShieldHp=${formatNumber(shield.generatedShieldHp)}, shieldHpBeforeHit=${formatNumber(shield.shieldHpBeforeHit)}, absorbedDamage=${formatNumber(shield.absorbedDamage)}, shieldHpAfterHit=${formatNumber(shield.shieldHpAfterHit)}, ruleStatus=${shield.ruleStatus}`,
        );
      }
    }
    lines.push("-- TroopSkills --");
    if (round.troopSkills.length === 0) lines.push("(none)");
    for (const skill of round.troopSkills) {
      lines.push(
        `${skill.side}.${skill.troop} ${skill.skillId}@${skill.level} version=${skill.skillVersion} trigger=${skill.trigger} eligible=${skill.eligible} triggered=${skill.triggered} reason=${skill.reason}`,
      );
      lines.push(`  uiSummary=${skill.uiSummary}`);
      if (skill.reportActivationCount !== undefined) {
        lines.push(`  reportActivationCount=${skill.reportActivationCount}`);
      }
      lines.push(
        `  probability=${skill.probability ?? "n/a"}, rngRoll=${skill.rngRoll ?? "n/a"}, targetingChanged=${skill.targetingChanged}`,
      );
      if (skill.skillId === "lancer-crimson-field") {
          lines.push(`  independentIncomingEventId=${skill.parentEventId ?? "none"}, receivedReduction50Pct=${skill.triggered}`);
      }
      lines.push(
        `  activeEffects=${skill.producedActiveEffectIds.join(", ") || "none"}, damageEvents=${skill.producedDamageEventIds.join(", ") || "none"}`,
      );
      if (skill.parentEventId !== undefined) {
        lines.push(`  parentEventId=${skill.parentEventId}`);
      }
      if (skill.currentStacks !== undefined) {
        lines.push(`  t12Stacks=${skill.currentStacks}, currentDamageIncrease=${formatNumber(skill.currentBonus ?? 0)}`);
      }
      for (const change of skill.lifecycleChanges) {
        lines.push(
          `  lifecycle ${change.effectId}: ${change.mode} stacks ${change.previousStacks}->${change.nextStacks}`,
        );
      }
    }
    for (const family of round.procEffectFamilies ?? []) {
      lines.push(`-- ProcEffectFamily ${family.procEffectFamilyId} --`);
      lines.push(JSON.stringify(family));
    }
    lines.push("-- HeroSkills --");
    if (round.heroSkills.length === 0) lines.push("(none)");
    for (const skill of round.heroSkills) {
      lines.push(
        `${skill.side}.${skill.heroId} position=${skill.position} generation=${skill.generation ?? "n/a"}${skill.sourceTroop === undefined ? "" : ` sourceTroop=${skill.sourceTroop}`} ${skill.skillId}@${skill.skillLevel} version=${skill.skillVersion} ruleStatus=${skill.ruleStatus ?? "n/a"} verificationStatus=${skill.verificationStatus ?? "n/a"} reusedFrom=${skill.templateSource ?? "n/a"} trigger=${skill.trigger} eligible=${skill.eligible} triggered=${skill.triggered} reason=${skill.reason}`,
      );
      lines.push(`  uiSummary=${skill.uiSummary}`);
      lines.push(
        `  probability=${skill.probability ?? "n/a"}, rngRoll=${skill.rngRoll ?? "n/a"}, damageIncrease=${skill.damageIncrease ?? "n/a"}, damageReduction=${skill.damageReduction ?? "n/a"}, activationTiming=${skill.activationTiming}`,
      );
      lines.push(`  mainAttackAttempted=${skill.mainAttackAttempted ?? "n/a"}, successfulNormalAttackHit=${skill.successfulNormalAttackHit ?? "n/a"}, normalAttackDodged=${skill.normalAttackDodged ?? "n/a"}, stunnedOrSkipped=${skill.skippedMainAttack ?? false}, attackCounterBefore=${skill.attackCountBefore ?? "n/a"}, attackCounterAfter=${skill.attackCountAfter ?? "n/a"}, triggerEligible=${skill.eligible}, procRoll=${skill.procRoll ?? "n/a"}, procSuccess=${skill.procResult}, stateApplied=${skill.producedActiveEffectIds.length > 0}, stateRefreshed=${skill.refreshedExistingState ?? false}, remainingRounds=${skill.remainingDuration ?? skill.durationRemaining ?? "n/a"}`);
      lines.push(
        `  groups=${skill.groups.join(", ") || "none"}, activeEffects=${skill.producedActiveEffectIds.join(", ") || "none"}, damageEvents=${skill.producedDamageEventIds.join(", ") || "none"}`,
      );
      lines.push(`  appliedGroup=${skill.appliedGroupValues?.map((entry) => entry.group).join(",") || "none"}, groupValue=${skill.appliedGroupValues?.map((entry) => formatNumber(entry.value)).join(",") || "n/a"}, activationRound=${skill.activationRound ?? skill.effectiveFromRound ?? "n/a"}`);
      if (skill.parentEventId !== undefined) {
        lines.push(`  parentEventId=${skill.parentEventId}`);
      }
      if (skill.targetTroop !== undefined) {
        lines.push(
          `  targetTroop=${skill.targetTroop}, appliedDebuffTargetTroop=${skill.appliedDebuffTargetTroop ?? "none"}, effectiveFromRound=${skill.effectiveFromRound ?? "n/a"}, expiresAfterRound=${skill.expiresAfterRound ?? "n/a"}`,
        );
      }
      if (skill.mainAttackAttempted !== undefined) lines.push(
        `  mainAttackAttempted=${skill.mainAttackAttempted}, successfulNormalAttackHit=${skill.successfulNormalAttackHit ?? "n/a"}, normalAttackDodged=${skill.normalAttackDodged ?? "n/a"}, mainAttackAttemptCount=${skill.mainAttackAttemptCount ?? "n/a"}`,
      );
      if (skill.steelPhalanxEligible !== undefined) lines.push(
        `  steelPhalanxEligible=${skill.steelPhalanxEligible}, steelPhalanxRoll=${skill.steelPhalanxRoll ?? "n/a"}, steelPhalanxTriggered=${skill.steelPhalanxTriggered}, defenseBuffActivationRound=${skill.defenseBuffActivationRound}, defenseBuffCurrentRoundOnly=${skill.defenseBuffCurrentRoundOnly}`,
      );
      if (skill.lancerAttackAttemptCount !== undefined) lines.push(
        `  lancerAttackAttemptCount=${skill.lancerAttackAttemptCount}, tidalOffensiveTriggered=${skill.tidalOffensiveTriggered}, nextRoundOutgoingReductionScheduled=${skill.nextRoundOutgoingReductionScheduled}`,
      );
      if (skill.marksmanAttackAttemptCount !== undefined) lines.push(
        `  marksmanAttackAttemptCount=${skill.marksmanAttackAttemptCount}, piercingArrowTriggered=${skill.piercingArrowTriggered}, vulnerabilityTarget=${skill.vulnerabilityTarget}, vulnerabilityActivationRound=${skill.vulnerabilityActivationRound ?? "n/a"}`,
      );
      if (skill.lancerMainAttackAttempted !== undefined) lines.push(
        `  lancerMainAttackAttempted=${skill.lancerMainAttackAttempted}, lancerNormalAttackHit=${skill.lancerNormalAttackHit}, crescentScytheEligible=${skill.crescentScytheEligible}, crescentScytheRoll=${skill.crescentScytheRoll ?? "n/a"}, crescentScytheTriggered=${skill.crescentScytheTriggered}`,
      );
      if (skill.crimsonBurstNaturalRoundTrigger !== undefined) lines.push(
        `  crimsonBurstNaturalRoundTrigger=${skill.crimsonBurstNaturalRoundTrigger}, currentTarget=${skill.currentTarget ?? "n/a"}, coefficient=0.75`,
      );
      if (skill.dawnSniperAttackCount !== undefined) lines.push(
        `  dawnSniperAttackCount=${skill.dawnSniperAttackCount}, lancerEventCoefficient=0.4, marksmanEventCoefficient=0.2`,
      );
      if (skill.shieldMainAttackAttempted !== undefined) lines.push(
        `  shieldMainAttackAttempted=${skill.shieldMainAttackAttempted}, shieldNormalAttackDodged=${skill.shieldNormalAttackDodged ?? "n/a"}, shieldMainAttackAttemptCount=${skill.shieldMainAttackAttemptCount}, soaringFlameTriggered=${skill.soaringFlameTriggered}, activationRound=${skill.activationRound ?? "n/a"}, activeRounds=${skill.activeRounds?.join(",") ?? "none"}`,
      );
      if (skill.armorBreakingStrikeEligible !== undefined) lines.push(
        `  marksmanMainAttackAttempted=${skill.marksmanMainAttackAttempted}, armorBreakingStrikeEligible=${skill.armorBreakingStrikeEligible}, extraDamageCoefficient=${skill.extraDamageCoefficient}, vulnerabilityTarget=${skill.vulnerabilityTarget ?? "n/a"}, vulnerabilityActivationRound=${skill.vulnerabilityActivationRound ?? "n/a"}`,
      );
      if (skill.violentBlastEligible !== undefined) lines.push(
        `  violentBlastEligible=${skill.violentBlastEligible}, violentBlastRoll=${skill.violentBlastRoll ?? "n/a"}, violentBlastTriggered=${skill.violentBlastTriggered}, debuffTarget=${skill.debuffTarget ?? "n/a"}, penetrationReduction=${skill.penetrationReduction}, remainingDuration=${skill.remainingDuration ?? "n/a"}, refreshedExistingState=${skill.refreshedExistingState}`,
      );
      if (skill.temporaryShieldGenerated === true) {
        const basis = skill.gatotShield === undefined
          ? `rawDamageBasis=${formatNumber(skill.rawDamageBasis ?? 0)}`
          : `gatotShield: skillLevel=${skill.gatotShield.skillLevel}, troopConstant=${formatNumber(skill.gatotShield.troopConstant)}, currentShieldCount=${skill.gatotShield.currentShieldCount}, sqrtCurrentShieldCount=${formatNumber(skill.gatotShield.sqrtCurrentShieldCount)}, reportAttackBonus=${formatNumber(skill.gatotShield.reportAttackBonus)}, reportAttackFactor=${formatNumber(skill.gatotShield.reportAttackFactor)}, calculatedAttackX=${formatNumber(skill.gatotShield.calculatedAttackX)}, shieldRatio=${formatNumber(skill.gatotShield.shieldRatio)}, previousShield=${formatNumber(skill.gatotShield.previousShield)}, refreshedShield=${formatNumber(skill.gatotShield.refreshedShield)}`;
        lines.push(`  temporaryShieldGenerated=true, ${basis}, generatedShieldHp=${formatNumber(skill.generatedShieldHp ?? 0)}, temporaryShieldValue=${formatNumber(skill.generatedShieldHp ?? 0)}, ruleStatus=${skill.temporaryShieldRuleStatus ?? "n/a"}`);
        lines.push(`  triggerRound=${skill.triggerRound ?? "n/a"}, activationRound=${skill.activationRound ?? "n/a"}`);
      }
      if (skill.lancerCompletedAttackCount !== undefined) lines.push(
        `  lancerCompletedAttackCount=${skill.lancerCompletedAttackCount}, bountyTriggered=${skill.triggered}, bountyExtraDamageCoefficient=${skill.bountyExtraDamageCoefficient ?? "n/a"}, bountyAttackBuffActivationRound=${skill.bountyAttackBuffActivationRound ?? "n/a"}`,
      );
      if (skill.torrentTriggerRound !== undefined) lines.push(
        `  torrentTriggerRound=${skill.torrentTriggerRound}, torrentTarget=${skill.stunTarget ?? "n/a"}, stunActivationRound=${skill.stunActivationRound ?? "n/a"}`,
      );
      if (skill.heirOfForestTriggerRound !== undefined) lines.push(
        `  heirOfForestTriggerRound=${skill.heirOfForestTriggerRound}, heirOfForestTargets=${skill.heirOfForestTargets?.join(",") ?? "none"}, perTargetExtraDamageCoefficient=${formatNumber(skill.perTargetExtraDamageCoefficient ?? 0)}`,
      );
      if (skill.poisonTarget !== undefined) {
        lines.push(
          `  poisonTarget=${skill.poisonTarget}, poisonActivationRound=${skill.poisonActivationRound ?? "n/a"}`,
        );
      }
      if (skill.stunTarget !== undefined) {
        lines.push(
          `  stunTarget=${skill.stunTarget}, skippedRound=${skill.skippedRound ?? "n/a"}`,
        );
      }
    }
    lines.push("-- RoundEnd --");
    for (const troop of round.roundEnd.troops) {
      lines.push(
        `${troop.side}.${troop.troop}: received=${formatNumber(troop.receivedDamage)}, resolved=${formatNumber(troop.resolvedDamage)}, absorbed=${formatNumber(troop.absorbedDamage)}, oldFrontHp=${formatNumber(troop.originalFrontUnitHp)}, deaths=${troop.totalDeaths}, allocated=${formatAllocations(troop.casualtyAllocationByLevel)}, ceilingByLevel=${troop.casualtyAllocationByLevel.map((entry) => `${entry.level}:deaths=${entry.ceilingDeaths},survivors=${entry.ceilingAliveCountAfter}`).join(";")}, roundingDifference=${JSON.stringify(troop.casualtyAllocationRoundingDifference)}, compositionAfter=${formatComposition(troop.levelCompositionAtRoundEnd)}, strategy=${troop.casualtyAllocationStrategy}${troop.casualtyAllocationRuleUnknown === undefined ? "" : `[RULE_UNKNOWN:${troop.casualtyAllocationRuleUnknown}]`}, alive=${troop.aliveCount}, effectiveC=${formatNumber(troop.effectiveTroopConstant)}, newFrontHp=${formatNumber(troop.frontUnitHp)}, discardedOverflow=${formatNumber(troop.discardedOverflowDamage)}`,
      );
    }
    lines.push(`status=${round.roundEnd.battleStatus}`);
  }
  lines.push(
    `=== BattleEnd | reason=${trace.endReason}, status=${trace.finalStatus} ===`,
  );
  return lines.join("\n");
}

function toTraceSide(
  troops: Readonly<Record<TroopType, TroopState>>,
): TraceSideState {
  return {
    shield: pickTraceState(troops.shield),
    lancer: pickTraceState(troops.lancer),
    marksman: pickTraceState(troops.marksman),
  };
}

function pickTraceState(state: TroopState): TraceTroopState {
  return {
    aliveCount: state.aliveCount,
    totalAliveCount: state.aliveCount,
    frontUnitHp: state.frontUnitHp,
    maxHpPerUnit: state.maxHpPerUnit,
    levelCompositionAtRoundStart: state.levelComposition.map((entry) => ({
      ...entry,
    })),
    effectiveTroopConstant: state.troopConstant,
    weightedConstantNumerator: state.aliveCount * state.troopConstant,
  };
}

function formatComposition(
  composition: readonly TroopLevelCompositionEntry[],
): string {
  return composition.map((entry) => `${entry.level}:${entry.aliveCount}`).join(",");
}

function formatAllocations(
  allocations: readonly MixedLevelCasualtyAllocationEntry[],
): string {
  return allocations.map((entry) => `${entry.level}:${entry.deaths}`).join(",");
}

function formatEffects(
  effects: DamageEvent["appliedIncreaseEffects"],
): string {
  if (effects.length === 0) return "none";
  return effects
    .map(
      (effect) =>
        `${effect.effectId}{group=${effect.group},value=${formatNumber(effect.effectiveValue)}}`,
    )
    .join(", ");
}

function formatGroups(groups: DamageEvent["increaseGroups"]): string {
  if (groups.length === 0) return "none";
  return groups
    .map(
      (group) =>
        `${group.group}{sum=${formatNumber(group.summedValue)},multiplier=${formatNumber(group.multiplier)}}`,
    )
    .join(", ");
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function formatStatVector(vector: {
  readonly attack: number;
  readonly defense: number;
  readonly penetration: number;
  readonly life: number;
}): string {
  return `attack=${formatNumber(vector.attack)}/defense=${formatNumber(vector.defense)}/penetration=${formatNumber(vector.penetration)}/life=${formatNumber(vector.life)}`;
}

function formatAttributeReductionGroups(
  groups: readonly {
    readonly group: string;
    readonly summedValue: number;
    readonly divisionFactor: number;
  }[],
): string {
  if (groups.length === 0) return "none";
  return groups.map((group) =>
    `${group.group}{sum=${formatNumber(group.summedValue)},divideBy=${formatNumber(group.divisionFactor)}}`
  ).join(", ");
}
