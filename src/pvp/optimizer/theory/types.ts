import type { ExpectationProgram } from "./expectationProgram";
import type { SideId } from "../../types";
import type { RallyTroopRatios, ValidationBattleInput } from "../../validationUi";

export type SelectionReason = "criterionTop" | "matrixCriterion" | "roundTheory" | "theoryLocalPeak" | "theoryTop" | "uncertaintyExploration" |
  "randomExploration" | "ratioDiversity" | "localExpansion" | "fineSearch" | "bodyScreening" | "currentConfig" | "protectedReference";
export interface TheoryOptions {
  readonly ratioStep: number;
  readonly localPeaksPerLineup: number;
  readonly minSurvivorsPerLineup: number;
  readonly randomExploration: number;
  readonly diversityExploration: number;
  readonly uncertaintyExploration: number;
  readonly uncertaintyWeight: number;
  readonly deterministicRounds: number;
  /** Uncalibrated default is mathematical expectation, not a claimed fitted value. */
  readonly probabilityEquivalentCoefficient: number;
  /** Expected effect values, keyed by effect ID; takes precedence over p × value. */
  readonly calibratedEquivalents: Readonly<Record<string, number>>;
}
export function defaultTheoryOptions(): TheoryOptions {
  return { ratioStep: 5, localPeaksPerLineup: 3, minSurvivorsPerLineup: 1,
    randomExploration: 1, diversityExploration: 1, uncertaintyExploration: 1,
    uncertaintyWeight: 1, deterministicRounds: 24,
    probabilityEquivalentCoefficient: 1, calibratedEquivalents: {} };
}
export function validateTheoryOptions(options: TheoryOptions): void {
  const positive = [options.localPeaksPerLineup, options.minSurvivorsPerLineup, options.deterministicRounds];
  const counts = [options.randomExploration, options.diversityExploration, options.uncertaintyExploration];
  if (!Number.isSafeInteger(options.ratioStep) || options.ratioStep < 1 || 100 % options.ratioStep !== 0 ||
    positive.some((n) => !Number.isSafeInteger(n) || n < 1) || counts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !Number.isFinite(options.uncertaintyWeight) || options.uncertaintyWeight < 0 ||
    !Number.isFinite(options.probabilityEquivalentCoefficient) || options.probabilityEquivalentCoefficient < 0 ||
    Object.values(options.calibratedEquivalents).some((n) => !Number.isFinite(n) || n < 0)) throw new RangeError("Invalid theory options.");
}
export interface ProbabilityEquivalent {
  readonly skillId: string;
  readonly effectId: string;
  readonly mathematicalExpectation: number;
  readonly calibratedEquivalent?: number;
  readonly usedEquivalent: number;
}
export interface TheorySide {
  readonly total: number;
  readonly counts: readonly number[];
  readonly hp: readonly number[];
  readonly ehp: readonly number[];
  /** Unit damage after the official attribute/effect functions; multiply by sqrt(N0*n). */
  readonly damage: readonly number[];
  readonly normalDamage: readonly number[];
  readonly priorities: readonly (readonly number[])[];
  readonly uncertainty: number;
}
export interface TheoryTemplate {
  readonly sideA: TheorySide;
  readonly sideB: TheorySide;
  readonly targetSide: SideId;
  readonly maxRounds: number;
  readonly probabilityEquivalents: readonly ProbabilityEquivalent[];
  readonly omittedMechanisms: readonly string[];
  readonly expectationProgram?: ExpectationProgram;
}
export interface TheoryMetrics {
  readonly initialDps: readonly [number, number];
  readonly ehp: readonly [number, number];
  readonly firstTargetTtk: readonly [number, number];
  readonly shieldSurvivalRounds: readonly [number, number];
  readonly marksmanOutputWindow: readonly [number, number];
  readonly initialNextRoundOutput?: readonly [number, number];
  readonly nextRoundOutput?: readonly [number, number];
  readonly outputRetention?: readonly [number, number];
  readonly nextRoundOutputMatrix?: readonly [readonly number[], readonly number[]];
}
export interface TheoryEstimate {
  readonly theoryScore: number;
  readonly uncertainty: number;
  readonly staticTheoryScore: number;
  readonly deterministicScore: number;
  readonly metrics: TheoryMetrics;
}
export interface TheorySelection {
  readonly ratios: RallyTroopRatios;
  readonly estimate: TheoryEstimate;
  readonly selectionReasons: readonly SelectionReason[];
}
export interface TheoryCoverage {
  readonly theoryCandidateCount: number;
  readonly legalHeroLineupCount: number;
  readonly theoryHeroCoverage: number;
  readonly ratiosPerHeroLineup: number;
  readonly localPeaksDetected: number;
  readonly battleCandidateCount: number;
  readonly heroLineupsEnteringBattleEngine: number;
  readonly battleHeroCoverage: number;
}
export type TheoryTemplateBuilder = (input: ValidationBattleInput, targetSide?: SideId) => TheoryTemplate;
