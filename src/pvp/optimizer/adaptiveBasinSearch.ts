import { TROOP_TYPES } from "../types";
import type { RallyTroopRatios } from "../validationUi";
import type { OptimizationWorkflow } from "./execution";
import type { BasinSearchOptions, RatioSearchAudit } from "./basinSearch";
import type { AdaptiveSearchOptions, SearchIntegrityReport } from "./adaptiveSampling";
import { ratioNeighbors } from "./theory/ratioPeakDetector";

export interface AdaptiveBasinAdapter<C, E> {
  readonly candidate: (row: E) => C; readonly ratios: (candidate: C) => RallyTroopRatios;
  readonly head: (candidate: C) => string; readonly key: (candidate: C) => string;
  readonly child: (candidate: C, ratios: RallyTroopRatios, fine: boolean) => C;
  readonly compare: (a: E, b: E) => number;
  readonly confidenceImproves: (candidate: E, incumbent: E, comparisons: number) => boolean;
  readonly evaluate: (candidates: readonly C[], step: number, round: number) => OptimizationWorkflow<E[]>;
}

/** Each basin has its own center/stop counter. Real common-seed evidence, not
 * TheoryScore, controls entry into a bounded 1% neighbor walk. */
export function* searchAdaptiveRatioBasins<C, E>(ranked: readonly E[], adapter: AdaptiveBasinAdapter<C, E>,
  limits: BasinSearchOptions, options: AdaptiveSearchOptions, audit: RatioSearchAudit,
  integrity: SearchIntegrityReport): OptimizationWorkflow<{ candidates: readonly C[]; centers: readonly C[] }> {
  const seeds: C[] = [], perHead = new Map<string, number>();
  for (const row of ranked) {
    const candidate = adapter.candidate(row), head = adapter.head(candidate);
    if ((perHead.get(head) ?? 0) >= limits.maxBasinsPerHead || seeds.some((other) =>
      adapter.head(other) === head && Math.max(...TROOP_TYPES.map((troop) =>
        Math.abs(adapter.ratios(other)[troop] - adapter.ratios(candidate)[troop]))) < limits.separation)) continue;
    seeds.push(candidate); perHead.set(head, (perHead.get(head) ?? 0) + 1);
    if (seeds.length >= limits.maxBasins) break;
  }
  const generated = new Map<string, C>(), centers = [...seeds];
  const records: RatioSearchAudit["basins"] = seeds.map((candidate, index) => ({
    id: `basin-${index + 1}`, head: adapter.head(candidate), seed: adapter.ratios(candidate),
    centers: [adapter.ratios(candidate)], rounds: 0, expansionRounds: 0, generatedCandidates: 0,
    improved: false, bestRatio: adapter.ratios(candidate), stopReason: "roundBudget", fineCandidates: 0,
    twoPercentEntered: false, onePercentEntered: false,
  }));
  audit.basins.push(...records); integrity.fineSearch.basinCount += seeds.length;
  const visited5 = new Set<string>(), visited2 = new Set<string>(), visited1 = new Set<string>();
  const perBasinFine = seeds.map(() => new Set<string>());
  for (const step of [5, 2, 1]) {
    const rounds = step === 5 ? limits.maxClimbRounds : step === 2 ? options.twoPercentRounds : options.onePercentRounds;
    const active = centers.map((_, index) => step !== 1 || records[index]!.onePercentEntered === true);
    const noImprovement = centers.map(() => 0);
    if (step === 2) for (const [index, record] of records.entries()) {
      if (index >= limits.fineBasins) { active[index] = false; continue; }
      record.twoPercentEntered = true; integrity.fineSearch.basin2PercentEntered++;
    }
    for (let round = 0; round < rounds && active.some(Boolean); round++) {
      const neighborhoods = centers.map((center, index) => active[index] ? [center,
        ...ratioNeighbors(adapter.ratios(center), step).map((ratio) => adapter.child(center, ratio, step !== 5))] : []);
      const jobs = new Map<string, C>();
      for (const [index, neighbors] of neighborhoods.entries()) for (const candidate of neighbors) {
        const key = adapter.key(candidate);
        if (!generated.has(key)) records[index]!.generatedCandidates!++;
        generated.set(key, candidate); jobs.set(key, candidate);
        if (step === 5) visited5.add(key);
        if (step === 2) visited2.add(key); if (step === 1) visited1.add(key);
        if (step === 1) perBasinFine[index]!.add(key);
      }
      const rows = yield* adapter.evaluate([...jobs.values()], step, round);
      const evaluations = new Map(rows.map((row) => [adapter.key(adapter.candidate(row)), row]));
      for (const [index, neighbors] of neighborhoods.entries()) {
        if (!active[index]) continue;
        const record = records[index]!, incumbent = evaluations.get(adapter.key(centers[index]!))!;
        if (!incumbent) throw new Error("Adaptive basin incumbent has no complete samples.");
        const sorted = neighbors.map((candidate) => evaluations.get(adapter.key(candidate))!)
          .filter(Boolean).sort(adapter.compare);
        const best = sorted[0]!;
        const improved = adapter.key(adapter.candidate(best)) !== adapter.key(centers[index]!) &&
          adapter.confidenceImproves(best, incumbent, Math.max(1, seeds.length * rounds * 6));
        record.expansionRounds!++; if (step === 5) record.rounds++;
        if (improved) {
          centers[index] = adapter.candidate(best); record.centers.push(adapter.ratios(centers[index]!));
          record.bestRatio = adapter.ratios(centers[index]!); record.improved = true; noImprovement[index] = 0;
          if (step === 2 && !record.onePercentEntered) {
            record.onePercentEntered = true; record.fineCenter = adapter.ratios(centers[index]!);
            integrity.fineSearch.basin1PercentEntered++;
          }
          if (step === 2 && record.onePercentEntered) record.fineCenter = adapter.ratios(centers[index]!);
        } else {
          noImprovement[index]!++;
          if (noImprovement[index]! >= options.basinPatience || round === rounds - 1) {
            active[index] = false;
            record.stopReason = step === 2 && !record.onePercentEntered ? "flat2Percent" : "noConfidenceImprovement";
          }
        }
      }
    }
  }
  integrity.fineSearch.basinEarlyStopped += records.filter((record) => record.stopReason !== "roundBudget").length;
  integrity.fineSearch.generated2PercentRatios += visited2.size;
  integrity.fineSearch.generated1PercentRatios += visited1.size;
  audit.generatedCoarseNeighbors += [...visited5].filter((key) => !seeds.some((candidate) => adapter.key(candidate) === key)).length;
  audit.generatedFineRatios += visited1.size;
  audit.fineBasinCount += records.filter((record) => record.onePercentEntered).length;
  audit.fineHeroLineupCount = new Set(records.filter((record) => record.onePercentEntered).map((record) => record.head)).size;
  for (const [index, record] of records.entries()) record.fineCandidates = perBasinFine[index]!.size;
  return { candidates: [...generated.values()], centers };
}
