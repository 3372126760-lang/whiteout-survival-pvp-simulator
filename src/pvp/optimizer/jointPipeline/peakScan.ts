import { combineJointCoefficients, type JointCoefficientTable } from "./coefficients";
import { solveRatioPeak, ratioObjective } from "./ratioPeak";
import type { RallyTroopRatios } from "../../validationUi";
import { JOINT_TOP_K, type JointPeakRow, type JointRankCheckpoint } from "./types";
export interface JointPeakJob { table: JointCoefficientTable; headStart: number; headEnd: number; shard: number; perHeadProtectedK?: number; }
export interface JointPeakChunk { rows: readonly JointPeakRow[]; perHeadRows: readonly JointPeakRow[]; evaluatedHeadBodyCount: number; objectiveEvaluationCount: number; kktEvaluationCount: number; elapsedMs: number; }
/** The peak solver and final-ratio inspection both evaluate ratioObjective over
 * the same compiled S/O coefficients. No alternate display formula. */
export function evaluateJointJ(table: JointCoefficientTable, head: number, body: number, ratio: RallyTroopRatios): number {
  const s = new Float64Array(3), o = new Float64Array(3);
  combineJointCoefficients(table, head, body, s, o, new Float64Array(12));
  return ratioObjective(s, o, [ratio.shield / 100, ratio.lancer / 100, ratio.marksman / 100]);
}
export function jointRankCheckpoints(peaks: readonly JointPeakRow[], headKeys: readonly string[], bodyKeys: readonly string[]): JointRankCheckpoint[] {
  return [1, 10, 100, 1000, 2000, 5000, 10000].flatMap((rank) => {
    const p = peaks[rank - 1]; if (!p) return [];
    const relativeToBest = peaks[0]!.score ? p.score / peaks[0]!.score : 1;
    return [{ rank, j: p.score, relativeToBest, lossFromBest: 1 - relativeToBest,
      headKey: headKeys[p.head]!, bodyKey: bodyKeys[p.body]!, peakRatio: p.ratio }];
  });
}
/** Pools must be sorted by HeadKey and BodyKey before scanning, so integer IDs
 * implement the exact lexical tie-break consistently on every worker. */
export function compareJointPeaks(a: JointPeakRow, b: JointPeakRow): number {
  return b.score - a.score || a.head - b.head || a.body - b.body;
}
export class JointPeakHeap {
  readonly rows: JointPeakRow[] = [];
  constructor(readonly capacity = JOINT_TOP_K) {}
  accepts(score: number, head: number, body: number): boolean {
    if (this.rows.length < this.capacity) return true;
    const worst = this.rows[0]!;
    return score > worst.score || score === worst.score && (head < worst.head || head === worst.head && body < worst.body);
  }
  push(row: JointPeakRow): void {
    if (!this.accepts(row.score, row.head, row.body)) return;
    if (this.rows.length < this.capacity) {
      this.rows.push(row); let i = this.rows.length - 1;
      while (i) { const p = (i - 1) >>> 1; if (compareJointPeaks(this.rows[p]!, row) <= 0) {
        this.rows[i] = this.rows[p]!; i = p;
      } else break; } this.rows[i] = row;
    } else {
      let i = 0;
      while (i * 2 + 1 < this.rows.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.rows.length && compareJointPeaks(this.rows[child]!, this.rows[child + 1]!) < 0) child++;
        if (compareJointPeaks(row, this.rows[child]!) >= 0) break;
        this.rows[i] = this.rows[child]!; i = child;
      }
      this.rows[i] = row;
    }
  }
  sorted(): JointPeakRow[] { return [...this.rows].sort(compareJointPeaks); }
}
export function scanJointPeaks(job: JointPeakJob): JointPeakChunk {
  const start = performance.now(), heap = new JointPeakHeap(), s = new Float64Array(3), o = new Float64Array(3),
    scratch = new Float64Array(12), peak = new Float64Array(5);
  let objectiveEvaluationCount = 0, evaluatedHeadBodyCount = 0, kktEvaluationCount = 0;
  const perHeadRows: JointPeakRow[] = [], k = job.perHeadProtectedK ?? 1;
  if (!Number.isSafeInteger(k) || k < 1) throw new RangeError("Per-head protection must retain at least one Body.");
  for (let head = job.headStart; head < job.headEnd; head++) {
    const headHeap = new JointPeakHeap(k);
    for (let body = 0; body < job.table.bodyCount; body++) {
    combineJointCoefficients(job.table, head, body, s, o, scratch);
    solveRatioPeak(s, o, peak); evaluatedHeadBodyCount++; kktEvaluationCount += peak[4]!;
    // KKT residual/derivative work is not a J evaluation. solveRatioPeak only
    // evaluates J once at the solution (zero coefficients have a known zero J).
    if (Math.max(s[0]!, s[1]!, s[2]!) > 0 && Math.max(o[0]!, o[1]!, o[2]!) > 0) objectiveEvaluationCount++;
    if (heap.accepts(peak[3]!, head, body) || headHeap.accepts(peak[3]!, head, body)) {
      const row = { head, body, score: peak[3]!, ratio: { shield: peak[0]! * 100, lancer: peak[1]! * 100, marksman: peak[2]! * 100 } };
      heap.push(row); headHeap.push(row);
    }
    }
    perHeadRows.push(...headHeap.sorted());
  }
  return { rows: heap.sorted(), perHeadRows, objectiveEvaluationCount, kktEvaluationCount, evaluatedHeadBodyCount, elapsedMs: performance.now() - start };
}
