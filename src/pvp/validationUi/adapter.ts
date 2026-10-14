import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills/definitions/simpleHeroes";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS } from "../troopSkills/definitions/index";
import { TROOP_DAMAGE_COEFFICIENTS } from "../data/troopDamageCoefficients";
import { SUPPORTED_TROOP_LEVELS, getTroopConstant } from "../data/troopConstants";
import { calculateEffectiveTroopConstant } from "../formulas/effectiveTroopConstant";
import { createConfirmedHeroFormation } from "../heroSkills/loadout";
import { calculateHeroStatCorrection } from "../heroSkills/heroStatCorrection";
import { createHeroSkillSystem } from "../heroSkills/resolveHeroSkills";
import { createPureTroopBattleState } from "../scenario/pureTroopScenario";
import { createSeededRandomSource } from "../troopSkills/runtime";
import { createTroopSkillSystem } from "../troopSkills/resolveTroopSkills";
import { formatBattleTrace } from "../logging/battleTrace";
import { resolveTroopAttribute } from "../effects/attributeModifiers";
import { sideFromState } from "../types/battle";
import { simulateBattle } from "../battle/simulateBattle";
import { totalAlive } from "../battle/createBattleState";
import { TROOP_TYPES } from "../types/combat";
import { queueConversionSide } from "./queueConversion";
import { isIceFireInput } from "./iceFireContext";
import { normalizeIceFireReportLineage, normalizeQueueReportLineage,
  queueReportValueSource } from "./queueReportLineage";
import {
  DEFAULT_EXTERNAL_BUFF_CONFIG,
  resolveExternalBuffs,
  type BattleReportAttributeModifiers,
} from "../externalBuffs";
import { deriveExpectedReportAttribute, EXPECTED_REPORT_FORMULA } from "./expectedReportAttribute";
import type { ActiveEffect } from "../types/effect";
import type { BattleSimulationResult, CompactBattleSimulationResult } from "../battle/simulateBattle";
import type { BattleSide, BattleState } from "../types/battle";
import type { HeroSkillDefinition, HeroSkillTriggerOverrides } from "../heroSkills/types";
import type { PureTroopBattleScenario, PureTroopScenarioSideInput } from "../scenario/pureTroopScenario";
import type { ResolvedTroopAttribute } from "../effects/attributeModifiers";
import type { SideId, TroopType } from "../types/combat";
import type { TroopSkillDefinition, TroopSkillReportActivation, TroopSkillTriggerOverrides } from "../troopSkills/types";
import type { RandomSource } from "../troopSkills/runtime";
import type {
  DamageComparisonRow,
  DebugOverrideMode,
  ValidationBattleInput,
  ValidationBattleResult,
  ValidationEffectSnapshot,
  ValidationRoundDamage,
  ValidationSideInput,
  ValidationQueueConfig,
} from "./types";
import { resolveBodySkillConfigs, validateBodySkillConfigs } from "./bodySkillConfig";
import { allocateRallyTroopsByRatio } from "./rallyDeployment";
import { allocateThreeThreeThree, highestConfiguredTroopLevel } from "../scenario/scenarioTypes";
import { resolvePostBattleCasualties, type PostBattleGradeComposition } from "../postBattle";
import { runThreeQueueScenario, type ThreeQueueScenarioConfig,
  type ThreeQueueScenarioResult } from "../scenario/threeQueueScenario";
import { toThreeQueueBasisPoints } from "../scenario/threeQueueRatios";
import { resolveThreeQueueMode } from "../scenario/threeQueueScheduler";
import { summarizeBattleSkills } from "./skillSummary";
import { assertValidationInputStage, validationStageId } from "./stageConfig";
import type { ServerStageId } from "../progression";
import { createTroopState } from "../battle/createBattleState";
import { cloneBattleTemplate, FastBattleMode, type FastBattleResult, type FastTroopCounts } from "../battle/fastBattleMode";
import { applyInnerEarthLaboratorySkills, materializeInnerEarthInput,
  innerEarthLaboratoryConstant, innerEarthEnemyCounts, innerEarthIsThreeQueue } from "../innerEarth";
import { isThreeQueueBattleInput } from "../scenario/scenePolicy";

import { currentExternalConfig, rawReportSide, sourceReportBonuses, targetBattleBonuses, targetBonusMode } from "./reportBonusContexts";

const ZERO_REPORT_MODIFIERS: BattleReportAttributeModifiers = {
  selfBuffs: { attack: 0, defense: 0, penetration: 0, life: 0 },
  receivedDebuffs: { attack: 0, defense: 0, penetration: 0, life: 0 },
};

export interface ValidationBattleCoreResult {
  readonly scenario: PureTroopBattleScenario;
  readonly initialState: BattleState;
  readonly simulation: BattleSimulationResult;
  readonly roundDamage: readonly ValidationRoundDamage[];
  readonly summary: ValidationBattleResult["summary"];
}

export interface ValidationProbabilityDecision {
  readonly side: SideId;
  readonly skillId: string;
  readonly probability: number;
  readonly triggered: boolean;
}

function createValidationSkillTemplate(input: ValidationBattleInput) {
  const disabled = new Set(input.disabledSkillIds);
  const troopDefinitions = filterTroopDefinitions(disabled);
  const heroDefinitions = filterHeroDefinitions(disabled);
  const enabledTroopIds = new Set(troopDefinitions.map((definition) => definition.id));
  const enabledHeroIds = new Set(heroDefinitions.map((definition) => definition.id));
  const { troop, hero } = splitTriggerOverrides(input.triggerOverrides);
  let currentRandomSource: RandomSource = createSeededRandomSource(input.randomSeed);
  let currentDecisionSink: ((decision: ValidationProbabilityDecision) => void) | undefined;
  let currentReportSink: ((activation: TroopSkillReportActivation) => void) | undefined;
  const sharedRandomSource: RandomSource = {
    next: () => currentRandomSource.next(),
  };
  const reportDecision = (decision: ValidationProbabilityDecision): void => {
    currentDecisionSink?.(decision);
  };
  const troopSkillSystem = createTroopSkillSystem({
    definitions: troopDefinitions,
    randomSource: sharedRandomSource,
    triggerOverrides: troop,
    recordTrace: false,
    onProbabilityDecision: reportDecision,
    onReportActivation: (activation) => currentReportSink?.(activation),
  });
  const heroSkillSystem = createHeroSkillSystem({
    definitions: heroDefinitions,
    randomSource: sharedRandomSource,
    triggerOverrides: hero,
    recordTrace: false,
    onProbabilityDecision: reportDecision,
  });
  return { enabledTroopIds, enabledHeroIds, troopSkillSystem, heroSkillSystem,
    reset(seed: number, sink?: (decision: ValidationProbabilityDecision) => void,
      reportSink?: (activation: TroopSkillReportActivation) => void) {
      currentRandomSource = createSeededRandomSource(seed);
      currentDecisionSink = sink;
      currentReportSink = reportSink;
    },
  };
}

/** Session-scoped skill-definition/effect cache, separate from candidate populations.
 * Each returned battle runs synchronously; workers own independent compiler instances.
 */
export function createValidationBattleCompiler() {
  const skills = new Map<string, ReturnType<typeof createValidationSkillTemplate>>();
  return (input: ValidationBattleInput) => compileValidationBattle(input, skills);
}

/** Static validation work is compiled once per batch; only RNG and battle state vary. */
export function compileValidationBattle(input: ValidationBattleInput,
  staticCache?: Map<string, ReturnType<typeof createValidationSkillTemplate>>,
): {
  readonly initialState: BattleState;
  readonly runTrial: (
    seed: number,
    traceMode: "summary" | "none",
    onProbabilityDecision?: (decision: ValidationProbabilityDecision) => void,
    onReportActivation?: (activation: TroopSkillReportActivation) => void,
  ) => CompactBattleSimulationResult;
  /** A new battle: only defender counts carry over; HP, rounds and all skill state reset. */
  readonly runFreshTrial: (
    seed: number,
    defenderCounts: Readonly<Record<TroopType, number>>,
    traceMode?: "summary" | "none",
  ) => CompactBattleSimulationResult;
  readonly createFreshState: (defenderCounts: Readonly<Record<TroopType, number>>) => BattleState;
  readonly runFastTrial: (seed: number) => FastBattleResult;
  readonly runFastFreshTrial: (seed: number, defenderCounts: FastTroopCounts) => FastBattleResult;
} {
  const scenario = toEngineScenario(input);
  const baseState = applyInnerEarthLaboratorySkills(createPureTroopBattleState(scenario), input);
  const staticKey = JSON.stringify([[...new Set(input.disabledSkillIds)].sort(), input.triggerOverrides]);
  let skillTemplate = staticCache?.get(staticKey);
  if (skillTemplate === undefined) {
    skillTemplate = createValidationSkillTemplate(input);
    staticCache?.set(staticKey, skillTemplate);
    if (staticCache !== undefined && staticCache.size > 32) {
      staticCache.delete(staticCache.keys().next().value!);
    }
  }
  const { enabledTroopIds, enabledHeroIds, troopSkillSystem, heroSkillSystem } = skillTemplate;
  const initialState = disableSkillRuntimes(baseState, enabledTroopIds, enabledHeroIds);
  const withDefenderCounts = (defenderCounts: Readonly<Record<TroopType, number>>): BattleState => {
    for (const troop of TROOP_TYPES) {
      if (!Number.isSafeInteger(defenderCounts[troop]) || defenderCounts[troop] < 0) {
        throw new RangeError(`Invalid defender ${troop} count.`);
      }
    }
    // Only counts change between waves. Reuse parsed heroes, report corrections
    // and runtime templates; the existing constructor handles count-dependent HP.
    const troops = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      createTroopState(troop, { ...initialState.sideB.troops[troop],
        count: defenderCounts[troop], troopConstant: scenario.sideB[troop].troopConstant,
        levelComposition: [{
          level: scenario.sideB[troop].troopLevel, aliveCount: defenderCounts[troop],
        }],
      })])) as BattleSide["troops"];
    const initialTotalCount = TROOP_TYPES.reduce((sum, troop) => sum + defenderCounts[troop], 0);
    if (!Number.isSafeInteger(initialTotalCount)) throw new RangeError("Defender total exceeds safe integer range.");
    return { ...initialState, sideB: { ...initialState.sideB, troops, initialTotalCount },
      fixedInitialMinTroops: Math.min(initialState.sideA.initialTotalCount, initialTotalCount) };
  };
  const createFreshState = (defenderCounts: FastTroopCounts) => cloneBattleTemplate(withDefenderCounts(defenderCounts));
  return {
    initialState,
    createFreshState,
    runFastTrial(seed) {
      skillTemplate.reset(seed);
      return FastBattleMode.run(initialState, { maxRounds: input.maxRounds,
        troopSkillSystem, heroSkillSystem });
    },
    runFastFreshTrial(seed, defenderCounts) {
      skillTemplate.reset(seed);
      return FastBattleMode.run(withDefenderCounts(defenderCounts), {
        maxRounds: input.maxRounds, troopSkillSystem, heroSkillSystem });
    },
    runTrial(seed, traceMode, onProbabilityDecision, onReportActivation) {
      skillTemplate.reset(seed, traceMode === "summary" ? onProbabilityDecision : undefined,
        traceMode === "summary" ? onReportActivation : undefined);
      return simulateBattle(initialState, {
        maxRounds: input.maxRounds,
        traceMode,
        troopSkillSystem,
        heroSkillSystem,
      });
    },
    runFreshTrial(seed, defenderCounts, traceMode = "none") {
      const freshState = createFreshState(defenderCounts);
      skillTemplate.reset(seed);
      return simulateBattle(freshState, {
        maxRounds: input.maxRounds,
        traceMode,
        troopSkillSystem,
        heroSkillSystem,
      });
    },
  };
}

export const CURRENT_ENGINE_RULE_UNKNOWNS = [
  "futureEffectActivationTiming",
  "targetingOverrideConflictPrecedence",
  "reservedTriggerScheduling",
  "complexInitiativeOrdering",
] as const;

export function uiPercentToDecimal(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Percentage must be finite.");
  return value / 100;
}

export function decimalToUiPercent(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Decimal must be finite.");
  return value * 100;
}

export function toEngineScenario(
  input: ValidationBattleInput,
): PureTroopBattleScenario {
  if (input.scenarioType === "INNER_EARTH") input = materializeInnerEarthInput(input);
  assertValidationInputStage(input);
  if (!Number.isSafeInteger(input.randomSeed)) {
    throw new RangeError("Random seed must be a safe integer.");
  }
  if (!Number.isSafeInteger(input.maxRounds) || input.maxRounds < 1 || input.maxRounds > 1500) {
    throw new RangeError("Max rounds must be an integer from 1 to 1500.");
  }
  if (isThreeQueueBattleInput(input)) {
    throw new Error("多队列场景须通过独立 ScenarioRunner 运行。");
  }
  const battleContext = input.scenarioType === "RALLY" ? "rally"
    : input.scenarioType === "THREE_THREE_THREE" || input.scenarioType === "SINGLE" || input.scenarioType === "INNER_EARTH"
      ? "challenge" : input.battleContext ?? "unspecified";
  const sideA = input.scenarioType === "THREE_THREE_THREE"
    ? resolveThreeThreeThreeSide(input.sideA) : input.sideA;
  const sideB = input.scenarioType === "THREE_THREE_THREE"
    ? resolveThreeThreeThreeSide(input.sideB) : input.sideB;
  return {
    id: "pvp-validation-ui",
    sideA: withLaboratoryConstants(toScenarioSide(sideA, ZERO_REPORT_MODIFIERS, battleContext,
      input.attributeInputMode ?? "finalReport", validationStageId(input), "A", targetBattleBonuses(sideA, sideB)), input),
    sideB: toScenarioSide(sideB, ZERO_REPORT_MODIFIERS, battleContext,
      input.attributeInputMode ?? "finalReport", validationStageId(input), "B", targetBattleBonuses(sideB, sideA)),
    maxRounds: input.maxRounds,
    battleContext,
  };
}

function withLaboratoryConstants(side: PureTroopScenarioSideInput,
  input: ValidationBattleInput): PureTroopScenarioSideInput {
  if (input.innerEarth?.subMode !== "UNDERGROUND_LAB") return side;
  return { ...side, ...Object.fromEntries(TROOP_TYPES.map((troop) => {
    const laboratory = innerEarthLaboratoryConstant(input, troop)!;
    // The existing explicit custom-constant path is single-level only. Mixed game
    // compositions are deliberately validated against the ordinary catalog.
    const { levelComposition: _composition, ...single } = side[troop];
    void _composition;
    return [troop, { ...single, troopLevel: laboratory.level, troopConstant: laboratory.constant }];
  })) };
}

export function resolveThreeThreeThreeSide(input: ValidationSideInput): ValidationSideInput {
  const capacity = input.deploymentCapacity ?? TROOP_TYPES.reduce(
    (sum, troop) => sum + input.troops[troop].count, 0);
  const counts = allocateThreeThreeThree(capacity);
  const legacy = input.availableTroopLevels === undefined ? null
    : highestConfiguredTroopLevel(input.availableTroopLevels);
  const levelFor = (troop: TroopType): string => input.highestTroopLevels?.[troop] ??
    legacy ?? highestConfiguredTroopLevel(input.troops[troop].levelMode === "mixed" &&
      input.troops[troop].levelComposition !== undefined
      ? input.troops[troop].levelComposition.map((entry) => entry.level)
      : [input.troops[troop].troopLevel]);
  return {
    ...input,
    marchCapacityBonus: 0,
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
      ...input.troops[troop], count: counts[troop], troopLevel: levelFor(troop),
      levelMode: "single", levelComposition: undefined,
    }])) as unknown as ValidationSideInput["troops"],
  };
}

export function getValidationThreeQueues(side: ValidationSideInput):
  readonly [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig] {
  const raw = side.threeQueues ?? [
    { ratios: { shield: 34, lancer: 33, marksman: 33 }, leaderHeroIds: side.leaderHeroIds ?? {} },
    { ratios: { shield: 34, lancer: 33, marksman: 33 }, leaderHeroIds: side.leaderHeroIds ?? {} },
    { ratios: { shield: 34, lancer: 33, marksman: 33 }, leaderHeroIds: side.leaderHeroIds ?? {} },
  ];
  const legacyLevel = side.availableTroopLevels === undefined ? null
    : highestConfiguredTroopLevel(side.availableTroopLevels);
  const troopLevels = side.highestTroopLevels ?? Object.fromEntries(TROOP_TYPES.map(
    (troop) => [troop, legacyLevel ?? side.troops[troop].troopLevel])) as
      Record<TroopType, string>;
  const attributes = Object.fromEntries(TROOP_TYPES.map((troop) => {
    const { attack, defense, penetration, life } = side.troops[troop];
    return [troop, { attack, defense, penetration, life }];
  })) as NonNullable<ValidationQueueConfig["attributes"]>;
  return raw.map((queue) => normalizeQueueReportLineage({ ...queue,
    attributeSource: queue.attributeSource ?? (queue.attributes === undefined ? "basePanel" : "manualInput"),
    attributes: queue.attributes ?? attributes,
    troopLevels: queue.troopLevels ?? troopLevels,
    ...(side.shared === undefined ? { externalBuffs: queue.externalBuffs ?? side.externalBuffs ?? DEFAULT_EXTERNAL_BUFF_CONFIG } : {}),
    heroSkillLevels: queue.heroSkillLevels ?? side.leaderSkillLevels ?? {} })) as
      [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
}

export function toValidationThreeQueueConfig(input: ValidationBattleInput): ThreeQueueScenarioConfig {
  if (input.scenarioType === "INNER_EARTH") input = materializeInnerEarthInput(input);
  input = normalizeIceFireReportLineage(input);
  if (isIceFireInput(input)) input = { ...input, threeQueueMode: "ICE_FIRE_LEAGUE", attributeInputMode: "prediction" };
  if (input.attributeInputMode !== "prediction" && input.scenarioType !== "ICE_FIRE_LEAGUE") {
    throw new Error("三队列仅支持预期 / 配置属性模式。");
  }
  assertValidationInputStage(input);
  if (!isThreeQueueBattleInput(input)) {
    throw new Error("此场景不能交给多队列 ScenarioRunner。");
  }
  const a = getValidationThreeQueues(input.sideA);
  const b = getValidationThreeQueues(input.sideB);
  for (const [sideId, queues] of [["A", a], ["B", b]] as const) {
    for (const [index, queue] of queues.entries()) {
      for (const troop of TROOP_TYPES) for (const stat of ["attack", "defense",
        "penetration", "life"] as const) {
        const reportValue = queue.attributes?.[troop]?.[stat];
        if (!Number.isFinite(reportValue)) {
          const name = { shield: "盾兵", lancer: "矛兵", marksman: "射手" }[troop];
          const label = { attack: "攻击", defense: "防御", penetration: "穿透",
            life: "生命" }[stat];
          throw new RangeError(`${sideId}方 第${index + 1}队 ${name}${label}缺失：` +
            `side=${sideId}, queue=${index + 1}, troop=${troop}, stat=${stat}, ` +
            `reportValue=${reportValue}, additive=unknown, buff=unknown, ` +
            `debuff=unknown, reportFactor=unknown, buffFactor=unknown, ` +
            `debuffFactor=unknown`);
        }
      }
    }
  }
  const prepared = [0, 1, 2].map((index) => toEngineScenario({
    ...input, scenarioType: "SINGLE", battleContext: "challenge",
    attributeInputMode: input.attributeInputMode ?? "finalReport",
    sideA: queueConversionSide(input, "A", a[index]!),
    sideB: queueConversionSide(input, "B", b[index]!),
  }));
  for (const [index, scenario] of prepared.entries()) {
    for (const [sideId, side] of [["A", scenario.sideA],
      ["B", scenario.sideB]] as const) {
      const reportHeroes = side.reportHeroes ?? side.reportHeroIds;
      const formation = createConfirmedHeroFormation(side.heroes ?? []);
      const correction = input.attributeInputMode === "finalReport" || reportHeroes === undefined ? undefined :
        calculateHeroStatCorrection(reportHeroes,
          formation.filter((hero) => hero.position === "leader").map((hero) => ({
            heroId: hero.heroId, weaponLevel: hero.weaponLevel })));
      for (const troop of TROOP_TYPES) for (const stat of ["attack", "defense",
        "penetration", "life"] as const) {
        const rawInputPercent = side[troop][stat] * 100;
        const imported = side.targetBattleBonuses?.[troop][stat];
        const specialBonusAdditivePercent = imported?.additive ?? 0;
        const buff = imported?.buff ??
          (side.reportAttributeModifiers?.selfBuffs[stat] ?? 0) * 100;
        const debuff = imported?.debuff ??
          (side.reportAttributeModifiers?.receivedDebuffs[stat] ?? 0) * 100;
        const lineupDeltaPercent = (correction?.delta[troop][stat] ?? 0) * 100;
        const weaponDeltaPercent = ((correction?.simulationWeaponContribution[troop][stat] ?? 0) -
          (correction?.reportWeaponContribution[troop][stat] ?? 0)) * 100;
        const heroStaticDeltaPercent = lineupDeltaPercent - weaponDeltaPercent;
        const reportValue = rawInputPercent;
        const reportFactor = 1 + reportValue / 100;
        const buffFactor = 1 + buff / 100;
        const debuffFactor = 1 + debuff / 100;
        const baseFactor = 1 + rawInputPercent / 100;
        let finalFactor: number;
        try { finalFactor = 1 + deriveExpectedReportAttribute({ raw: rawInputPercent,
          formationDelta: lineupDeltaPercent, targetAdditive: specialBonusAdditivePercent,
          targetBuff: buff / 100, targetDebuff: debuff / 100 }) / 100; }
        catch {
          // Diagnostic only: retain the invalid algebraic factor in the error.
          finalFactor = (baseFactor + lineupDeltaPercent / 100 +
            specialBonusAdditivePercent / 100) * buffFactor / debuffFactor;
        }
        if (![reportValue, rawInputPercent, lineupDeltaPercent,
          specialBonusAdditivePercent, buff, debuff, finalFactor].every(Number.isFinite) ||
          reportFactor <= 0 || baseFactor <= 0 || buffFactor <= 0 ||
          debuffFactor <= 0 || finalFactor <= 0) {
          const name = { shield: "盾兵", lancer: "矛兵", marksman: "射手" }[troop];
          const label = { attack: "攻击", defense: "防御", penetration: "穿透",
            life: "生命" }[stat];
          const key = sideId === "A" ? "sideA" : "sideB";
          const queue = (sideId === "A" ? a : b)[index]!;
          const reportValueSource = queueReportValueSource(queue,
            `${key}.threeQueues[${index}].attributes.${troop}.${stat}`, reportValue);
          const additiveContributions = specialBonusAdditivePercent === 0 ? [] :
            [{ source: "official",
              label: `官职赋予部队${({ attack: "攻击力", defense: "防御力",
                penetration: "穿透力", life: "生命值" })[stat]}`,
              value: specialBonusAdditivePercent }];
          throw new RangeError(`${sideId}方 第${index + 1}队 ${name}${label}${
            Number.isFinite(reportValue) ? "因子无效" : "缺失"}：` +
            `side=${sideId}, queue=${index + 1}, troop=${troop}, stat=${stat}, ` +
            `reportValue=${reportValue}, ` +
            `reportValueSource=${JSON.stringify(reportValueSource)}, ` +
            `additiveContributions=${JSON.stringify(additiveContributions)}, ` +
            `specialBonusAdditivePercent=${specialBonusAdditivePercent}, ` +
            `heroStaticDeltaPercent=${heroStaticDeltaPercent}, ` +
            `weaponDeltaPercent=${weaponDeltaPercent}, ` +
            `lineupCorrectionSource=${JSON.stringify({
              reportHeroIds: correction?.reportHeroIds ?? [],
              simulationHeroIds: correction?.simulationHeroIds ?? [],
            })}, ` +
            `rawInputPercent=${rawInputPercent}, buff=${buff}, ` +
            `debuff=${debuff}, reportFactor=${reportFactor}, ` +
            `buffFactor=${buffFactor}, debuffFactor=${debuffFactor}, ` +
            `finalFactor=${finalFactor}`);
        }
      }
    }
  }
  const sideConfig = (side: ValidationSideInput, sideId: "A" | "B",
    queues: typeof a): ThreeQueueScenarioConfig["attacker"] => ({
    deploymentCapacity: side.deploymentCapacity ?? TROOP_TYPES.reduce(
      (sum, troop) => sum + side.troops[troop].count, 0),
    highestTroopLevels: side.highestTroopLevels ?? (side.availableTroopLevels === undefined
      ? Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
        side.troops[troop].troopLevel])) as Record<TroopType, string>
      : Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
        highestConfiguredTroopLevel(side.availableTroopLevels!)])) as Record<TroopType, string>),
    queues: [0, 1, 2].map((index) => ({
      id: `${sideId}${index + 1}`,
      ratiosBp: toThreeQueueBasisPoints(queues[index]!.ratios),
      troopLevels: queues[index]!.troopLevels,
      ...(queues[index]!.troopLevelCompositions === undefined ? {} : {
        troopLevelCompositions: queues[index]!.troopLevelCompositions }),
      side: sideId === "A" ? prepared[index]!.sideA : prepared[index]!.sideB,
      ...(sideId === "B" && input.scenarioType !== "ICE_FIRE_LEAGUE" && input.innerEarth !== undefined &&
        innerEarthIsThreeQueue(input.innerEarth.subMode) ? {
          initialTroopCounts: innerEarthEnemyCounts(input.innerEarth.enemy.shared.capacity,
            input.innerEarth.enemy.shared.troopRatioPreset),
        } : {}),
    })) as unknown as ThreeQueueScenarioConfig["attacker"]["queues"],
  });
  return {
    id: "pvp-validation-three-queue", seed: input.randomSeed,
    battleScenario: input.scenarioType === "INNER_EARTH" ||
      input.scenarioType === "THREE_QUEUE" && input.innerEarth !== undefined ? "INNER_EARTH" :
      input.scenarioType === "ICE_FIRE_LEAGUE" ? "ICE_FIRE_LEAGUE" : "THREE_QUEUE",
    ...(input.scenarioType !== "ICE_FIRE_LEAGUE" && input.innerEarth !== undefined ? {
      innerEarthMode: input.innerEarth.subMode } : {}),
    threeQueueMode: resolveThreeQueueMode(input.threeQueueMode),
    maxRoundsPerBattle: input.maxRounds,
    casualtyMode: input.postBattleCasualtyMode ?? "NORMAL",
    attacker: sideConfig(input.sideA, "A", a),
    defender: sideConfig(input.sideB, "B", b),
  };
}

export function runValidationThreeQueueScenario(input: ValidationBattleInput): ThreeQueueScenarioResult {
  return runThreeQueueScenario(toValidationThreeQueueConfig(input));
}

export function runValidationBattle(
  input: ValidationBattleInput,
): ValidationBattleResult {
  if (input.scenarioType === "INNER_EARTH") input = materializeInnerEarthInput(input);
  const core = runValidationBattleCore(input);
  const { scenario, initialState, simulation, roundDamage, summary } = core;
  const grades = (side: SideId): PostBattleGradeComposition => {
    const before = side === "A" ? initialState.sideA : initialState.sideB;
    const after = side === "A" ? simulation.finalState.sideA : simulation.finalState.sideB;
    return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      before.troops[troop].levelComposition.map((entry) => ({
        level: entry.level, initial: entry.aliveCount,
        survivors: after.troops[troop].levelComposition.find(
          (remaining) => remaining.level === entry.level)?.aliveCount ?? 0,
      }))])) as unknown as PostBattleGradeComposition;
  };
  return {
    input,
    scenario,
    initialState,
    simulation,
    trace: simulation.trace,
    readableTrace: formatBattleTrace(simulation.trace),
    summary,
    roundDamage,
    comparisons: compareActualDamage(roundDamage, input.actualRounds),
    activeEffects: collectActiveEffects(simulation),
    heroStatCorrections: simulation.trace.heroStatCorrections ?? {},
    expectedReportBonuses: calculateExpectedReportBonuses(input, initialState),
    skillSummary: summarizeBattleSkills(simulation.trace),
    postBattleCasualties: {
      A: resolvePostBattleCasualties(
        Object.fromEntries(TROOP_TYPES.map((troop) => [troop, initialState.sideA.troops[troop].initialCount])) as Record<TroopType, number>,
        summary.remaining.A, input.postBattleCasualtyMode ?? "NORMAL", grades("A")),
      B: resolvePostBattleCasualties(
        Object.fromEntries(TROOP_TYPES.map((troop) => [troop, initialState.sideB.troops[troop].initialCount])) as Record<TroopType, number>,
        summary.remaining.B, input.postBattleCasualtyMode ?? "NORMAL", grades("B")),
    },
  };
}

/** Lightweight single trial for batch aggregation; no readable trace or UI projections. */
export function runValidationBattleCore(
  input: ValidationBattleInput,
): ValidationBattleCoreResult {
  const scenario = toEngineScenario(input);
  const baseState = applyInnerEarthLaboratorySkills(createPureTroopBattleState(scenario), input);
  const disabled = new Set(input.disabledSkillIds);
  const troopDefinitions = filterTroopDefinitions(disabled);
  const heroDefinitions = filterHeroDefinitions(disabled);
  const initialState = disableSkillRuntimes(
    baseState,
    new Set(troopDefinitions.map((definition) => definition.id)),
    new Set(heroDefinitions.map((definition) => definition.id)),
  );
  const { troop, hero } = splitTriggerOverrides(input.triggerOverrides);
  const randomSource = createSeededRandomSource(input.randomSeed);
  const simulation = simulateBattle(initialState, {
    maxRounds: input.maxRounds,
    troopSkillSystem: createTroopSkillSystem({
      definitions: troopDefinitions,
      randomSource,
      triggerOverrides: troop,
    }),
    heroSkillSystem: createHeroSkillSystem({
      definitions: heroDefinitions,
      randomSource,
      triggerOverrides: hero,
    }),
  });
  const roundDamage = collectRoundDamage(simulation);
  return {
    scenario,
    initialState,
    simulation,
    summary: summarizeBattle(simulation),
    roundDamage,
  };
}

export function previewHeroStatCorrection(input: ValidationBattleInput) {
  const state = createValidationPreviewState(input);
  return {
    ...(state.sideA.heroStatCorrection === undefined
      ? {}
      : { A: state.sideA.heroStatCorrection }),
    ...(state.sideB.heroStatCorrection === undefined
      ? {}
      : { B: state.sideB.heroStatCorrection }),
  };
}

export function createValidationPreviewState(
  input: ValidationBattleInput,
): BattleState {
  return applyInnerEarthLaboratorySkills(createPureTroopBattleState(toEngineScenario(input)), input);
}

export function previewExpectedReportBonuses(
  input: ValidationBattleInput,
  state = createValidationPreviewState(input),
): ValidationBattleResult["expectedReportBonuses"] {
  return calculateExpectedReportBonuses(input, state);
}

export function compareActualDamage(
  modeled: readonly ValidationRoundDamage[],
  actual: ValidationBattleInput["actualRounds"],
): readonly DamageComparisonRow[] {
  const actualByRound = new Map(actual.map((row) => [row.round, row]));
  return modeled.flatMap((row) => {
    const actualRow = actualByRound.get(row.round);
    return (["AtoB", "BtoA"] as const).flatMap((direction) => {
      const actualValue = actualRow?.[direction];
      if (actualValue === undefined || !Number.isFinite(actualValue)) return [];
      const model = row[direction];
      const difference = model - actualValue;
      return [{
        round: row.round,
        direction,
        model,
        actual: actualValue,
        difference,
        errorRate: actualValue === 0 ? null : difference / actualValue,
      }];
    });
  });
}

function toScenarioSide(
  original: ValidationSideInput,
  reportAttributeModifiers: BattleReportAttributeModifiers,
  battleContext: NonNullable<ValidationBattleInput["battleContext"]>,
  attributeInputMode: "finalReport" | "prediction",
  stageId: ServerStageId,
  sideId: SideId,
  targetBonuses: ValidationSideInput["targetBattleBonuses"],
): PureTroopScenarioSideInput {
  const input = attributeInputMode === "prediction" ? rawReportSide(original) : original;
  const leaderIds = input.leaderHeroIds === undefined
    ? (input.leaderHeroId === null ? [] : [input.leaderHeroId])
    : TROOP_TYPES.flatMap((troop) => {
        const heroId = input.leaderHeroIds?.[troop];
        return heroId === undefined || heroId === null ? [] : [heroId];
      });
  const bodySkills = battleContext !== "rally" ? []
    : input.bodySkills === undefined
      ? resolveBodySkillConfigs(input.selectedMemberSkillIds, leaderIds, stageId, sideId)
      : validateBodySkillConfigs(input.bodySkills, leaderIds, stageId, sideId);
  const levelsForHero = (heroId: string): Readonly<Record<string, number>> =>
    Object.fromEntries(Object.entries(input.leaderSkillLevels ?? {}).filter(([skillId]) =>
      CONFIRMED_HERO_SKILL_DEFINITIONS.some((definition) =>
        definition.id === skillId && definition.heroId === heroId)));
  const heroes = createConfirmedHeroFormation([
    ...leaderIds.map((heroId) => ({
          heroId,
          position: "leader" as const,
          weaponLevel: input.simulationWeaponLevels?.[heroId] ?? 0,
          skillLevels: levelsForHero(heroId),
        })),
    ...bodySkills.map(({ heroId, heroDefinitionId, runtimeInstanceId, skillId, skillLevel }) => ({
      heroId, heroDefinitionId: heroDefinitionId ?? heroId,
      ...(runtimeInstanceId === undefined ? {} : { runtimeInstanceId }),
      position: "member" as const,
      selectedMemberSkillId: skillId,
      skillLevels: { [skillId]: skillLevel },
    })),
  ]);
  const counts = resolveValidationTroopCounts(input, battleContext, attributeInputMode);
  const troops = Object.fromEntries(TROOP_TYPES.map((troop) => {
      const source = input.troops[troop];
      const composition = battleContext === "rally" && attributeInputMode === "prediction"
        ? source.levelMode === "mixed" && source.resolutionSource !== undefined ?
          rescaleComposition(normalizeValidationComposition(source), counts[troop]) :
          [{ level: source.troopLevel, aliveCount: counts[troop] }]
        : attributeInputMode === "prediction"
          ? petCapacity(input) === 0
            ? normalizeValidationComposition(source).map((entry) => ({ ...entry,
              aliveCount: applyCapacity(entry.aliveCount, input.marchCapacityBonus ?? 0) }))
            : rescaleComposition(normalizeValidationComposition(source), counts[troop])
          : normalizeValidationComposition(source);
      const totalAliveCount = composition.reduce(
        (sum, entry) => sum + entry.aliveCount,
        0,
      );
      const effective = totalAliveCount === 0
        ? {
            totalAliveCount,
            effectiveTroopConstant: getTroopConstant(source.troopLevel),
          }
        : calculateEffectiveTroopConstant(composition);
      return [troop, {
        count: effective.totalAliveCount,
        attack: uiPercentToDecimal(source.attack),
        defense: uiPercentToDecimal(source.defense),
        penetration: uiPercentToDecimal(source.penetration),
        life: uiPercentToDecimal(source.life),
        troopLevel: source.troopLevel,
        troopConstant: effective.effectiveTroopConstant,
        levelComposition: composition,
        damageCoefficient: TROOP_DAMAGE_COEFFICIENTS[troop],
        t12Level: validateT12Level(source.t12Level ?? 0),
      }];
    })) as unknown as Pick<
      PureTroopScenarioSideInput,
      "shield" | "lancer" | "marksman"
    >;
  return {
    ...troops,
    attributeInputMode,
    reportAttributeModifiers,
    ...(attributeInputMode === "prediction" && targetBonuses !== undefined
      ? { targetBattleBonuses: targetBonuses } : {}),
    reportHeroes: (input.reportHeroByTroop === undefined
      ? input.reportHeroIds
      : TROOP_TYPES.flatMap((troop) => {
          const heroId = input.reportHeroByTroop?.[troop];
          return heroId === undefined || heroId === null ? [] : [heroId];
        })
    ).map((heroId) => ({
      heroId,
      weaponLevel: input.reportWeaponLevels?.[heroId] ?? 0,
    })),
    heroes: heroes.map((hero, heroIndex) => {
      if (hero.position === "member") {
        const body = bodySkills[heroIndex - leaderIds.length]!;
        return { heroId: body.heroId, heroDefinitionId: body.heroDefinitionId ?? body.heroId,
          ...(body.runtimeInstanceId === undefined ? {} : { runtimeInstanceId: body.runtimeInstanceId }),
          position: "member" as const,
          selectedMemberSkillId: body.skillId,
          skillLevels: { [body.skillId]: body.skillLevel } };
      }
      return { heroId: hero.heroId, position: "leader" as const,
        weaponLevel: hero.weaponLevel,
        skillLevels: levelsForHero(hero.heroId) };
    }),
  };
}

export function resolveValidationTroopCounts(
  input: ValidationSideInput,
  battleContext: NonNullable<ValidationBattleInput["battleContext"]>,
  attributeInputMode: "finalReport" | "prediction" = "finalReport",
): Readonly<Record<TroopType, number>> {
  if (battleContext === "rally" && attributeInputMode === "prediction") {
    const fixedCapacity = input.rallyFixedCapacityBonus ?? 0;
    if (!Number.isSafeInteger(fixedCapacity) || fixedCapacity < 0) {
      throw new RangeError("Fixed rally capacity must be a non-negative integer.");
    }
    const directTotal = TROOP_TYPES.reduce(
      (sum, troop) => sum + input.troops[troop].count,
      0,
    );
    const deployment = input.rallyDeployment ?? {
      totalTroops: directTotal,
      ratios: { shield: 34, lancer: 33, marksman: 33 },
    };
    return allocateRallyTroopsByRatio({
      ...deployment,
      totalTroops: applyCapacity(deployment.totalTroops +
        fixedCapacity + petCapacity(input),
      input.rallyCapacityBonus ?? 0),
    });
  }
  const counts = {
    shield: normalizeValidationComposition(input.troops.shield).reduce(
      (sum, entry) => sum + entry.aliveCount, 0,
    ),
    lancer: normalizeValidationComposition(input.troops.lancer).reduce(
      (sum, entry) => sum + entry.aliveCount, 0,
    ),
    marksman: normalizeValidationComposition(input.troops.marksman).reduce(
      (sum, entry) => sum + entry.aliveCount, 0,
    ),
  };
  if (attributeInputMode === "finalReport") return counts;
  if (petCapacity(input) === 0) {
    return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      normalizeValidationComposition(input.troops[troop]).reduce((sum, entry) =>
        sum + applyCapacity(entry.aliveCount, input.marchCapacityBonus ?? 0), 0),
    ])) as Record<TroopType, number>;
  }
  const total = TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0);
  if (total === 0) return counts;
  const expanded = applyCapacity(total + petCapacity(input), input.marchCapacityBonus ?? 0);
  const exact = TROOP_TYPES.map((troop) => expanded * counts[troop] / total);
  const values = exact.map(Math.floor);
  const order = [0, 1, 2].sort((a, b) =>
    exact[b]! - values[b]! - (exact[a]! - values[a]!) || a - b);
  for (let missing = expanded - values.reduce((sum, value) => sum + value, 0);
    missing > 0; missing -= 1) values[order[(missing - 1) % 3]!]! += 1;
  return { shield: values[0]!, lancer: values[1]!, marksman: values[2]! };
}

function petCapacity(input: ValidationSideInput): number {
  const level = input.petMarchCapacityLevel ?? 0;
  if (!Number.isSafeInteger(level) || level < 0 || level > 10) {
    throw new RangeError("Pet march capacity level must be 0-10.");
  }
  return level * 1_500;
}

function rescaleComposition(
  entries: readonly { readonly level: string; readonly aliveCount: number }[],
  target: number,
): { level: string; aliveCount: number }[] {
  const total = entries.reduce((sum, entry) => sum + entry.aliveCount, 0);
  if (total === 0) return entries.map((entry) => ({ ...entry }));
  const exact = entries.map((entry) => entry.aliveCount * target / total);
  const counts = exact.map(Math.floor);
  const order = entries.map((_, index) => index).sort((a, b) =>
    exact[b]! - counts[b]! - (exact[a]! - counts[a]!) || a - b);
  for (let missing = target - counts.reduce((sum, value) => sum + value, 0);
    missing > 0; missing -= 1) counts[order[(missing - 1) % order.length]!]! += 1;
  return entries.map((entry, index) => ({ ...entry, aliveCount: counts[index]! }));
}

function applyCapacity(count: number, bonus: number): number {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(bonus) || bonus < 0) {
    throw new RangeError("Capacity inputs must be non-negative finite values.");
  }
  const actual = Math.floor(count * (1 + bonus));
  if (!Number.isSafeInteger(actual)) throw new RangeError("Capacity-adjusted troop count is too large.");
  return actual;
}

function calculateExpectedReportBonuses(
  input: ValidationBattleInput,
  initialState: BattleState,
): ValidationBattleResult["expectedReportBonuses"] {
  const finalReport = (input.attributeInputMode ?? "finalReport") === "finalReport";
  const disabled = new Set(input.disabledSkillIds);
  const troopDefinitions = filterTroopDefinitions(disabled);
  const heroDefinitions = filterHeroDefinitions(disabled);
  const enabledState = disableSkillRuntimes(
    initialState,
    new Set(troopDefinitions.map((definition) => definition.id)),
    new Set(heroDefinitions.map((definition) => definition.id)),
  );
  const { troop, hero } = splitTriggerOverrides(input.triggerOverrides);
  const noRandomProc = { next: () => .999999999999 };
  const troopRound = createTroopSkillSystem({
    definitions: troopDefinitions,
    randomSource: noRandomProc,
    triggerOverrides: troop,
  }).prepareRound(enabledState);
  const heroRound = createHeroSkillSystem({
    definitions: heroDefinitions,
    randomSource: noRandomProc,
    triggerOverrides: hero,
  }).prepareRound(troopRound.state);
  const prepared = heroRound.state;
  const weaponSkillIds = new Set(heroDefinitions.filter((definition) =>
    definition.positionRule.kind === "exclusiveWeapon").map((definition) => definition.id));
  return {
    A: expectedForSide(
      prepared,
      "A",
      input.sideA,
      weaponSkillIds,
      finalReport,
      input.sideB,
    ),
    B: expectedForSide(
      prepared,
      "B",
      input.sideB,
      weaponSkillIds,
      finalReport,
      input.sideA,
    ),
  };
}

function expectedForSide(
  state: BattleState,
  sideId: SideId,
  input: ValidationSideInput,
  weaponSkillIds: ReadonlySet<string>,
  finalReport: boolean,
  enemyInput: ValidationSideInput,
): ValidationBattleResult["expectedReportBonuses"][SideId] {
  const rawInput = finalReport ? input : rawReportSide(input);
  const historical = sourceReportBonuses(input);
  const target = finalReport ? undefined : targetBattleBonuses(input, enemyInput);
  const side = sideFromState(state, sideId);
  const opponent = sideFromState(state, sideId === "A" ? "B" : "A");
  const targetTroop = TROOP_TYPES.find(
    (troop) => opponent.troops[troop].aliveCount > 0,
  ) ?? "shield";
  const attributes = ["attack", "defense", "penetration", "life"] as const;
  const resolutions = Object.fromEntries(TROOP_TYPES.map((troop) => [
    troop,
    Object.fromEntries(attributes.map((attribute) => [
      attribute,
      resolveTroopAttribute(side, troop, attribute, state.round, {
        targetTroop,
        damageType: "normalAttack",
      }),
    ])),
  ])) as Record<
    TroopType,
    Record<(typeof attributes)[number], ResolvedTroopAttribute>
  >;
  const troops = Object.fromEntries(TROOP_TYPES.map((troop) => [
    troop,
    Object.fromEntries(attributes.map((attribute) => [
      attribute,
      resolutions[troop][attribute].effectiveValue,
    ])),
  ])) as ValidationBattleResult["expectedReportBonuses"][SideId]["troops"];
  const isWeaponEffect = (effect: ActiveEffect): boolean =>
    weaponSkillIds.has(effect.identity.sourceSkillId);
  const displaySide: BattleSide = {
    ...side,
    armyEffects: side.armyEffects.filter(isWeaponEffect),
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
      ...side.troops[troop],
      buffs: side.troops[troop].buffs.filter(isWeaponEffect),
      debuffs: side.troops[troop].debuffs.filter(isWeaponEffect),
    }])) as unknown as BattleSide["troops"],
  };
  const breakdown = Object.fromEntries(TROOP_TYPES.map((troop) => [
    troop,
    Object.fromEntries(attributes.map((attribute) => {
      const inputReportBonus = uiPercentToDecimal(rawInput.troops[troop][attribute]);
      const lineupCorrection = side.heroStatCorrection?.delta[troop][attribute] ?? 0;
      const resolution = resolveTroopAttribute(displaySide, troop, attribute,
        state.round, { targetTroop, damageType: "normalAttack" });
      const sourceRow = historical[troop][attribute];
      const targetRow = target?.[troop][attribute] ?? { additive: 0, buff: 0, debuff: 0 };
      const targetBuff = targetRow.buff / 100;
      const targetDebuff = targetRow.debuff / 100;
      const currentExternalBuffBase = targetBuff;
      const currentWeaponBuff = resolution.currentWeaponBuff;
      const currentExternalBuffTotal = currentExternalBuffBase + currentWeaponBuff;
      const weaponScenarioContribution = currentWeaponBuff;
      const expected = deriveExpectedReportAttribute({ raw: inputReportBonus * 100,
        formationDelta: lineupCorrection * 100, targetAdditive: targetRow.additive,
        targetBuff: currentExternalBuffTotal, targetDebuff });
      const displayPoints = (value: number) => Number(value.toFixed(4));
      const calculationAudit = {
        side: sideId, troop, stat: attribute,
        displayedRaw: displayPoints(inputReportBonus * 100), actualRawUsed: inputReportBonus * 100,
        displayedFormationDelta: displayPoints(lineupCorrection * 100), actualFormationDeltaUsed: lineupCorrection * 100,
        displayedTargetAdditive: displayPoints(targetRow.additive), actualTargetAdditiveUsed: targetRow.additive,
        displayedTargetBuff: displayPoints(targetBuff * 100) / 100, actualTargetBuffUsed: currentExternalBuffTotal,
        displayedTargetDebuff: displayPoints(targetDebuff * 100) / 100, actualTargetDebuffUsed: targetDebuff,
        displayedWeaponModifier: displayPoints(weaponScenarioContribution * 100),
        actualWeaponModifierUsed: weaponScenarioContribution * 100,
        sourceReportBonuses: sourceRow, targetBattleBonuses: targetRow,
        formula: EXPECTED_REPORT_FORMULA, weaponSemantics: "sameExternalBuffGroup" as const,
        currentExternalBuffBase, currentWeaponBuff, currentExternalBuffTotal,
        calculatedExpected: expected, displayedExpected: displayPoints(expected),
        actualEnginePanel: resolution.effectiveValue * 100,
      };
      return [attribute, {
        inputReportBonus,
        lineupCorrection,
        ownBuffRate: currentExternalBuffTotal,
        currentExternalBuffBase, currentWeaponBuff, currentExternalBuffTotal,
        enemyDebuffRate: targetDebuff,
        sourceReportAdditive: sourceRow.additive / 100,
        sourceReportBuff: sourceRow.buff / 100,
        sourceReportDebuff: sourceRow.debuff / 100,
        targetAdditive: targetRow.additive / 100,
        targetBuff, targetDebuff,
        weaponScenarioContribution, calculationAudit,
        bonusSources: {
          weaponScenarioContribution: "scene-eligible exclusive weapon attribute rates; summed with normal external Buff before report construction",
          currentSelfBuffContributions: JSON.stringify(resolveExternalBuffs(currentExternalConfig(input)).selfBuffSources.filter((source) => source.attribute === attribute)),
          currentReceivedDebuffContributions: JSON.stringify(resolveExternalBuffs(currentExternalConfig(enemyInput)).enemyDebuffSources.filter((source) => source.attribute === attribute)),
          sourceReportAdditive: `sourceReportBonuses.${troop}.${attribute}.additive (legacy: importedReportModifiers)`,
          sourceReportBuff: `sourceReportBonuses.${troop}.${attribute}.buff (legacy: importedReportModifiers)`,
          sourceReportDebuff: `sourceReportBonuses.${troop}.${attribute}.debuff (legacy: importedReportModifiers)`,
          target: finalReport ? "finalReport: disabled" : targetBonusMode(input) === "reuseSource" ? "explicit reuseSource" :
            targetBonusMode(input) === "custom" ? "targetBattleBonuses + current externalBuffs" : "none: zero own bonuses; explicit current opponent debuffs only",
        },
        finalBonus: expected / 100,
      }];
    })),
  ])) as unknown as ValidationBattleResult["expectedReportBonuses"][SideId]["breakdown"];
  const externalDebuffs = finalReport ? ZERO_REPORT_MODIFIERS.receivedDebuffs : resolveExternalBuffs(
    currentExternalConfig(input) ?? DEFAULT_EXTERNAL_BUFF_CONFIG,
  ).enemyDebuffs;
  const inflictedEnemyDebuffs = externalDebuffs;
  return {
    troops,
    breakdown,
    inflictedEnemyDebuffs,
  };
}

function normalizeValidationComposition(
  source: ValidationSideInput["troops"][TroopType],
): readonly { readonly level: string; readonly aliveCount: number }[] {
  if ((source.levelMode ?? "single") === "single") {
    return [{ level: source.troopLevel, aliveCount: source.count }];
  }
  const composition = source.levelComposition ?? [];
  if (composition.length === 0) {
    throw new Error("Mixed-level mode requires at least one level.");
  }
  const seen = new Set<string>();
  return composition.map((entry) => {
    if (!SUPPORTED_TROOP_LEVELS.some((level) => level === entry.level)) {
      throw new Error(`Level ${entry.level} is not exposed by the PVP UI.`);
    }
    if (seen.has(entry.level)) {
      throw new Error(`Duplicate mixed troop level: ${entry.level}.`);
    }
    seen.add(entry.level);
    if (!Number.isSafeInteger(entry.aliveCount) || entry.aliveCount < 0) {
      throw new RangeError(
        "Mixed-level troop counts must be non-negative safe integers.",
      );
    }
    return { ...entry };
  });
}

function validateT12Level(level: number): number {
  if (!Number.isSafeInteger(level) || level < 0 || level > 24) {
    throw new RangeError("T12 level must be an integer from 0 to 24.");
  }
  return level;
}

function filterTroopDefinitions(
  disabled: ReadonlySet<string>,
): readonly TroopSkillDefinition[] {
  return CONFIRMED_TROOP_SKILL_DEFINITIONS.filter(
    (definition) => !disabled.has(definition.id),
  );
}

function filterHeroDefinitions(
  disabled: ReadonlySet<string>,
): readonly HeroSkillDefinition[] {
  return CONFIRMED_HERO_SKILL_DEFINITIONS.filter(
    (definition) => !disabled.has(definition.id),
  );
}

function disableSkillRuntimes(
  state: BattleState,
  troopIds: ReadonlySet<string>,
  heroIds: ReadonlySet<string>,
): BattleState {
  const filterSide = (side: BattleSide): BattleSide => ({
    ...side,
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
      ...side.troops[troop],
      skillStates: side.troops[troop].skillStates.filter(
        (runtime) => troopIds.has(runtime.skillId),
      ),
    }])) as unknown as BattleSide["troops"],
    heroStates: side.heroStates.map((hero) => ({
      ...hero,
      skillStates: hero.skillStates.filter(
        (runtime) => heroIds.has(runtime.skillId),
      ),
    })),
  });
  return { ...state, sideA: filterSide(state.sideA), sideB: filterSide(state.sideB) };
}

function splitTriggerOverrides(
  overrides: Readonly<Record<string, DebugOverrideMode>>,
): {
  readonly troop: TroopSkillTriggerOverrides;
  readonly hero: HeroSkillTriggerOverrides;
} {
  const troop: Record<string, boolean> = {};
  const hero: Record<string, boolean> = {};
  for (const [key, mode] of Object.entries(overrides)) {
    if (mode === "AUTO") continue;
    const value = mode === "FORCE_TRIGGER";
    if (key.includes("hero-skill.")) hero[key] = value;
    else troop[key] = value;
  }
  return { troop, hero };
}

function collectRoundDamage(
  simulation: BattleSimulationResult,
): readonly ValidationRoundDamage[] {
  return simulation.trace.rounds.map((round) => ({
    round: round.round,
    AtoB: round.damageEvents
      .filter((event) => event.sourceSide === "A")
      .reduce((sum, event) => sum + event.finalDamage, 0),
    BtoA: round.damageEvents
      .filter((event) => event.sourceSide === "B")
      .reduce((sum, event) => sum + event.finalDamage, 0),
  }));
}

function summarizeBattle(
  simulation: BattleSimulationResult,
): ValidationBattleResult["summary"] {
  const aliveA = totalAlive(simulation.finalState.sideA);
  const aliveB = totalAlive(simulation.finalState.sideB);
  const outcome = simulation.endReason === "roundLimit"
    ? "timeout"
    : aliveA === aliveB
      ? "draw"
      : aliveA > aliveB ? "A" : "B";
  return {
    outcome,
    rounds: simulation.rounds.length,
    remaining: {
      A: pickAlive(simulation.finalState, "A"),
      B: pickAlive(simulation.finalState, "B"),
    },
  };
}

function pickAlive(
  state: BattleState,
  sideId: SideId,
): Readonly<Record<TroopType, number>> {
  const side = sideFromState(state, sideId);
  return {
    shield: side.troops.shield.aliveCount,
    lancer: side.troops.lancer.aliveCount,
    marksman: side.troops.marksman.aliveCount,
  };
}

function collectActiveEffects(
  simulation: BattleSimulationResult,
): readonly ValidationEffectSnapshot[] {
  return simulation.rounds.flatMap((resolved) =>
    (["A", "B"] as const).flatMap((sideId) => {
      const side = sideFromState(resolved.snapshot, sideId);
      return [
        ...side.armyEffects.map((effect) => toEffectSnapshot(
          resolved.round,
          sideId,
          "army",
          effect,
        )),
        ...TROOP_TYPES.flatMap((troop) => [
          ...side.troops[troop].buffs,
          ...side.troops[troop].debuffs,
        ].map((effect) => toEffectSnapshot(
          resolved.round,
          sideId,
          troop,
          effect,
        ))),
      ];
    }),
  );
}

function toEffectSnapshot(
  round: number,
  side: SideId,
  holder: "army" | TroopType,
  effect: ActiveEffect,
): ValidationEffectSnapshot {
  const definition = effect.definition;
  const group = definition.kind === "targetingOverride" ||
    definition.kind === "targetBoundMark" ||
    definition.kind === "skipNextRoundAction"
    ? null
    : definition.group;
  const value = definition.kind === "targetingOverride" ||
    definition.kind === "targetBoundMark" ||
    definition.kind === "skipNextRoundAction"
    ? null
    : definition.value;
  return {
    round,
    side,
    holder,
    instanceId: effect.instanceId,
    effectId: definition.id,
    sourceId: effect.identity.sourceId,
    sourceSkillId: effect.identity.sourceSkillId,
    kind: definition.kind,
    group,
    value,
    stacks: effect.stackCount,
    remainingDuration: effect.remainingRounds ?? null,
    activationTiming: definition.lifecycle?.activationTiming ?? "immediate",
    effectiveFromRound: effect.activeFromRound,
    expiresAfterRound: effect.remainingRounds === undefined
      ? null
      : round + effect.remainingRounds - 1,
    firstActiveRound: definition.lifecycle?.firstActiveRound ?? null,
    periodRounds: definition.lifecycle?.periodRounds ?? null,
    activeWindowRounds: definition.lifecycle?.activeWindowRounds ?? null,
    sourceScope: definition.scope?.sourceTroops?.join(",") ?? "army",
    targetScope: definition.scope?.targetTroops?.join(",") ?? "all",
  };
}
