import type { Triple } from "../criterion/types";
import type { RallyTroopRatios } from "../../validationUi";

export interface RatioPeak { bestRatio: RallyTroopRatios; bestScore: number; localPeaks: readonly RallyTroopRatios[]; objectiveEvaluationCount: number; }
export function ratioObjective(s: ArrayLike<number>, o: ArrayLike<number>, x: ArrayLike<number>): number {
  return (s[0]! * x[0]! + s[1]! * x[1]! + s[2]! * x[2]!) *
    (o[0]! * Math.sqrt(Math.max(0, x[0]!)) + o[1]! * Math.sqrt(Math.max(0, x[1]!)) + o[2]! * Math.sqrt(Math.max(0, x[2]!)));
}

/** Allocation-free hot path. out = [x0,x1,x2,J,equivalent evaluations].
 * log J is concave. KKT gives x_i ∝ (O_i/(z-S_i))² and
 * 3 Σ S_i x_i = 2z. The weighted mean decreases with z, so its scalar
 * root is unique. Safeguarded Newton covers the full bracket, independent
 * of the start. Zero-output survival-only vertices use the boundary KKT case.
 */
export function solveRatioPeak(s: ArrayLike<number>, o: ArrayLike<number>, out: Float64Array, start = .5): void {
  const scale = Math.max(s[0]!, s[1]!, s[2]!), os = Math.max(o[0]!, o[1]!, o[2]!);
  if (!(scale > 0) || !(os > 0)) {
    out[0] = 1; out[1] = out[2] = out[3] = 0; out[4] = 1; return;
  }
  const a = s[0]! / scale, b = s[1]! / scale, c = s[2]! / scale;
  const p = (o[0]! / os) ** 2, q = (o[1]! / os) ** 2, r = (o[2]! / os) ** 2;
  if(a===b&&b===c){
    const sum=p+q+r;out[0]=p/sum;out[1]=q/sum;out[2]=r/sum;out[3]=ratioObjective(s,o,out);out[4]=2;return;
  }
  let lo = 1, hi = 1.5, z = 1 + .5 * Math.min(.99, Math.max(.01, start));
  let w0 = 0, w1 = 0, w2 = 0, count = 0;
  const inactiveMaximum = (a === 1 && p === 0) || (b === 1 && q === 0) || (c === 1 && r === 0);
  if (inactiveMaximum && !(a === 1 && p > 0 || b === 1 && q > 0 || c === 1 && r > 0)) {
    w0 = p ? p / (1 - a) ** 2 : 0; w1 = q ? q / (1 - b) ** 2 : 0; w2 = r ? r / (1 - c) ** 2 : 0;
    const sum = w0 + w1 + w2, mean = (a * w0 + b * w1 + c * w2) / sum;
    if (mean <= 2 / 3) {
      const activeShare = 1 / (3 * (1 - mean));
      out[0] = activeShare * w0 / sum; out[1] = activeShare * w1 / sum; out[2] = activeShare * w2 / sum;
      const i = a === 1 ? 0 : b === 1 ? 1 : 2; out[i]! += 1 - activeShare;
      out[3] = ratioObjective(s, o, out); out[4] = 2; return;
    }
  }
  for (; count < 28; count++) {
    const d0 = z - a, d1 = z - b, d2 = z - c;
    w0 = p / (d0 * d0); w1 = q / (d1 * d1); w2 = r / (d2 * d2);
    const sum = w0 + w1 + w2, mean = (a * w0 + b * w1 + c * w2) / sum, f = 3 * mean - 2 * z;
    if (Math.abs(f) < 1e-10) break;
    if (f > 0) lo = z; else hi = z;
    const derivative = -6 * ((a - mean) * w0 / d0 + (b - mean) * w1 / d1 + (c - mean) * w2 / d2) / sum - 2;
    const next = z - f / derivative;
    z = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  // Recompute after a final bracket step, including a capped Newton run.
  w0 = p / (z - a) ** 2; w1 = q / (z - b) ** 2; w2 = r / (z - c) ** 2;
  const sum = w0 + w1 + w2;
  out[0] = w0 / sum; out[1] = w1 / sum; out[2] = w2 / sum;
  out[3] = ratioObjective(s, o, out); out[4] = count + 2;
}
export function findRatioPeak(s: Triple, o: Triple, start = .5): RatioPeak {
  if ([...s, ...o].some((v) => !Number.isFinite(v) || v < 0)) throw new RangeError("Ratio coefficients must be finite and non-negative.");
  const out = new Float64Array(5); solveRatioPeak(s, o, out, start);
  const bestRatio = { shield: out[0]! * 100, lancer: out[1]! * 100, marksman: out[2]! * 100 };
  return { bestRatio, bestScore: out[3]!, localPeaks: [bestRatio], objectiveEvaluationCount: out[4]! };
}

export interface RatioRegion {
  threshold: number; padding: number; bestRatio: RallyTroopRatios; bestScore: number;
  s: Triple; o: Triple;
  shieldMin: number; shieldMax: number; lancerMin: number; lancerMax: number; marksmanMin: number; marksmanMax: number;
  /** The superlevel set is one connected convex basin; bounds are an envelope only. */
  connectedBasins: 1;
  objectiveEvaluationCount: number;
}
/** Optimize the two remaining coordinates, then bisect each coordinate's
 * superlevel intersection. No grid resolution can lose a narrow peak. */
export function createRatioRegion(s: Triple, o: Triple, peak: RatioPeak, threshold: number, padding = 0): RatioRegion {
  const center = [peak.bestRatio.shield / 100, peak.bestRatio.lancer / 100, peak.bestRatio.marksman / 100];
  const point = [0, 0, 0], bounds: number[] = [], cutoff = peak.bestScore * threshold;
  let objectiveEvaluationCount=0;
  const at = (axis: number, value: number) => {
    objectiveEvaluationCount+=73;
    point[axis] = value; const j = (axis + 1) % 3, k = (axis + 2) % 3;
    let low = 0, high = 1 - value;
    for (let n = 0; n < 36; n++) {
      const u = low + (high - low) * .3819660112501051, v = high - (high - low) * .3819660112501051;
      point[j] = u; point[k] = 1 - value - u; const ju = ratioObjective(s, o, point);
      point[j] = v; point[k] = 1 - value - v; const jv = ratioObjective(s, o, point);
      if (ju < jv) low = u; else high = v;
    }
    point[j] = (low + high) / 2; point[k] = 1 - value - point[j]!;
    return ratioObjective(s, o, point);
  };
  for (let axis = 0; axis < 3; axis++) for (const edge of [0, 1]) {
    let outside = edge, inside = center[axis]!;
    if (at(axis, edge) < cutoff) for (let n = 0; n < 28; n++) {
      const mid = (outside + inside) / 2;
      if (at(axis, mid) >= cutoff) inside = mid; else outside = mid;
    }
    else inside = edge;
    // Outward rounding keeps the envelope conservative.
    bounds.push(Math.min(100, Math.max(0, inside * 100 + (edge === 0 ? -1e-5 - padding : 1e-5 + padding))));
  }
  return { s, o, threshold, padding, bestRatio: peak.bestRatio, bestScore: peak.bestScore, connectedBasins: 1, objectiveEvaluationCount,
    shieldMin: bounds[0]!, shieldMax: bounds[1]!, lancerMin: bounds[2]!, lancerMax: bounds[3]!, marksmanMin: bounds[4]!, marksmanMax: bounds[5]! };
}
/** Actual J membership, with an explicit L∞ movement towards the peak for
 * padding. Never substitute the rectangular display envelope for the basin. */
export function ratioInRegion(region: RatioRegion, ratio: RallyTroopRatios): boolean {
  const x = [ratio.shield / 100, ratio.lancer / 100, ratio.marksman / 100];
  if (x.some((v) => v < 0) || Math.abs(x[0]! + x[1]! + x[2]! - 1) > 1e-7) return false;
  if (ratioObjective(region.s, region.o, x) >= region.bestScore * region.threshold * (1 - 1e-10)) return true;
  const p = [region.bestRatio.shield / 100, region.bestRatio.lancer / 100, region.bestRatio.marksman / 100];
  const distance = Math.max(...x.map((v, i) => Math.abs(v - p[i]!)));
  const fraction = distance ? Math.min(1, region.padding / 100 / distance) : 1;
  return ratioObjective(region.s, region.o, x.map((v, i) => v + fraction * (p[i]! - v))) >= region.bestScore * region.threshold;
}
