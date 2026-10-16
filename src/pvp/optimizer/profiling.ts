import type { EvaluationJobResult, OptimizationWorkflow } from "./execution";
import type { OptimizationProgress } from "./types";
import type { JointPeakProfile, FormalRatioProfile, FinalCorrelationProfile, RecallAudit } from "./jointPipeline/types";
import type { BodyEnumerationAudit } from "./criterion/bodyEnumeration";

export type SearchTimingStatus = "running" | "completed" | "cancelled" | "error";
export interface SearchStageTiming {
  readonly stage: string;
  readonly visibleStageId: string;
  /** Inclusive wall time for the same lifecycle as completed/total. */
  readonly wallElapsedMs: number;
  readonly exclusiveElapsedMs: number;
  readonly executedCount: number;
  readonly reusedCount: number;
  readonly reusedTrajectoryCount?: number;
  readonly throughput: number | null;
  readonly peakCandidateCount: number;
  readonly totalStable: boolean;
  readonly executionWorkload: boolean;
  /** A trajectory may contain several formal three-queue duels. */
  readonly executionUnit: "battle" | "trajectory";
  /** Monotonic offsets from the session start, in milliseconds. */
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly elapsedMs: number;
  readonly completed: number;
  readonly total: number;
  readonly candidateCount: number;
  readonly battleCount: number;
  readonly battleElapsedMs: number;
  readonly avgBattleMs: number | null;
  readonly cacheHitCount: number;
  readonly templateCacheHitCount: number;
  readonly requestedBattles: number;
  readonly executedBattles: number;
  readonly reusedBattles: number;
  readonly cacheHitRate: number;
  readonly estimatedRemainingMs: number | null;
  readonly percentOfTotal: number;
  readonly status: SearchTimingStatus;
}
export interface SearchPerformanceReport {
  readonly recallAudit?: RecallAudit;
  readonly bodyEnumerationAudit?: BodyEnumerationAudit;
  readonly formalRatio?: FormalRatioProfile;
  readonly finalCorrelation?: FinalCorrelationProfile;
  readonly jointPeak?: JointPeakProfile;
  readonly status: SearchTimingStatus;
  readonly totalElapsedMs: number;
  readonly stages: readonly SearchStageTiming[];
  readonly totalBattleEngineCalls: number;
  readonly requestedBattles: number;
  readonly executedBattles: number;
  readonly reusedBattles: number;
  readonly cacheHitCount: number;
  readonly cacheHitRate: number;
  /** Sum of measured trial execution durations, including parallel workers.
   * This is worker work time, not wall-clock search time divided by calls. */
  readonly totalBattleElapsedMs: number;
  readonly overallAvgBattleMs: number | null;
  readonly unaccountedElapsedMs: number;
}
type MutableStage = { -readonly [K in keyof SearchStageTiming]: SearchStageTiming[K] };
interface Frame { row: MutableStage; resumedAt: number | null; wallStartedAt: number; completedBefore: number; }

export function stageEta(elapsedMs: number, completed: number, total: number): number | null {
  return completed < 2 ? null : Math.max(0, elapsedMs / completed * (total - completed));
}

/** Observational only. No seeds, random calls, budgets or ranking inputs. Nested
 * synchronous phases pause the parent so percentages never double-count work. */
export class OptimizerProfiler {
  recallAudit?: RecallAudit;
  bodyEnumerationAudit?: BodyEnumerationAudit;
  formalRatio?: FormalRatioProfile;
  finalCorrelation?: FinalCorrelationProfile;
  jointPeak?: JointPeakProfile;
  private readonly origin: number;
  private readonly rows = new Map<string, MutableStage>();
  private readonly stack: Frame[] = [];
  private lastEmission = -Infinity;
  private endedAt: number | undefined;
  private status: SearchTimingStatus = "running";
  constructor(private readonly onProgress?: (progress: OptimizationProgress) => void,
    private readonly now: () => number = () => performance.now()) { this.origin = now(); }
  private time() { return Math.max(0, this.now() - this.origin); }
  private pause(time: number) {
    const current = this.stack.at(-1);
    if (current?.resumedAt !== null && current?.resumedAt !== undefined) {
      current.row.elapsedMs += Math.max(0, time - current.resumedAt); current.resumedAt = null;
    }
  }
  begin(stage: string, total: number, candidateCount = total, notify = true): void {
    const time = this.time(); this.pause(time);
    const row = this.rows.get(stage) ?? { stage, visibleStageId: stage, wallElapsedMs: 0, exclusiveElapsedMs: 0,
      executedCount: 0, reusedCount: 0, throughput: null, peakCandidateCount: 0, totalStable: true, executionWorkload: false, executionUnit: "battle",
      startedAt: time, finishedAt: null,
      elapsedMs: 0, completed: 0, total: 0, candidateCount: 0, battleCount: 0,
      battleElapsedMs: 0, avgBattleMs: null, cacheHitCount: 0, templateCacheHitCount: 0,
      requestedBattles: 0, executedBattles: 0, reusedBattles: 0, cacheHitRate: 0,
      estimatedRemainingMs: null, percentOfTotal: 0, status: "running" as const };
    row.total += total; row.candidateCount += candidateCount; row.peakCandidateCount = Math.max(row.peakCandidateCount, candidateCount);
    row.finishedAt = null; row.status = "running"; this.rows.set(stage, row);
    this.stack.push({ row, resumedAt: time, wallStartedAt: time, completedBefore: row.completed });
    if (notify) this.emit(true);
  }
  end(notify = true): void {
    const time = this.time(); this.pause(time);
    const frame = this.stack.pop(); if (!frame) return;
    frame.row.wallElapsedMs += Math.max(0, time - frame.wallStartedAt);
    // A dynamically pruned trajectory has no remaining execution workload.
    // Close its denominator at actual execution, rather than invent skipped runs.
    if (frame.row.executionWorkload && !frame.row.totalStable) {
      frame.row.total = frame.row.completed; frame.row.totalStable = true;
    }
    frame.row.completed = frame.row.total; frame.row.finishedAt = time; frame.row.status = "completed";
    if (notify) this.emit(true, frame.row);
    const parent = this.stack.at(-1); if (parent) parent.resumedAt = this.time();
  }
  measure<T>(stage: string, units: number, work: () => T): T {
    this.begin(stage, units, units, false);
    try { const value = work(); this.end(false); return value; }
    catch (error) { this.abort("error"); throw error; }
  }
  setExecutionWorkload(totalMissing: number, totalStable = true, unit: "battle" | "trajectory" = "battle"): void {
    const frame = this.stack.at(-1); if (!frame) return;
    frame.row.total = frame.completedBefore + totalMissing;
    frame.row.executionWorkload = true; frame.row.totalStable = totalStable; frame.row.executionUnit = unit;
  }
  observeCandidateCount(count: number): void {
    const row = this.stack.at(-1)?.row;
    if (row) row.peakCandidateCount = Math.max(row.peakCandidateCount, count);
  }
  cacheHits(count: number): void { const row = this.stack.at(-1)?.row; if (row) row.templateCacheHitCount += count; }
  reuseBattles(count: number): void {
    const row = this.stack.at(-1)?.row;
    if (row) { row.requestedBattles += count; row.reusedBattles += count; row.cacheHitCount += count; }
  }
  reuseTrajectorySamples(count: number, duelCount: number): void {
    const row = this.stack.at(-1)?.row;
    if (row) row.reusedTrajectoryCount = (row.reusedTrajectoryCount ?? 0) + count;
    this.reuseBattles(duelCount);
  }
  recordRows(rows: readonly EvaluationJobResult[]): void {
    const stage = this.stack.at(-1)?.row; if (!stage) return;
    for (const row of rows) {
      stage.battleCount += row.timing?.battleCount ?? 0;
      stage.battleElapsedMs += row.timing?.battleElapsedMs ?? 0;
      const executed = row.timing?.battleCount ?? row.performance.simulatedTrials;
      stage.executedBattles += executed; stage.requestedBattles += executed;
      if (stage.executionWorkload) stage.completed = Math.min(stage.total, stage.completed +
        (stage.executionUnit === "trajectory" ? row.samples.trials : executed));
      stage.templateCacheHitCount += row.performance.templateHits;
    }
  }
  readonly progress = (progress: OptimizationProgress): void => {
    const row = this.stack.at(-1)?.row;
    if (row && !row.executionWorkload) {
      const frame = this.stack.at(-1)!;
      row.completed = Math.min(row.total, Math.max(row.completed, frame.completedBefore + progress.completed));
    }
    this.emit(false);
  };
  snapshot(): SearchPerformanceReport {
    const time = this.endedAt ?? this.time();
    const stages = [...this.rows.values()].map((row): SearchStageTiming => {
      const frame = this.stack.find((entry) => entry.row === row);
      const elapsedMs = row.elapsedMs + (frame?.resumedAt === null || frame?.resumedAt === undefined
        ? 0 : Math.max(0, time - frame.resumedAt));
      const wallElapsedMs = row.wallElapsedMs + (frame ? Math.max(0, time - frame.wallStartedAt) : 0);
      return { ...row, elapsedMs, exclusiveElapsedMs: elapsedMs, wallElapsedMs,
        executedCount: row.executionWorkload && row.executionUnit === "battle" ? row.executedBattles : row.completed,
        reusedCount: row.executionUnit === "trajectory" ? row.reusedTrajectoryCount ?? 0 : row.reusedBattles,
        throughput: wallElapsedMs > 0 ? row.completed * 1000 / wallElapsedMs : null,
        cacheHitRate: row.requestedBattles ? row.reusedBattles / row.requestedBattles : 0,
        avgBattleMs: row.battleCount ? row.battleElapsedMs / row.battleCount : null,
        estimatedRemainingMs: row.status === "running" ? row.totalStable ? stageEta(wallElapsedMs, row.completed, row.total) : null : 0,
        percentOfTotal: time ? 100 * elapsedMs / time : 0 };
    });
    const totalBattleEngineCalls = stages.reduce((sum, row) => sum + row.battleCount, 0);
    const totalBattleElapsedMs = stages.reduce((sum, row) => sum + row.battleElapsedMs, 0);
    const requestedBattles = stages.reduce((sum, row) => sum + row.requestedBattles, 0);
    const reusedBattles = stages.reduce((sum, row) => sum + row.reusedBattles, 0);
    const executedBattles = stages.reduce((sum, row) => sum + row.executedBattles, 0);
    return { ...(this.recallAudit ? { recallAudit: this.recallAudit } : {}), ...(this.bodyEnumerationAudit ? { bodyEnumerationAudit: this.bodyEnumerationAudit } : {}), ...(this.formalRatio ? { formalRatio: this.formalRatio } : {}), ...(this.finalCorrelation ? { finalCorrelation: this.finalCorrelation } : {}), ...(this.jointPeak ? { jointPeak: this.jointPeak } : {}), status: this.status, totalElapsedMs: time, stages, totalBattleEngineCalls,
      requestedBattles, executedBattles, reusedBattles, cacheHitCount: reusedBattles,
      cacheHitRate: requestedBattles ? reusedBattles / requestedBattles : 0,
      totalBattleElapsedMs, overallAvgBattleMs: totalBattleEngineCalls ? totalBattleElapsedMs / totalBattleEngineCalls : null,
      unaccountedElapsedMs: Math.max(0, time - stages.reduce((sum, row) => sum + row.elapsedMs, 0)) };
  }
  private emit(force: boolean, completed?: MutableStage): void {
    const time = this.time(); if (!force && time - this.lastEmission < 250) return;
    this.lastEmission = time;
    const report = this.snapshot(), active = this.stack.at(-1)?.row ?? completed;
    const row = active ? report.stages.find((entry) => entry.stage === active.stage) : undefined;
    this.onProgress?.({ stage: row?.stage ?? "搜索完成", completed: row?.completed ?? 0,
      total: row?.total ?? 0, performanceReport: report });
  }
  finish(): SearchPerformanceReport {
    while (this.stack.length) this.end(false);
    this.endedAt = this.time(); this.status = "completed"; this.emit(true);
    return this.snapshot();
  }
  abort(status: "cancelled" | "error"): SearchPerformanceReport {
    const time = this.time(); this.pause(time);
    for (const frame of this.stack) { frame.row.wallElapsedMs += Math.max(0, time - frame.wallStartedAt); frame.row.status = status; frame.row.finishedAt = time; }
    this.stack.length = 0; this.status = status; this.endedAt = time; this.emit(true);
    return this.snapshot();
  }
}

/** Supplies observation flags to executor jobs and collects actual worker trial
 * counts before resuming the generator. Search inputs and resume order stay intact. */
export function* profileOptimizationWorkflow<T extends object>(workflow: OptimizationWorkflow<T>,
  profiler?: OptimizerProfiler): OptimizationWorkflow<T & { readonly searchPerformanceReport?: SearchPerformanceReport }> {
  if (!profiler) return yield* workflow;
  try {
    let step = workflow.next();
    while (!step.done) {
      const rows = yield step.value.map((job) => ({ ...job, profiling: true }));
      profiler.recordRows(rows); step = workflow.next(rows);
    }
    return { ...step.value, searchPerformanceReport: profiler.finish() };
  } catch (error) { profiler.abort("error"); throw error; }
  finally { if (profiler.snapshot().status === "running") profiler.abort("cancelled"); }
}

/** A coordinator may be terminated between updates. Preserve completed rows and
 * mark only unfinished rows; never fabricate unsampled battle calls. */
export function stopPerformanceReport(report: SearchPerformanceReport,
  status: "cancelled" | "error", elapsedMs = report.totalElapsedMs): SearchPerformanceReport {
  const totalElapsedMs = Math.max(report.totalElapsedMs, elapsedMs);
  const active = [...report.stages].reverse().find((row) => row.status === "running");
  const stages = report.stages.map((row) => {
    const duration = row.elapsedMs + (row === active ? totalElapsedMs - report.totalElapsedMs : 0);
    return { ...row, elapsedMs: duration, exclusiveElapsedMs: duration, wallElapsedMs: row.wallElapsedMs + (row === active ? totalElapsedMs - report.totalElapsedMs : 0), percentOfTotal: totalElapsedMs ? 100 * duration / totalElapsedMs : 0,
      ...(row.status === "running" ? { status, finishedAt: totalElapsedMs, estimatedRemainingMs: null } : {}) };
  });
  return { ...report, status, totalElapsedMs, stages,
    unaccountedElapsedMs: Math.max(0, totalElapsedMs - stages.reduce((sum, row) => sum + row.elapsedMs, 0)) };
}
