import { createSeededRandomSource } from "../../../../src/pvp/troopSkills";
import type { RallyTroopRatios } from "../../../../src/pvp/validationUi";
import type { TheoryEstimate, TheoryOptions, TheorySelection, SelectionReason } from "./types";
import { createRatioAdjacency, detectRatioLocalPeaks, ratioKey } from "./ratioPeakDetector";

export function ratioRegion(ratio: RallyTroopRatios): string {
  const values = [ratio.shield, ratio.lancer, ratio.marksman];
  if (Math.max(...values) >= 90) return "extreme";
  if (Math.max(...values) <= 45) return "balanced";
  return ["shieldHeavy", "lancerHeavy", "marksmanHeavy"][values.indexOf(Math.max(...values))]!;
}
function distance(a: RallyTroopRatios, b: RallyTroopRatios): number {
  return Math.abs(a.shield - b.shield) + Math.abs(a.lancer - b.lancer) + Math.abs(a.marksman - b.marksman);
}
/** Per-lineup selection only. No global theory cutoff can delete a lineup. */
export function scanLineupRatios(ratios: readonly RallyTroopRatios[], adjacency: readonly (readonly number[])[],
  evaluate: (ratio: RallyTroopRatios) => TheoryEstimate, options: TheoryOptions, seed: number): {
    scanned: number; localPeaksDetected: number; selections: readonly TheorySelection[];
  } {
  const estimates = ratios.map(evaluate);
  const peaks = detectRatioLocalPeaks(estimates.map((row) => row.theoryScore), adjacency);
  const selected = new Map<number, SelectionReason[]>();
  const add = (index: number, reason: SelectionReason) => {
    const reasons = selected.get(index) ?? []; if (!reasons.includes(reason)) reasons.push(reason);
    selected.set(index, reasons);
  };
  const ranked = ratios.map((_, i) => i).sort((a, b) => estimates[b]!.theoryScore - estimates[a]!.theoryScore || a - b);
  const minimumDistance = (index: number) => selected.size === 0 ? 200 : Math.min(...[...selected.keys()].map((other) => distance(ratios[index]!, ratios[other]!)));
  const bestUnselected = (pool: readonly number[], score: (index: number) => number): number | undefined => {
    let best: number | undefined, bestScore = -Infinity, bestDistance = -Infinity;
    for (const index of pool) {
      if (selected.has(index)) continue;
      const value = score(index);
      if (value < bestScore) continue;
      const separation = minimumDistance(index);
      if (value > bestScore || separation > bestDistance || (separation === bestDistance && (best === undefined || index < best))) {
        best = index; bestScore = value; bestDistance = separation;
      }
    }
    return best;
  };
  for (let n = 0; n < options.localPeaksPerLineup; n += 1) {
    const peak = bestUnselected(peaks, (index) => estimates[index]!.theoryScore);
    const index = peak ?? bestUnselected(ranked, (index) => estimates[index]!.theoryScore);
    if (index !== undefined) add(index, peak === undefined ? "theoryTop" : "theoryLocalPeak");
  }
  for (let n = 0; n < options.uncertaintyExploration; n += 1) {
    const index = bestUnselected(ranked, (i) => estimates[i]!.theoryScore + options.uncertaintyWeight * estimates[i]!.uncertainty);
    if (index !== undefined) add(index, "uncertaintyExploration");
  }
  const random = createSeededRandomSource(seed);
  for (let n = 0; n < options.diversityExploration; n += 1) {
    const regions = new Set([...selected.keys()].map((i) => ratioRegion(ratios[i]!)));
    const remaining = ranked.filter((i) => !selected.has(i));
    const diverse = remaining.filter((i) => !regions.has(ratioRegion(ratios[i]!)));
    const index = bestUnselected(diverse.length ? diverse : remaining, minimumDistance);
    if (index !== undefined) add(index, "ratioDiversity");
  }
  for (let n = 0; n < options.randomExploration; n += 1) {
    const covered = new Set([...selected.keys()].map((i) => ratioRegion(ratios[i]!)));
    const remaining = ranked.filter((i) => !selected.has(i));
    const diverse = remaining.filter((i) => !covered.has(ratioRegion(ratios[i]!)));
    const pool = diverse.length ? diverse : remaining;
    if (pool.length) add(pool[Math.floor(random.next() * pool.length)]!, "randomExploration");
  }
  while (selected.size < Math.min(options.minSurvivorsPerLineup, ratios.length)) {
    const index = ranked.find((i) => !selected.has(i)); if (index === undefined) break; add(index, "theoryTop");
  }
  return { scanned: ratios.length, localPeaksDetected: peaks.length,
    selections: [...selected].map(([i, selectionReasons]) => ({ ratios: ratios[i]!, estimate: estimates[i]!, selectionReasons })) };
}
export { createRatioAdjacency, ratioKey };
