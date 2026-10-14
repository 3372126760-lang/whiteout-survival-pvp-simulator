import { threeQueueCandidateKey, type ThreeQueueCandidateEvaluation, type ThreeQueueOptimizationOptions } from "./threeQueueOptimizer";
import type { generateCriterionQueueSeeds } from "./criterion/queueSearch";
import type { TrajectorySampleAccumulator } from "./trajectorySamples";
import type { summarizeTrajectoryScheduler } from "./trajectorySamples";

export function formalSampleSchedule(options: ThreeQueueOptimizationOptions): number[] {
  return [...new Set([...(options.formalStageTrials ?? [options.coarseSimulationCount,
    Math.min(50, options.refinementSimulationCount), options.refinementSimulationCount,
    Math.min(300, options.finalValidationCount)]).filter((n) => n < options.finalValidationCount),
    options.finalValidationCount])].sort((a,b) => a-b);
}
export interface FormalRacingStage {
  readonly trials: number;
  readonly candidates: number;
  readonly retained: number;
  readonly incrementalRuns: number;
  readonly reusedTrajectoryCount: number;
  readonly baselineReusedRuns: number;
  readonly baselineIncrementalRuns: number;
  readonly sharedSeedSetId: string;
  readonly seedRange: { readonly startIndex: number; readonly endIndex: number; readonly firstSeed: number; readonly lastSeed: number };
  readonly pairedComparisonEnabled: boolean;
  readonly schedulerStatistics?: ReturnType<typeof summarizeTrajectoryScheduler>;
  readonly selection: readonly { readonly candidateKey: string; readonly winRate: number; readonly pairedMean: number;
    readonly uncertainty: number; readonly criterionScore: number; readonly theoryScore: number;
    readonly theoryEngineDisagreement: number; readonly mechanisms: readonly string[]; readonly retained: boolean }[];
}

/** Early racing is approximate: reserve evidence/diversity slots, then blended
 * ranking. Final results are ranked solely on the common formal seed prefix. */
export function retainQueueRacingCandidates(rows: readonly ThreeQueueCandidateEvaluation[], keep: number,
  evidence: ReturnType<typeof generateCriterionQueueSeeds>["evidence"],
  samples: ReadonlyMap<string, TrajectorySampleAccumulator>, baselineKey: string, side: "A" | "B") {
  const byKey = new Map(evidence.map((row) => [threeQueueCandidateKey(row.candidate), row]));
  const rank = (key: string, field: "criterionScore" | "theoryScore") => {
    const value = byKey.get(key)?.[field];
    return value === undefined ? 0 : evidence.filter((row) => row[field] <= value).length / Math.max(1,evidence.length);
  };
  const baseline = samples.get(baselineKey)!;
  const scored = rows.map((row) => {
    const key = threeQueueCandidateKey(row.candidate), ev = byKey.get(key);
    const paired = samples.get(key)!.pairedComparison(baseline, side);
    const uncertainty = Math.max(paired.enabled ? paired.standardError : 1 / Math.sqrt(Math.max(1,row.trials)),
      Math.sqrt((row.wins + 1) * (row.losses + row.failedTrials + 1) / ((row.trials + 2) ** 2 * (row.trials + 3))));
    const disagreement = Math.abs((ev?.theoreticalWinRate ?? row.winRate) - row.winRate);
    return { row, key, paired, uncertainty, disagreement, ev,
      score: .6 * row.winRate + .1 * paired.mean + .1 * rank(key,"criterionScore") +
        .15 * rank(key,"theoryScore") + .05 * uncertainty + .03 * disagreement };
  });
  const selected = new Map<string, ThreeQueueCandidateEvaluation>();
  const add = (row: typeof scored[number] | undefined) => { if (row && selected.size < keep) selected.set(row.key,row.row); };
  add(scored.find((row) => row.key === baselineKey));
  // At most one quarter of the budget is reserved for disagreement/uncertainty,
  // theoretical leaders and special mechanisms; the rest uses formal evidence.
  const reserved = Math.min(keep, Math.max(1,Math.ceil(keep / 4)));
  const reserve = (list: typeof scored) => { if (selected.size < reserved) add(list[0]); };
  reserve([...scored].sort((a,b) => (b.ev?.criterionScore ?? 0)-(a.ev?.criterionScore ?? 0)));
  reserve([...scored].sort((a,b) => (b.ev?.theoryScore ?? 0)-(a.ev?.theoryScore ?? 0)));
  reserve([...scored].sort((a,b) => b.disagreement-a.disagreement));
  reserve([...scored].sort((a,b) => b.uncertainty-a.uncertainty));
  const mechanismSeen = new Set<string>();
  for (const row of [...scored].sort((a,b) => b.score-a.score)) {
    if (selected.size >= reserved) break;
    const signature = row.ev?.mechanisms.join("/");
    if (signature && !mechanismSeen.has(signature)) { mechanismSeen.add(signature); add(row); }
  }
  for (const row of [...scored].sort((a,b) => b.score-a.score || a.key.localeCompare(b.key))) add(row);
  return { candidates: [...selected.values()].map((row) => row.candidate),
    pairedComparisonEnabled: scored.every((row) => row.paired.enabled),
    selection: scored.map((row) => ({ candidateKey: row.key, winRate: row.row.winRate, pairedMean: row.paired.mean,
      uncertainty: row.uncertainty, criterionScore: row.ev?.criterionScore ?? 0, theoryScore: row.ev?.theoryScore ?? 0,
      theoryEngineDisagreement: row.disagreement, mechanisms: row.ev?.mechanisms ?? [], retained: selected.has(row.key) })) };
}
