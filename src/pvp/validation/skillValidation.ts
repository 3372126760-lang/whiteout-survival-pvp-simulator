import { TROOP_TYPES } from "../types/combat";
import type { SideId, TroopType } from "../types/combat";
import {
  createValidationPreviewState,
  getActiveSkillUniverse,
  runBatchSimulation,
  type BatchSimulationResult,
  type DebugOverrideMode,
  type ValidationActiveSkillOption,
  type ValidationBattleInput,
  type ValidationSideInput,
} from "../validationUi";

export type SkillValidationKind = "probability" | "impact";

export interface SkillValidationFixtureTroop {
  readonly count: number;
  readonly level: string;
  readonly t12Level?: number;
}

export interface SkillValidationFixtureSide {
  readonly shield: SkillValidationFixtureTroop;
  readonly lancer: SkillValidationFixtureTroop;
  readonly marksman: SkillValidationFixtureTroop;
}

export interface SkillValidationFixture {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: SkillValidationKind;
  readonly skillId: string;
  readonly targetSide: SideId;
  readonly simulationCount: number;
  readonly randomSeed: number;
  readonly maxRounds: number;
  readonly sides: Readonly<Record<SideId, SkillValidationFixtureSide>>;
  readonly probability?: {
    readonly theoretical: number;
    readonly absoluteTolerance: number;
    readonly expectedChecksPerTrial?: number;
  };
  readonly theoreticalImpact?: {
    readonly damageGain?: number;
    readonly damageTakenReduction?: number;
  };
}

export interface SkillValidationCase {
  readonly fixture: SkillValidationFixture;
  readonly baselineInput: ValidationBattleInput;
  readonly skillInput: ValidationBattleInput;
  readonly targetOverrideKeys: readonly string[];
}

export interface SkillProbabilityValidation {
  readonly theoreticalProbability: number;
  readonly engineProbability: number;
  readonly probabilityCheckCount: number;
  readonly procSuccessCount: number;
  readonly actualProbability: number | null;
  readonly absoluteDeviation: number | null;
}

export interface SkillImpactValidation {
  readonly averageDamageIncrease: number;
  readonly equivalentDamageGain: number | null;
  readonly averageRemainingIncrease: number;
  readonly averageEnemyDamageChange: number;
  readonly equivalentDamageTakenReduction: number | null;
  readonly averageRoundsChange: number;
  readonly winRateChange: number;
}

export interface SkillValidationReport {
  readonly fixture: SkillValidationFixture;
  readonly simulationCount: number;
  readonly baseline: BatchSimulationResult;
  readonly skill: BatchSimulationResult;
  readonly probability: SkillProbabilityValidation | null;
  readonly impact: SkillImpactValidation;
  readonly nonTargetProbabilitySuccessCount: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

/**
 * Builds a paired baseline/single-skill case. Both branches use identical seed
 * sequences. Every non-target probability skill is forced off automatically.
 */
export function createSkillValidationCase(
  fixture: SkillValidationFixture,
  defaultInput: ValidationBattleInput,
): SkillValidationCase {
  validateSkillValidationFixture(fixture);
  const configured: ValidationBattleInput = {
    ...defaultInput,
    sideA: applyFixtureSide(defaultInput.sideA, fixture.sides.A),
    sideB: applyFixtureSide(defaultInput.sideB, fixture.sides.B),
    maxRounds: fixture.maxRounds,
    randomSeed: fixture.randomSeed,
    simulationMode: "fixedSeed",
    triggerOverrides: {},
    disabledSkillIds: defaultInput.disabledSkillIds.filter(
      (skillId) => skillId !== fixture.skillId,
    ),
    actualRounds: [],
  };
  const activeSkills = getActiveSkillUniverse(
    createValidationPreviewState(configured),
  );
  const targets = activeSkills.filter(
    (skill) => skill.side === fixture.targetSide && skill.id === fixture.skillId,
  );
  if (targets.length === 0) {
    throw new Error(
      `Skill validation fixture ${fixture.id} does not activate ${fixture.targetSide}:${fixture.skillId}.`,
    );
  }

  const allProbabilityOff = forceAllProbabilitySkillsOff(activeSkills);
  const targetOverrideKeys = targets.flatMap(probabilityOverrideKeys);
  if (fixture.kind === "probability" && targetOverrideKeys.length === 0) {
    throw new Error(`Skill validation target ${fixture.skillId} is not probabilistic.`);
  }
  const targetAuto = { ...allProbabilityOff };
  for (const key of targetOverrideKeys) delete targetAuto[key];

  return {
    fixture,
    targetOverrideKeys,
    baselineInput: fixture.kind === "probability"
      ? { ...configured, triggerOverrides: allProbabilityOff }
      : {
          ...configured,
          triggerOverrides: allProbabilityOff,
          disabledSkillIds: [...configured.disabledSkillIds, fixture.skillId],
        },
    skillInput: {
      ...configured,
      triggerOverrides: targetAuto,
    },
  };
}

export function runSkillValidationCase(
  validationCase: SkillValidationCase,
  simulationCount = validationCase.fixture.simulationCount,
): SkillValidationReport {
  const { fixture } = validationCase;
  const baseline = runBatchSimulation(validationCase.baselineInput, simulationCount);
  const skill = runBatchSimulation(validationCase.skillInput, simulationCount);
  const targetStatistic = skill.skillStatistics.find(
    (entry) => entry.side === fixture.targetSide && entry.skillId === fixture.skillId,
  );
  const probability = fixture.kind === "probability" && fixture.probability !== undefined
    ? toProbabilityValidation(fixture, targetStatistic)
    : null;
  const oppositeSide: SideId = fixture.targetSide === "A" ? "B" : "A";
  const baselineRemaining = baseline.expectedRemaining[fixture.targetSide].total;
  const skillRemaining = skill.expectedRemaining[fixture.targetSide].total;
  const baselineDamage = baseline.averageDamage[fixture.targetSide];
  const skillDamage = skill.averageDamage[fixture.targetSide];
  const baselineEnemyDamage = baseline.averageDamage[oppositeSide];
  const skillEnemyDamage = skill.averageDamage[oppositeSide];
  const failures: string[] = [];
  const probabilityExpectation = fixture.probability;
  const nonTargetProbabilitySuccessCount = skill.skillStatistics
    .filter((entry) =>
      entry.side !== fixture.targetSide || entry.skillId !== fixture.skillId
    )
    .reduce((sum, entry) => sum + entry.procSuccessCount, 0);

  if (nonTargetProbabilitySuccessCount !== 0) {
    failures.push(
      `Non-target probability skills triggered ${nonTargetProbabilitySuccessCount} times.`,
    );
  }
  if (probability !== null && probabilityExpectation !== undefined) {
    if (probability.probabilityCheckCount === 0) {
      failures.push("Target probability skill was never checked.");
    }
    if (
      probability.absoluteDeviation === null ||
      probability.absoluteDeviation > probabilityExpectation.absoluteTolerance
    ) {
      failures.push(
        `Probability deviation exceeded ${probabilityExpectation.absoluteTolerance}.`,
      );
    }
    if (
      Math.abs(probability.engineProbability - probabilityExpectation.theoretical) >
        1e-12
    ) {
      failures.push(
        `Engine probability ${probability.engineProbability} differs from fixture ${probabilityExpectation.theoretical}.`,
      );
    }
    if (probabilityExpectation.expectedChecksPerTrial !== undefined) {
      const expectedChecks = probabilityExpectation.expectedChecksPerTrial * simulationCount;
      if (probability.probabilityCheckCount !== expectedChecks) {
        failures.push(
          `Expected ${expectedChecks} checks, received ${probability.probabilityCheckCount}.`,
        );
      }
    }
  }

  return {
    fixture,
    simulationCount,
    baseline,
    skill,
    probability,
    impact: {
      averageDamageIncrease: skillDamage - baselineDamage,
      equivalentDamageGain: ratioChange(skillDamage, baselineDamage),
      averageRemainingIncrease: skillRemaining - baselineRemaining,
      averageEnemyDamageChange: skillEnemyDamage - baselineEnemyDamage,
      equivalentDamageTakenReduction: baselineEnemyDamage === 0
        ? null
        : 1 - skillEnemyDamage / baselineEnemyDamage,
      averageRoundsChange: skill.averageRounds - baseline.averageRounds,
      winRateChange:
        skill.winRates[fixture.targetSide] - baseline.winRates[fixture.targetSide],
    },
    nonTargetProbabilitySuccessCount,
    passed: failures.length === 0,
    failures,
  };
}

export function validateSkillValidationFixture(
  fixture: SkillValidationFixture,
): void {
  if (fixture.schemaVersion !== 1) throw new Error("Unsupported skill fixture schema.");
  if (fixture.id.trim() === "" || fixture.skillId.trim() === "") {
    throw new Error("Skill fixture id and skillId are required.");
  }
  if (!Number.isSafeInteger(fixture.simulationCount) || fixture.simulationCount < 1) {
    throw new Error("Skill fixture simulationCount must be a positive integer.");
  }
  if (!Number.isSafeInteger(fixture.maxRounds) || fixture.maxRounds < 1) {
    throw new Error("Skill fixture maxRounds must be a positive integer.");
  }
  for (const side of ["A", "B"] as const) {
    for (const troop of TROOP_TYPES) {
      const entry = fixture.sides[side][troop];
      if (!Number.isSafeInteger(entry.count) || entry.count < 0) {
        throw new Error(`${side}.${troop}.count must be a non-negative integer.`);
      }
    }
  }
  if (fixture.kind === "probability") {
    const probability = fixture.probability;
    if (
      probability === undefined || probability.theoretical < 0 ||
      probability.theoretical > 1 || probability.absoluteTolerance < 0
    ) {
      throw new Error("Probability fixtures require a valid probability expectation.");
    }
  }
}

function applyFixtureSide(
  side: ValidationSideInput,
  fixture: SkillValidationFixtureSide,
): ValidationSideInput {
  return {
    ...side,
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => {
      const configured = fixture[troop];
      return [troop, {
        ...side.troops[troop],
        count: configured.count,
        troopLevel: configured.level,
        levelMode: "single" as const,
        levelComposition: [{
          level: configured.level,
          aliveCount: configured.count,
        }],
        t12Level: configured.t12Level ?? 0,
      }];
    })) as unknown as ValidationSideInput["troops"],
  };
}

function forceAllProbabilitySkillsOff(
  skills: readonly ValidationActiveSkillOption[],
): Readonly<Record<string, DebugOverrideMode>> {
  const overrides: Record<string, DebugOverrideMode> = {};
  for (const skill of skills) {
    if (skill.probability === null) continue;
    for (const key of probabilityOverrideKeys(skill)) {
      overrides[key] = "FORCE_NOT_TRIGGER";
    }
  }
  return overrides;
}

function probabilityOverrideKeys(
  skill: ValidationActiveSkillOption,
): readonly string[] {
  if (skill.probability === null) return [];
  return skill.perTroop
    ? skill.applicableTroops.map(
        (troop) => `${skill.side}:${troop}:${skill.id}`,
      )
    : [`${skill.side}:${skill.id}`];
}

function toProbabilityValidation(
  fixture: SkillValidationFixture,
  statistic: BatchSimulationResult["skillStatistics"][number] | undefined,
): SkillProbabilityValidation {
  const theoretical = fixture.probability?.theoretical ?? 0;
  const actual = statistic?.actualTriggerRate ?? null;
  return {
    theoreticalProbability: theoretical,
    engineProbability: statistic?.theoreticalProbability ?? 0,
    probabilityCheckCount: statistic?.probabilityCheckCount ?? 0,
    procSuccessCount: statistic?.procSuccessCount ?? 0,
    actualProbability: actual,
    absoluteDeviation: actual === null ? null : Math.abs(actual - theoretical),
  };
}

function ratioChange(value: number, baseline: number): number | null {
  return baseline === 0 ? null : value / baseline - 1;
}

export function skillValidationTroopTotal(
  side: SkillValidationFixtureSide,
): number {
  return TROOP_TYPES.reduce((sum, troop: TroopType) => sum + side[troop].count, 0);
}
