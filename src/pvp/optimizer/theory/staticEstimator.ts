import type { TheoryEstimate, TheoryTemplate } from "./types";
import { initialTheoryCounts, theoryTarget, estimateDeterministicBattle } from "./deterministicBattleEstimator";
import { combineTheoryScore, logAdvantage, normalizedDifference } from "./theoryScore";

export function estimateTheoryCandidate(template: TheoryTemplate, ratios: readonly number[]): TheoryEstimate {
  const counts = initialTheoryCounts(template, ratios);
  const sides = [template.sideA, template.sideB];
  const fixed = Math.sqrt(Math.min(...counts.map((side) => side.reduce((sum, n) => sum + n, 0))));
  const dps = [0, 0];
  const hp = counts.map((side, index) => side.reduce((sum, n, troop) => sum + n * sides[index]!.ehp[troop]!, 0));
  for (let side = 0; side < 2; side += 1) for (let troop = 0; troop < 3; troop += 1) {
    const target = theoryTarget(counts[1 - side]!, sides[side]!.priorities[troop]!);
    if (target >= 0) dps[side]! += fixed * Math.sqrt(counts[side]![troop]!) * sides[side]!.damage[troop * 3 + target]!;
  }
  const firstTtk = sides.map((side, index) => {
    const target = theoryTarget(counts[1 - index]!, side.priorities[0]!);
    return target < 0 ? 0 : counts[1 - index]![target]! * sides[1 - index]!.hp[target]! / Math.max(1e-9, dps[index]!);
  });
  const shieldSurvival = sides.map((side, index) => counts[index]![0]! * side.hp[0]! / Math.max(1e-9, dps[1 - index]!));
  const aScore = .55 * logAdvantage(dps[0]!, dps[1]!) + .30 * logAdvantage(hp[0]!, hp[1]!) +
    .15 * normalizedDifference(firstTtk[1]!, firstTtk[0]!);
  const staticTheoryScore = template.targetSide === "A" ? aScore : -aScore;
  const deterministic = estimateDeterministicBattle(template, ratios);
  return { staticTheoryScore, deterministicScore: deterministic.score,
    theoryScore: combineTheoryScore(staticTheoryScore, deterministic.score),
    uncertainty: Math.min(.95, (template.sideA.uncertainty + template.sideB.uncertainty) / 2 +
      (deterministic.horizonReached ? .08 : 0) + (Math.max(...ratios) >= 90 ? .03 : 0)),
    metrics: { initialDps: dps as [number, number], ehp: hp as [number, number],
      firstTargetTtk: firstTtk as [number, number], shieldSurvivalRounds: shieldSurvival as [number, number],
      initialNextRoundOutput: deterministic.initialOutput, nextRoundOutput: deterministic.output,
      outputRetention: deterministic.outputRetention, nextRoundOutputMatrix: deterministic.outputMatrix,
      marksmanOutputWindow: shieldSurvival.map((n, i) => counts[i]![2]! > 0 ? n : 0) as [number, number] } };
}
