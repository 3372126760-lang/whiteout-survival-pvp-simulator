import type { RallyTroopRatios } from "../../../../src/pvp/validationUi";

export function ratioKey(ratio: RallyTroopRatios): string {
  return `${ratio.shield}/${ratio.lancer}/${ratio.marksman}`;
}
export function ratioNeighbors(ratio: RallyTroopRatios, step: number): RallyTroopRatios[] {
  const values = [ratio.shield, ratio.lancer, ratio.marksman];
  const neighbors: RallyTroopRatios[] = [];
  for (let from = 0; from < 3; from += 1) for (let to = 0; to < 3; to += 1) {
    if (from === to || values[from]! < step) continue;
    const next = [...values]; next[from]! -= step; next[to]! += step;
    neighbors.push({ shield: next[0]!, lancer: next[1]!, marksman: next[2]! });
  }
  return neighbors;
}
export function createRatioAdjacency(ratios: readonly RallyTroopRatios[], step: number): readonly (readonly number[])[] {
  const indices = new Map(ratios.map((ratio, index) => [ratioKey(ratio), index]));
  return ratios.map((ratio) => ratioNeighbors(ratio, step).flatMap((neighbor) => {
    const index = indices.get(ratioKey(neighbor)); return index === undefined ? [] : [index];
  }));
}
export function detectRatioLocalPeaks(scores: readonly number[], adjacency: readonly (readonly number[])[]): number[] {
  if (scores.length !== adjacency.length || scores.some((score) => !Number.isFinite(score)))
    throw new Error("Invalid theory simplex scores.");
  return scores.flatMap((score, index) => adjacency[index]!.every((neighbor) => score >= scores[neighbor]!) ? [index] : []);
}
