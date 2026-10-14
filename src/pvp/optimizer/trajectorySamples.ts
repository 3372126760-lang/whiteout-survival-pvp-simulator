import type { EvaluationSamples, TrajectoryObservation } from "./execution";

/** One candidate, one immutable shared seed prefix, cumulative whole matches. */
export class TrajectorySampleAccumulator {
  constructor(private readonly side: "A" | "B" = "A") {}
  trials = 0;
  wins = 0;
  losses = 0;
  failedTrials = 0;
  readonly observations: TrajectoryObservation[] = [];
  private pairedAvailable = true;
  append(seeds: readonly number[], samples: EvaluationSamples): void {
    if (samples.pruned || samples.trials !== seeds.length) throw new Error("Cumulative trajectory samples must be a complete contiguous prefix.");
    if (samples.trajectories) {
      if (samples.trajectories.length !== seeds.length || samples.trajectories.some((row, i) => row.seed !== seeds[i]))
        throw new Error("Trajectory observation/seed mismatch.");
      this.observations.push(...samples.trajectories);
    } else this.pairedAvailable = false;
    this.trials += samples.trials; this.wins += samples.wins;
    this.losses += samples.losses; this.failedTrials += samples.failedTrials;
  }
  pairedComparison(other: TrajectorySampleAccumulator, side: "A" | "B" = "A") {
    const n = Math.min(this.trials, other.trials);
    if (!n || !this.pairedAvailable || !other.pairedAvailable) return { enabled: false, mean: 0, standardError: 1 };
    const deltas = this.observations.slice(0, n).map((row, i) => {
      const baseline = other.observations[i]!;
      if (row.seed !== baseline.seed) throw new Error("Paired candidates must use identical trajectory seeds.");
      return Number(row.outcome === side) - Number(baseline.outcome === side);
    });
    const mean = deltas.reduce((sum, x) => sum + x, 0) / n;
    const variance = deltas.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, n - 1);
    return { enabled: true, mean, standardError: Math.sqrt(variance / n) };
  }
  schedulerAudit() { return summarizeTrajectoryScheduler(this.observations); }
  snapshot(trials = this.trials) {
    if (trials === this.trials) return { trials,wins:this.wins,losses:this.losses,failedTrials:this.failedTrials };
    if (trials < 0 || trials > this.trials || this.observations.length !== this.trials)
      throw new Error("A shorter cumulative prefix requires its original per-trajectory observations.");
    const rows = this.observations.slice(0,trials);
    return { trials,wins:rows.filter((row)=>row.outcome===this.side).length,
      losses:rows.filter((row)=>row.outcome!="failed"&&row.outcome!==this.side).length,
      failedTrials:rows.filter((row)=>row.outcome==="failed").length };
  }
}

export function summarizeTrajectoryScheduler(rows: readonly TrajectoryObservation[]) {
  const completed = rows.filter((row) => row.outcome !== "failed");
  const rate = (predicate: (row: TrajectoryObservation) => boolean) => completed.length
    ? completed.filter(predicate).length / completed.length : 0;
  return { observedTrajectories: rows.length, completedTrajectories: completed.length,
    failedTrajectories: rows.length - completed.length,
    simultaneousEliminationCount: rows.filter((row)=>row.failureReason==="simultaneousElimination").length,
    unknownFailureCount: rows.filter((row)=>row.outcome==="failed"&&(row.failureReason===undefined||row.failureReason==="unknown")).length,
    finishIn3Rate: rate((row) => row.battleCount === 3), finishIn4Rate: rate((row) => row.battleCount === 4),
    finishIn5Rate: rate((row) => row.battleCount === 5),
    A3to0SweepRate: rate((row) => row.outcome === "A" && row.remainingQueuesA === 3),
    B3to0SweepRate: rate((row) => row.outcome === "B" && row.remainingQueuesB === 3),
    maxRoundHitCount: rows.reduce((sum, row) => sum + row.maxRoundHitCount, 0),
    failedTrials: rows.filter((row) => row.outcome === "failed"),
    rateDenominator: "completedTrajectories" as const };
}
