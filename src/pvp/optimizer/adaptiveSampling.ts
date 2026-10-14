import type { FastBattleResult } from "../battle/fastBattleMode";
import type { ValidationBattleInput } from "../validationUi";
import type { SideId } from "../types";
import { TROOP_TYPES } from "../types";
import { type OptimizationWorkflow, type OptimizationPerformance, emptyOptimizationPerformance,
  addOptimizationPerformance } from "./execution";
import type { OptimizerProfiler } from "./profiling";
import { createStageSeeds } from "./seedSet";
import { wilsonInterval } from "./statistics";

export interface AdaptiveSearchOptions {
  readonly enabled: boolean;
  readonly m4Checkpoints: readonly number[];
  readonly finalCheckpoints: readonly number[];
  readonly minimumRunsBeforeElimination: number;
  readonly highUncertaintyMinimumRuns: number;
  readonly uncertaintyThreshold: number;
  readonly tolerance: number;
  readonly familyErrorRate: number;
  readonly minimumFinalRuns: number;
  readonly basinPatience: number;
  readonly twoPercentRounds: number;
  readonly onePercentRounds: number;
}
export const DEFAULT_ADAPTIVE_SEARCH: AdaptiveSearchOptions = {
  enabled: true, m4Checkpoints: [50, 100, 150], finalCheckpoints: [300, 500, 1000],
  minimumRunsBeforeElimination: 30, highUncertaintyMinimumRuns: 100,
  uncertaintyThreshold: .35, tolerance: .005, familyErrorRate: .01,
  minimumFinalRuns: 1000, basinPatience: 2, twoPercentRounds: 3, onePercentRounds: 3,
};
export function resolveAdaptiveSearchOptions(input: Partial<AdaptiveSearchOptions> = {}): AdaptiveSearchOptions {
  const result = { ...DEFAULT_ADAPTIVE_SEARCH, ...input };
  const counts = [result.minimumRunsBeforeElimination, result.highUncertaintyMinimumRuns,
    result.minimumFinalRuns, result.basinPatience, result.twoPercentRounds, result.onePercentRounds];
  if (counts.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 100000) ||
    result.highUncertaintyMinimumRuns < result.minimumRunsBeforeElimination ||
    Math.max(result.basinPatience, result.twoPercentRounds, result.onePercentRounds) > 20 ||
    [result.m4Checkpoints, result.finalCheckpoints].some((rows) => !rows.length ||
      rows.some((n, i) => !Number.isSafeInteger(n) || n < 1 || n > 100000 || (i > 0 && n <= rows[i - 1]!))) ||
    !Number.isFinite(result.tolerance) || result.tolerance < 0 || result.tolerance > 1 ||
    !Number.isFinite(result.uncertaintyThreshold) || result.uncertaintyThreshold < 0 ||
    !Number.isFinite(result.familyErrorRate) || result.familyErrorRate < .000001 || result.familyErrorRate > .05)
    throw new RangeError("Invalid adaptive search options.");
  return result;
}

/** All fields are retained except the RNG controls supplied separately per trial.
 * Full canonical strings, rather than a short lossy hash, are used for equality. */
export function normalizedBattleConfigKey(input: ValidationBattleInput): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) :
    value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)])) : value;
  return `pvp-battle-config-v1:${JSON.stringify(canonical({ ...input, randomSeed: 0, simulationMode: "fixedSeed" }))}`;
}
export interface AdaptiveStageAudit {
  stage: string; candidatesEntered: number; candidatesEliminated: number; candidatesAdvanced: number;
  requestedBattles: number; executedBattles: number; reusedBattles: number; cacheHitRate: number; elapsedMs: number;
}
export interface RacingDecision {
  readonly stage: string; readonly candidateKey: string; readonly checkpoint: number;
  readonly wins: number; readonly losses: number; readonly n: number; readonly winRate: number;
  readonly confidenceLower: number; readonly confidenceUpper: number; readonly cutoffLower: number;
  readonly eliminationReason: "confidenceDominated" | "protectedByUncertainty" | "protectedByTopK" | "protectedReference" | "maxBudgetReached" | "notTopK";
}
export interface SearchIntegrityReport {
  readonly perStage: AdaptiveStageAudit[];
  readonly racing: { eliminatedByConfidence: number; protectedByUncertainty: number; protectedByTopK: number;
    checkpoints: { stage: string; runs: number; entered: number; remaining: number; eliminated: number }[];
    decisions: RacingDecision[] };
  readonly fineSearch: { basinCount: number; basin2PercentEntered: number; basin1PercentEntered: number;
    basinEarlyStopped: number; generated2PercentRatios: number; generated1PercentRatios: number };
  readonly final: { finalistsAt300: number; finalistsAt500: number; finalistsAt1000: number;
    screeningRuns: number; independentValidationRuns: number };
  readonly seedPolicy: { screeningOffset: number; independentOffset: number; finalScreeningPrefix: number };
}
export function emptySearchIntegrityReport(finalScreeningPrefix: number): SearchIntegrityReport {
  return { perStage: [], racing: { eliminatedByConfidence: 0, protectedByUncertainty: 0, protectedByTopK: 0,
    checkpoints: [], decisions: [] }, fineSearch: { basinCount: 0, basin2PercentEntered: 0, basin1PercentEntered: 0,
    basinEarlyStopped: 0, generated2PercentRatios: 0, generated1PercentRatios: 0 },
    final: { finalistsAt300: 0, finalistsAt500: 0, finalistsAt1000: 0, screeningRuns: 0, independentValidationRuns: 0 },
    seedPolicy: { screeningOffset: 0, independentOffset: 500000, finalScreeningPrefix } };
}

/** Coordinator-owned result ledger. Only missing config+seed pairs reach workers.
 * It spans all stages of one search, including aliases and neighborhood candidates. */
export class BattleSampleLedger<C> {
  private readonly inputs = new Map<string, ValidationBattleInput>();
  private readonly signatures = new Map<string, string>();
  private readonly samples = new Map<string, Map<number, FastBattleResult>>();
  performance: OptimizationPerformance = emptyOptimizationPerformance();
  evaluatedBatches = 0;
  executedScreeningRuns = 0;
  executedIndependentRuns = 0;
  constructor(private readonly candidateKey: (candidate: C) => string,
    private readonly makeInput: (candidate: C) => ValidationBattleInput, private readonly side: SideId,
    private readonly profiler?: OptimizerProfiler, private readonly screeningSet?: ReadonlySet<number>) {}
  private input(candidate: C) {
    const key = this.candidateKey(candidate);
    let input = this.inputs.get(key);
    if (!input) { input = this.makeInput(candidate); this.inputs.set(key, input); }
    return input;
  }
  private store(candidate: C) {
    const key = this.candidateKey(candidate);
    let signature = this.signatures.get(key);
    if (!signature) { signature = normalizedBattleConfigKey(this.input(candidate)); this.signatures.set(key, signature); }
    let rows = this.samples.get(signature);
    if (!rows) { rows = new Map(); this.samples.set(signature, rows); }
    return { signature, rows };
  }
  outcomes(candidate: C, seeds: readonly number[]): readonly FastBattleResult[] {
    const rows = this.store(candidate).rows;
    return seeds.map((seed) => { const row = rows.get(seed); if (!row) throw new Error("Missing cumulative battle sample."); return row; });
  }
  completedRunCount(candidate: C, seeds: readonly number[]): number {
    const rows = this.store(candidate).rows;
    let completed = 0;
    for (const seed of seeds) { if (!rows.has(seed)) break; completed++; }
    return completed;
  }
  *sample(candidates: readonly C[], seeds: readonly number[], audit: AdaptiveStageAudit,
    onCompleted?: (completed: number) => void): OptimizationWorkflow<void> {
    const scheduled = new Set<string>();
    let missingWork = 0;
    for (const candidate of candidates) {
      const store = this.store(candidate); if (scheduled.has(store.signature)) continue;
      scheduled.add(store.signature); missingWork += seeds.filter((seed) => !store.rows.has(seed)).length;
    }
    this.profiler?.setExecutionWorkload(missingWork);
    audit.requestedBattles += candidates.length * seeds.length;
    for (let start = 0; start < candidates.length; start += 4) {
      const chunk = candidates.slice(start, start + 4);
      const reserved = new Set<string>();
      const pending = chunk.flatMap((candidate) => {
        const store = this.store(candidate);
        // A duplicate configuration in the same batch is assigned to one job.
        const missing = reserved.has(store.signature) ? [] : seeds.filter((seed) => !store.rows.has(seed));
        reserved.add(store.signature);
        audit.reusedBattles += seeds.length - missing.length;
        this.profiler?.reuseBattles(seeds.length - missing.length);
        return missing.length ? [{ candidate, store, seeds: missing }] : [];
      });
      if (pending.length) {
        const results = yield pending.map(({ candidate, seeds }) => ({ kind: "battle" as const,
          input: this.input(candidate), seeds, side: this.side, collectOutcomes: true,
          rallyCandidate: candidate as never }));
        if (results.length !== pending.length) throw new Error("Invalid cumulative evaluation batch.");
        results.forEach((result, index) => {
          const job = pending[index]!;
          if (result.samples.pruned || result.samples.outcomes.length !== job.seeds.length)
            throw new Error("Cumulative samples must be complete and unpruned.");
          job.seeds.forEach((seed, i) => job.store.rows.set(seed, result.samples.outcomes[i]!));
          audit.executedBattles += job.seeds.length;
          for (const seed of job.seeds) {
            if (!this.screeningSet || this.screeningSet.has(seed)) this.executedScreeningRuns++;
            else this.executedIndependentRuns++;
          }
          this.performance = addOptimizationPerformance(this.performance, result.performance); this.evaluatedBatches++;
        });
      }
      onCompleted?.(Math.min(candidates.length, start + chunk.length));
    }
    audit.cacheHitRate = audit.requestedBattles ? audit.reusedBattles / audit.requestedBattles : 0;
  }
}

/** Separate derivation domains AND a collision check keep independent validation
 * draws disjoint from every possible screening draw in this session. */
export function adaptiveSeedPools(firstSeed: number, screeningBudget: number, finalBudget: number) {
  const screening = createStageSeeds(firstSeed, screeningBudget);
  const screeningSet = new Set(screening);
  const seen = new Set(screening);
  const independent: number[] = [];
  for (let offset = 500000; independent.length < finalBudget; offset += finalBudget) {
    for (const seed of createStageSeeds(firstSeed, finalBudget, offset)) {
      if (seen.has(seed)) continue;
      seen.add(seed); independent.push(seed);
      if (independent.length === finalBudget) break;
    }
  }
  // Even tiny custom Final budgets reserve independent validation draws.
  const prefix = Math.min(screeningBudget, Math.floor(finalBudget / 2));
  return { screening, independent, final: [...screening.slice(0, prefix), ...independent.slice(0, finalBudget - prefix)],
    finalScreeningPrefix: prefix, screeningSet };
}

/** Acklam inverse-normal approximation; only used to widen Wilson intervals for
 * the declared candidates × looks error budget, never for outcome generation. */
export function racingZ(comparisons: number, looks: number, familyErrorRate: number): number {
  const p = Math.min(.02425, familyErrorRate / (2 * Math.max(1, comparisons) * Math.max(1, looks)));
  const q = Math.sqrt(-2 * Math.log(p));
  const c = [-.007784894002430293, -.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [.007784695709041462, .3224671290700398, 2.445134137142996, 3.754408661907416];
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}
export interface RacingSample { readonly trials: number; readonly wins: number; readonly winRate: number; readonly losses?: number; }
export function raceCandidates<C, E extends RacingSample>(rows: readonly E[], settings: {
  candidate: (row: E) => C; key: (candidate: C) => string; uncertainty: (candidate: C) => number;
  hardToStaticize?: (candidate: C) => boolean;
  compare: (a: E, b: E) => number; protected: (candidate: C) => boolean; topK: number;
  stage: string; looks: number; comparisons: number; maxRuns: number; options: AdaptiveSearchOptions;
}, audit: SearchIntegrityReport): E[] {
  const ranked = [...rows].sort(settings.compare), k = Math.min(ranked.length, Math.max(1, settings.topK));
  const topKeys = new Set(ranked.slice(0, k).map((row) => settings.key(settings.candidate(row))));
  const z = racingZ(settings.comparisons, settings.looks, settings.options.familyErrorRate);
  const lower = ranked.map((row) => wilsonInterval(row.wins, row.trials, z)[0]).sort((a, b) => b - a)[k - 1] ?? 0;
  return ranked.filter((row) => {
    const candidate = settings.candidate(row), key = settings.key(candidate);
    const [confidenceLower, confidenceUpper] = wilsonInterval(row.wins, row.trials, z);
    // A truncated stage budget cannot turn 5 or 20 observations into the
    // required 20/40 (or stricter configured) samples of confidence evidence.
    const minimum = settings.uncertainty(candidate) >= settings.options.uncertaintyThreshold || settings.hardToStaticize?.(candidate)
      ? Math.max(40, settings.options.highUncertaintyMinimumRuns) : Math.max(20, settings.options.minimumRunsBeforeElimination);
    let reason: RacingDecision["eliminationReason"] | undefined;
    if (settings.protected(candidate)) reason = "protectedReference";
    else if (topKeys.has(key)) { reason = "protectedByTopK"; audit.racing.protectedByTopK++; }
    else if (row.trials < minimum) { reason = "protectedByUncertainty"; audit.racing.protectedByUncertainty++; }
    else if (confidenceUpper < lower - settings.options.tolerance) {
      reason = "confidenceDominated"; audit.racing.eliminatedByConfidence++;
    } else if (row.trials >= settings.maxRuns) reason = "maxBudgetReached";
    if (reason) audit.racing.decisions.push({ stage: settings.stage, candidateKey: key, checkpoint: row.trials,
      wins: row.wins, losses: row.losses ?? row.trials - row.wins, n: row.trials, winRate: row.winRate,
      confidenceLower, confidenceUpper, cutoffLower: lower, eliminationReason: reason });
    return reason !== "confidenceDominated";
  });
}
export function boundedCheckpoints(checkpoints: readonly number[], max: number): number[] {
  return [...new Set([...checkpoints.filter((n) => n < max), max])].sort((a, b) => a - b);
}

export function pairedBattleImprovement(left: readonly FastBattleResult[], right: readonly FastBattleResult[],
  side: SideId, z: number): boolean {
  if (!left.length || left.length !== right.length) throw new Error("Paired evidence needs equal common-seed samples.");
  let favorable = 0, unfavorable = 0;
  for (let i = 0; i < left.length; i++) {
    if ((left[i]!.outcome === side) !== (right[i]!.outcome === side)) {
      if (left[i]!.outcome === side) favorable++; else unfavorable++;
    }
  }
  if (favorable + unfavorable) return wilsonInterval(favorable, favorable + unfavorable, z)[0] > .5;
  const enemy = side === "A" ? "B" : "A";
  const sum = (row: FastBattleResult, target: SideId) => TROOP_TYPES.reduce((n, troop) => n + row.remaining[target][troop], 0);
  let strict = false;
  for (let i = 0; i < left.length; i++) {
    if (left[i]!.outcome !== right[i]!.outcome || sum(left[i]!, side) < sum(right[i]!, side) || sum(left[i]!, enemy) > sum(right[i]!, enemy)) return false;
    strict ||= sum(left[i]!, side) > sum(right[i]!, side) || sum(left[i]!, enemy) < sum(right[i]!, enemy);
  }
  return strict;
}
