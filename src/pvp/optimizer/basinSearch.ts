import { TROOP_TYPES } from "../types";
import type { RallyTroopRatios } from "../validationUi";
import { ratioNeighbors } from "./theory/ratioPeakDetector";
import type { OptimizationWorkflow } from "./execution";

export interface BasinSearchOptions {
  readonly maxBasins: number; readonly maxBasinsPerHead: number; readonly maxClimbRounds: number;
  readonly fineBasins: number; readonly fineRadius: number; readonly separation: number;
}
export const DEFAULT_BASIN_SEARCH: BasinSearchOptions = {
  maxBasins: 4, maxBasinsPerHead: 2, maxClimbRounds: 6, fineBasins: 4, fineRadius: 5, separation: 10,
};
export interface RatioSearchAudit {
  readonly basins: { id: string; head: string; seed: RallyTroopRatios; centers: RallyTroopRatios[];
    rounds: number; stopReason: "localOptimum" | "roundBudget" | "noConfidenceImprovement" | "flat2Percent";
    fineCenter?: RallyTroopRatios; fineCandidates: number;
    twoPercentEntered?: boolean; onePercentEntered?: boolean; expansionRounds?: number;
    generatedCandidates?: number; improved?: boolean; bestRatio?: RallyTroopRatios }[];
  generatedCoarseNeighbors: number; generatedFineRatios: number; fineHeroLineupCount: number; fineBasinCount: number;
}
export const emptyRatioSearchAudit = (): RatioSearchAudit => ({ basins: [], generatedCoarseNeighbors: 0,
  generatedFineRatios: 0, fineHeroLineupCount: 0, fineBasinCount: 0 });
export function resolveBasinSearchOptions(options: Partial<BasinSearchOptions> = {}): BasinSearchOptions {
  const result = { ...DEFAULT_BASIN_SEARCH, ...options };
  if (Object.values(result).some((value) => !Number.isSafeInteger(value) || value < 1) ||
    result.fineRadius > 10 || result.maxBasins > 50 || result.maxClimbRounds > 20)
    throw new RangeError("Invalid bounded basin search options.");
  return result;
}
/** A local integer window, never the 5151-point global simplex. */
export function fineRatioWindow(center: RallyTroopRatios, radius: number): readonly RallyTroopRatios[] {
  const result: RallyTroopRatios[] = [];
  for (let shield = Math.max(0, Math.ceil(center.shield - radius)); shield <= Math.min(100, Math.floor(center.shield + radius)); shield++)
    for (let lancer = Math.max(0, Math.ceil(center.lancer - radius)); lancer <= Math.min(100 - shield, Math.floor(center.lancer + radius)); lancer++)
      result.push({ shield, lancer, marksman: 100 - shield - lancer });
  return result;
}
export interface BasinAdapter<C, E> {
  readonly candidate: (evaluation: E) => C; readonly ratios: (candidate: C) => RallyTroopRatios;
  readonly head: (candidate: C) => string; readonly key: (candidate: C) => string;
  readonly child: (candidate: C, ratios: RallyTroopRatios, fine: boolean) => C;
  readonly compare: (a: E, b: E) => number;
  /** Must use identical trials/seeds for centers and neighbors, with no partial/pruned rows. */
  readonly evaluate: (candidates: readonly C[], round: number) => OptimizationWorkflow<E[]>;
}
export function* searchRatioBasins<C, E>(ranked: readonly E[], adapter: BasinAdapter<C, E>,
  options: BasinSearchOptions, audit: RatioSearchAudit): OptimizationWorkflow<{ coarse: readonly C[]; fine: readonly C[]; centers: readonly C[] }> {
  const seeds: E[] = [], perHead = new Map<string, number>();
  for (const row of ranked) {
    const candidate = adapter.candidate(row), head = adapter.head(candidate), ratios = adapter.ratios(candidate);
    if ((perHead.get(head) ?? 0) >= options.maxBasinsPerHead || seeds.some((existing) => {
      const other = adapter.candidate(existing);
      return adapter.head(other) === head && Math.max(...TROOP_TYPES.map((troop) =>
        Math.abs(adapter.ratios(other)[troop] - ratios[troop]))) < options.separation;
    })) continue;
    seeds.push(row); perHead.set(head, (perHead.get(head) ?? 0) + 1);
    if (seeds.length >= options.maxBasins) break;
  }
  const centers = seeds.map(adapter.candidate);
  const active = centers.map(() => true), cache = new Map<string, E>();
  const generated = new Map<string, C>();
  const records: RatioSearchAudit["basins"] = centers.map((candidate, i) => ({ id: `basin-${i + 1}`, head: adapter.head(candidate),
    seed: adapter.ratios(candidate), centers: [adapter.ratios(candidate)], rounds: 0,
    stopReason: "roundBudget" as "localOptimum" | "roundBudget", fineCandidates: 0 }));
  audit.basins.push(...records);
  for (let round = 0; round < options.maxClimbRounds && active.some(Boolean); round++) {
    const neighborhoods = centers.map((candidate, i) => active[i] ? [candidate, ...ratioNeighbors(adapter.ratios(candidate), 5)
      .map((ratios) => adapter.child(candidate, ratios, false))] : []);
    const jobs = new Map<string, C>();
    for (const neighbors of neighborhoods) for (const candidate of neighbors) {
      const key = adapter.key(candidate); generated.set(key, candidate);
      if (!cache.has(key)) jobs.set(key, candidate);
    }
    if (jobs.size) for (const row of yield* adapter.evaluate([...jobs.values()], round))
      cache.set(adapter.key(adapter.candidate(row)), row);
    for (let i = 0; i < centers.length; i++) {
      if (!active[i]) continue;
      const center = centers[i]!, incumbent = cache.get(adapter.key(center));
      if (!incumbent) throw new Error("Basin center lacks complete common-seed formal samples.");
      const neighbors = neighborhoods[i]!.flatMap((candidate) => {
        const row = cache.get(adapter.key(candidate)); return row ? [row] : [];
      }).sort(adapter.compare);
      const best = neighbors[0]!; records[i]!.rounds++;
      if (adapter.compare(best, incumbent) < 0 && adapter.key(adapter.candidate(best)) !== adapter.key(center)) {
        centers[i] = adapter.candidate(best); records[i]!.centers.push(adapter.ratios(centers[i]!));
      } else { active[i] = false; records[i]!.stopReason = "localOptimum"; }
    }
  }
  audit.generatedCoarseNeighbors += generated.size - seeds.length;
  const fine = new Map<string, C>();
  const priorKeys = new Set(ranked.map((row) => adapter.key(adapter.candidate(row))));
  // Retain multiple seeds even if their climbs converge; deduplicate only actual jobs.
  for (let i = 0; i < Math.min(options.fineBasins, centers.length); i++) {
    const candidate = centers[i]!, record = records[i]!;
    const window = fineRatioWindow(adapter.ratios(candidate), options.fineRadius);
    record.fineCenter = adapter.ratios(candidate); record.fineCandidates = window.length;
    for (const ratios of window) {
      const child = adapter.child(candidate, ratios, true); fine.set(adapter.key(child), child);
    }
  }
  audit.fineBasinCount += records.filter((record) => record.fineCenter).length;
  audit.fineHeroLineupCount = new Set(audit.basins.filter((record) => record.fineCenter).map((record) => record.head)).size;
  audit.generatedFineRatios += [...fine.keys()].filter((key) => !generated.has(key) && !priorKeys.has(key)).length;
  return { coarse: [...generated.values()], fine: [...fine.values()], centers };
}
