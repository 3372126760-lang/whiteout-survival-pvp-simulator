import type { SideId } from "../types";
import { compileValidationBattle, type ValidationProbabilityDecision } from "./adapter";
import { getActiveSkillUniverse } from "./activeSkillUniverse";
import { sortActiveSkillsForUi } from "./activeSkillSorting";
import { generateValidationRandomSeed } from "./randomMode";
import type { ValidationBattleInput } from "./types";
import { resolvePostBattleCasualties, type TroopPopulation } from "../postBattle/casualtyResolver";
import { averageSkillDamageStatistics, legacySkillCasualties, mergeSkillDamageStatistics, projectSkillDefeats, reportedSkillActivations,
  type SkillDamageStatistics } from "../statistics/skillDamageAttribution";

export const DEFAULT_BATCH_SIMULATION_COUNT = 1_000;
export const MIN_BATCH_SIMULATION_COUNT = 1;
export const MAX_BATCH_SIMULATION_COUNT = 100_000;

export interface BatchSkillStatistics {
  readonly side: SideId;
  readonly skillId: string;
  readonly skillName: string;
  readonly uiSummary: string;
  readonly probabilityCheckCount: number;
  readonly procSuccessCount: number;
  readonly actualActivationCount: number;
  readonly actualTriggerRate: number | null;
  readonly theoreticalProbability: number;
}

export interface BatchSimulationResult {
  readonly simulationCount: number;
  readonly simulationMode: "fixedSeed" | "random";
  readonly firstSeed: number;
  readonly lastSeed: number;
  readonly outcomes: {
    readonly A: number;
    readonly B: number;
    readonly draw: number;
    readonly timeout: number;
  };
  readonly winRates: { readonly A: number; readonly B: number };
  readonly averageRounds: number;
  /** Sum of generated finalDamage (rounded), before HP/shield/overflow settlement. */
  readonly averageDamage: { readonly A: number; readonly B: number };
  /** Expected survivors, sourced from each trial's final-state summary. */
  readonly expectedRemaining: Readonly<Record<SideId, BatchRemainingStatistics>>;
  /** Expected troops removed from the battle under the existing report semantics. */
  readonly expectedExitedTotal: Readonly<Record<SideId, number>>;
  /** Empirical final-result distributions; no per-trial trace is retained. */
  readonly distributions: BatchDistributions;
  readonly skillStatistics: readonly BatchSkillStatistics[];
  /** Mean attributed exits, including fractional pool/segment shares; not additional casualties. */
  readonly meanSkillCasualties: Readonly<Record<SideId, Readonly<Record<string, number>>>>;
  /** Per-trial post-battle conversion FIRST, then mean; no full trial trace retained. */
  readonly skillDamageStatistics?: SkillDamageStatistics;
  /** Cumulative report activations, including deterministic skills and duplicate runtimes. */
  readonly skillDisplayLayout?: ReturnType<typeof getActiveSkillUniverse>;
  readonly skillActivationCounts?: Readonly<Record<SideId, Readonly<Record<string, number>>>>;
}

export interface BatchMetricDistribution {
  readonly mean: number;
  readonly p05: number;
  readonly p50: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
}

export type BatchTroopMetric = "total" | "shield" | "lancer" | "marksman";
export interface BatchDistributions {
  readonly roundCount: BatchMetricDistribution;
  readonly sides: Readonly<Record<SideId, {
    readonly remaining: Readonly<Record<BatchTroopMetric, BatchMetricDistribution>>;
    readonly exited: Readonly<Record<BatchTroopMetric, BatchMetricDistribution>>;
  }>>;
}

type BatchMetricSamples = Record<BatchTroopMetric, number[]>;
function emptyMetricSamples(): BatchMetricSamples {
  return { total: [], shield: [], lancer: [], marksman: [] };
}

/** Nearest-rank empirical percentiles: x(ceil(p*N)), with one-based ranks. */
export function summarizeBatchMetric(values: readonly number[]): BatchMetricDistribution {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("Batch metric requires at least one finite sample.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number): number => sorted[Math.ceil(p * sorted.length) - 1]!;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p05: rank(.05), p50: rank(.50), p95: rank(.95),
    min: sorted[0]!, max: sorted[sorted.length - 1]!,
  };
}

function summarizeTroopMetrics(samples: BatchMetricSamples): Record<BatchTroopMetric, BatchMetricDistribution> {
  return {
    total: summarizeBatchMetric(samples.total),
    shield: summarizeBatchMetric(samples.shield),
    lancer: summarizeBatchMetric(samples.lancer),
    marksman: summarizeBatchMetric(samples.marksman),
  };
}

export interface BatchRemainingStatistics {
  readonly total: number;
  readonly shield: number;
  readonly lancer: number;
  readonly marksman: number;
}

interface MutableSkillStatistics {
  side: SideId;
  skillId: string;
  skillName: string;
  uiSummary: string;
  probabilityCheckCount: number;
  procSuccessCount: number;
  actualActivationCount: number;
  probabilityTotal: number;
  fallbackProbability: number;
}

/**
 * Runs independent seeded trials. No BattleTrace or readable log is created.
 */
export function runBatchSimulation(
  input: ValidationBattleInput,
  count: number,
  randomUint32?: () => number,
  onProgress?: (completed: number, total: number) => void,
): BatchSimulationResult {
  validateBatchSimulationCount(count);
  const simulationMode = input.simulationMode ?? "fixedSeed";
  const firstSeed = simulationMode === "random"
    ? generateValidationRandomSeed(randomUint32)
    : normalizeUint32(input.randomSeed);
  const outcomes = { A: 0, B: 0, draw: 0, timeout: 0 };
  const skills = new Map<string, MutableSkillStatistics>();
  const skillActivationCounts: Record<SideId, Record<string, number>> = { A: {}, B: {} };
  let skillDamageTotals: SkillDamageStatistics | undefined;
  const skillOrder = new Map<string, number>();
  let totalRounds = 0;
  let totalDamageA = 0;
  let totalDamageB = 0;
  const totalRemaining = {
    A: { shield: 0, lancer: 0, marksman: 0 },
    B: { shield: 0, lancer: 0, marksman: 0 },
  };
  const totalExited = { A: 0, B: 0 };
  const roundSamples: number[] = [];
  const samples = {
    A: { remaining: emptyMetricSamples(), exited: emptyMetricSamples() },
    B: { remaining: emptyMetricSamples(), exited: emptyMetricSamples() },
  };
  const compiled = compileValidationBattle(input);
  const initialCounts = (side: SideId): TroopPopulation => Object.fromEntries(
    (["shield", "lancer", "marksman"] as const).map((troop) => [troop,
      (side === "A" ? compiled.initialState.sideA : compiled.initialState.sideB).troops[troop].initialCount]),
  ) as TroopPopulation;
  const initial = { A: initialCounts("A"), B: initialCounts("B") };
  const active = sortActiveSkillsForUi(
    getActiveSkillUniverse(compiled.initialState).filter(
      (skill) => skill.probability !== null,
    ),
  );
  active.forEach((skill, order) => {
    const key = skillKey(skill.side, skill.id);
    skillOrder.set(key, order);
    skills.set(key, {
      side: skill.side,
      skillId: skill.id,
      skillName: skill.name,
      uiSummary: skill.uiSummary,
      probabilityCheckCount: 0,
      procSuccessCount: 0,
      actualActivationCount: 0,
      probabilityTotal: 0,
      fallbackProbability: skill.probability ?? 0,
    });
  });

  for (let index = 0; index < count; index += 1) {
    const seed = deriveBatchSeed(firstSeed, index);
    const trial = compiled.runTrial(seed, "summary", (decision) =>
      aggregateDecision(skills, decision), (activation) => {
        const skill = skills.get(skillKey(activation.side, activation.skillId));
        if (skill !== undefined) skill.actualActivationCount += activation.count;
      }, (troop, hero) => {
        for (const entry of [...troop, ...hero]) {
          const activations = reportedSkillActivations(entry);
          if (activations === 0) continue;
          const totals = skillActivationCounts[entry.side];
          totals[entry.skillId] = (totals[entry.skillId] ?? 0) + activations;
        }
      });
    const aliveA = sumAlive(trial.finalState.sideA.troops);
    const aliveB = sumAlive(trial.finalState.sideB.troops);
    const outcome = trial.endReason === "roundLimit" ? "timeout"
      : aliveA === aliveB ? "draw" : aliveA > aliveB ? "A" : "B";
    outcomes[outcome] += 1;
    totalRounds += trial.roundCount;
    roundSamples.push(trial.roundCount);
    totalDamageA += trial.totalDamage.A;
    totalDamageB += trial.totalDamage.B;
    const survivors = (side: SideId): TroopPopulation => Object.fromEntries(
      (["shield", "lancer", "marksman"] as const).map((troop) => [troop,
        (side === "A" ? trial.finalState.sideA : trial.finalState.sideB).troops[troop].aliveCount]),
    ) as TroopPopulation;
    const statistics = projectSkillDefeats(trial.damageAttribution, {
      A: resolvePostBattleCasualties(initial.A, survivors("A"), input.scenarioType === "CITY_DEFENSE" ? "FURNACE" : input.postBattleCasualtyMode ?? "NORMAL"),
      B: resolvePostBattleCasualties(initial.B, survivors("B"), input.scenarioType === "CITY_DEFENSE" ? "NORMAL" : input.postBattleCasualtyMode ?? "NORMAL"),
    });
    if (skillDamageTotals === undefined) skillDamageTotals = statistics;
    else mergeSkillDamageStatistics(skillDamageTotals, statistics);
    for (const side of ["A", "B"] as const) {
      const remaining = (side === "A" ? trial.finalState.sideA : trial.finalState.sideB).troops;
      totalRemaining[side].shield += remaining.shield.aliveCount;
      totalRemaining[side].lancer += remaining.lancer.aliveCount;
      totalRemaining[side].marksman += remaining.marksman.aliveCount;
      const remainingTotal = sumAlive(remaining);
      const initialSide = side === "A" ? compiled.initialState.sideA : compiled.initialState.sideB;
      const exitedTotal = initialSide.initialTotalCount - remainingTotal;
      totalExited[side] += exitedTotal;
      samples[side].remaining.total.push(remainingTotal);
      samples[side].exited.total.push(exitedTotal);
      for (const troop of ["shield", "lancer", "marksman"] as const) {
        samples[side].remaining[troop].push(remaining[troop].aliveCount);
        samples[side].exited[troop].push(
          initialSide.troops[troop].initialCount - remaining[troop].aliveCount,
        );
      }
    }
    if ((index + 1) % 25 === 0 || index + 1 === count) {
      onProgress?.(index + 1, count);
    }
  }

  const skillStatistics = [...skills.values()]
    .map((skill): BatchSkillStatistics => ({
      side: skill.side,
      skillId: skill.skillId,
      skillName: skill.skillName,
      uiSummary: skill.uiSummary,
      probabilityCheckCount: skill.probabilityCheckCount,
      procSuccessCount: skill.procSuccessCount,
      actualActivationCount: skill.actualActivationCount,
      actualTriggerRate: skill.probabilityCheckCount === 0
        ? null
        : skill.procSuccessCount / skill.probabilityCheckCount,
      theoreticalProbability: skill.probabilityCheckCount === 0
        ? skill.fallbackProbability
        : skill.probabilityTotal / skill.probabilityCheckCount,
    }))
    .sort((left, right) =>
      (skillOrder.get(skillKey(left.side, left.skillId)) ?? Number.MAX_SAFE_INTEGER) -
        (skillOrder.get(skillKey(right.side, right.skillId)) ?? Number.MAX_SAFE_INTEGER) ||
      left.side.localeCompare(right.side) ||
      left.skillName.localeCompare(right.skillName)
    );

  const skillDamageStatistics = averageSkillDamageStatistics(skillDamageTotals!, count);
  return {
    simulationCount: count,
    simulationMode,
    firstSeed,
    lastSeed: deriveBatchSeed(firstSeed, count - 1),
    outcomes,
    winRates: { A: outcomes.A / count, B: outcomes.B / count },
    averageRounds: totalRounds / count,
    averageDamage: { A: totalDamageA / count, B: totalDamageB / count },
    expectedRemaining: {
      A: averageRemaining(totalRemaining.A, count),
      B: averageRemaining(totalRemaining.B, count),
    },
    expectedExitedTotal: {
      A: totalExited.A / count,
      B: totalExited.B / count,
    },
    distributions: {
      roundCount: summarizeBatchMetric(roundSamples),
      sides: {
        A: { remaining: summarizeTroopMetrics(samples.A.remaining), exited: summarizeTroopMetrics(samples.A.exited) },
        B: { remaining: summarizeTroopMetrics(samples.B.remaining), exited: summarizeTroopMetrics(samples.B.exited) },
      },
    },
    skillStatistics,
    skillDamageStatistics,
    skillActivationCounts,
    skillDisplayLayout: getActiveSkillUniverse(compiled.initialState),
    meanSkillCasualties: legacySkillCasualties(skillDamageStatistics),
  };
}

function sumAlive(troops: {
  readonly shield: { readonly aliveCount: number };
  readonly lancer: { readonly aliveCount: number };
  readonly marksman: { readonly aliveCount: number };
}): number {
  return troops.shield.aliveCount + troops.lancer.aliveCount + troops.marksman.aliveCount;
}

function averageRemaining(
  totals: { readonly shield: number; readonly lancer: number; readonly marksman: number },
  count: number,
): BatchRemainingStatistics {
  const shield = totals.shield / count;
  const lancer = totals.lancer / count;
  const marksman = totals.marksman / count;
  return {
    shield,
    lancer,
    marksman,
    // Deriving this from the three expectations keeps the displayed invariant exact.
    total: shield + lancer + marksman,
  };
}

export function validateBatchSimulationCount(count: number): void {
  if (
    !Number.isSafeInteger(count) ||
    count < MIN_BATCH_SIMULATION_COUNT ||
    count > MAX_BATCH_SIMULATION_COUNT
  ) {
    throw new RangeError(
      `Batch simulation count must be an integer from ${MIN_BATCH_SIMULATION_COUNT} to ${MAX_BATCH_SIMULATION_COUNT}.`,
    );
  }
}

/** Distinct, deterministic uint32 seeds for up to the supported 100k trials. */
export function deriveBatchSeed(firstSeed: number, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError("Batch seed index must be a non-negative safe integer.");
  }
  return (normalizeUint32(firstSeed) + index) % 0x1_0000_0000;
}

function normalizeUint32(seed: number): number {
  if (!Number.isSafeInteger(seed)) throw new RangeError("Seed must be a safe integer.");
  return ((seed % 0x1_0000_0000) + 0x1_0000_0000) % 0x1_0000_0000;
}

function aggregateDecision(
  skills: Map<string, MutableSkillStatistics>,
  decision: ValidationProbabilityDecision,
): void {
  const key = skillKey(decision.side, decision.skillId);
  const current = skills.get(key) ?? {
    side: decision.side,
    skillId: decision.skillId,
    skillName: decision.skillId,
    uiSummary: decision.skillId,
    probabilityCheckCount: 0,
    procSuccessCount: 0,
    actualActivationCount: 0,
    probabilityTotal: 0,
    fallbackProbability: decision.probability,
  };
  current.probabilityCheckCount += 1;
  current.probabilityTotal += decision.probability;
  if (decision.triggered) {
    current.procSuccessCount += 1;
    current.actualActivationCount += 1;
  }
  skills.set(key, current);
}

function skillKey(side: SideId, skillId: string): string {
  return `${side}:${skillId}`;
}
