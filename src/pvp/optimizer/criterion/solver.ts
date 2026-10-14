import type { CriterionBattleResult, CriterionTemplate, Triple } from "./types";
import { aliveMask, buildTargetFlow, firstAlive } from "./flow";
import { orderedLifetimePotential, sqrtIntegralAverage } from "./ordered";
const sum = (a: readonly number[]) => a.reduce((n, v) => n + v, 0);
const counts = (a: readonly number[]) => ({ shield: a[0]!, lancer: a[1]!, marksman: a[2]! });
/** Continuous, event-driven proxy. No RNG/rounding/Trace/formal battle engine. */
export function criterionBattle(template: CriterionTemplate, remainingA: Triple = template.a.counts,
  remainingB: Triple = template.b.counts): CriterionBattleResult {
  const sides = [template.a, template.b], n = [[...remainingA], [...remainingB]], initial = n.map((row) => [...row]);
  const h = n.map((row, side) => row.map((v, troop) => v * sides[side]!.hp[troop]!));
  const x: number[][] = n.map((row) => row.map((v) => v > 0 ? 1 : 0));
  const fixed = Math.sqrt(Math.min(sum(n[0]!), sum(n[1]!)));
  const flows = [new Float64Array(9), new Float64Array(9)];
  let time = 0, events = 0, allDamage = 0, rearDamage = 0;
  const exposure = [0, 0];
  for (let s = 0; s < 2; s++) buildTargetFlow(sides[s]!, aliveMask(initial[s]!), aliveMask(initial[1-s]!), flows[s]);
  const initialO = sides.map((_, s) => initial[s]!.map((n, i) => fixed * Math.sqrt(n) *
    (flows[s]![i*3]! + flows[s]![i*3+1]! + flows[s]![i*3+2]!)));
  const potential = sides.map((side, s) => orderedLifetimePotential(initialO[s]!, h[s]!, side.priorities[0]!));
  while (events < 12 && x.every((row) => row.some((v) => v > 1e-8))) {
    const masks = x.map(aliveMask);
    for (let s = 0; s < 2; s++) buildTargetFlow(sides[s]!, masks[s]!, masks[1 - s]!, flows[s]);
    const loss = (average: readonly (readonly number[])[]) => {
      const d = [[0, 0, 0], [0, 0, 0]];
      for (let s = 0; s < 2; s++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
        if (x[1 - s]![j]! > 1e-8) d[1 - s]![j]! += fixed * Math.sqrt(initial[s]![i]!) * average[s]![i]! * flows[s]![i * 3 + j]! / Math.max(1e-12, h[1 - s]![j]!);
      return d;
    };
    let rates = loss(x.map((row) => row.map(Math.sqrt)));
    const nextTime = () => Math.min(...x.flatMap((row, s) => row.flatMap((v, i) => v > 1e-8 && rates[s]![i]! > 0 ? [v / rates[s]![i]!] : [])));
    let dt = nextTime(); if (!Number.isFinite(dt)) break;
    // Predict/correct the integrated sqrt-output rather than averaging endpoints.
    for (let correction = 0; correction < 2; correction++) {
      const predicted = x.map((row, s) => row.map((v, i) => Math.max(0, v - dt * rates[s]![i]!)));
      rates = loss(x.map((row, s) => row.map((v, i) => sqrtIntegralAverage(v, predicted[s]![i]!))));
      dt = nextTime();
    }
    if (!Number.isFinite(dt) || dt <= 0) break;
    for (let s = 0; s < 2; s++) for (let j = 0; j < 3; j++) {
      const delta = Math.min(x[s]![j]!, dt * rates[s]![j]!);
      allDamage += delta * h[s]![j]!;
      if (j !== firstAlive(masks[s]!, sides[1 - s]!.priorities[0]!)) { rearDamage += delta * h[s]![j]!; exposure[s]! += delta * h[s]![j]!; }
      x[s]![j] = Math.max(0, x[s]![j]! - delta);
    }
    time += dt; events++;
  }
  // Exact one-on-one n^(3/2) invariant avoids predictor bias at this regression boundary.
  const one = initial.map((row) => row.flatMap((v, i) => v > 0 ? [i] : []));
  if (one[0]!.length === 1 && one[1]!.length === 1) {
    const a = one[0]![0]!, b = one[1]![0]!;
    buildTargetFlow(sides[0]!, 1 << a, 1 << b, flows[0]); buildTargetFlow(sides[1]!, 1 << b, 1 << a, flows[1]);
    const ka = fixed * Math.sqrt(initial[1]![b]!) * flows[1]![b * 3 + a]! / h[0]![a]!;
    const kb = fixed * Math.sqrt(initial[0]![a]!) * flows[0]![a * 3 + b]! / h[1]![b]!;
    if (ka > 0 && kb > 0) { const delta = 1 / ka - 1 / kb;
      x[0]![a] = delta > 0 ? (delta * ka) ** (2 / 3) : 0;
      x[1]![b] = delta < 0 ? (-delta * kb) ** (2 / 3) : 0; }
  }
  for (let s = 0; s < 2; s++) for (let i = 0; i < 3; i++) n[s]![i] = initial[s]![i]! * x[s]![i]!;
  const live = n.map((row) => sum(row) > 1e-8);
  const fraction = x.map((row, s) => row.reduce((v, f, i) => v + f * h[s]![i]!, 0) / Math.max(1e-12, sum(h[s]!)));
  const flags = { probabilityApproximation: sides.some((s) => s.flags.probabilityApproximation),
    roundSkillApproximation: sides.some((s) => s.flags.roundSkillApproximation), targetRedirect: sides.some((s) => s.flags.targetRedirect),
    hardToStaticize: sides.some((s) => s.flags.hardToStaticize) };
  return { predictedWinner: live[0] && live[1] ? "unresolved" : live[0] ? "A" : live[1] ? "B" : "draw",
    margin: Math.max(-1, Math.min(1, fraction[0]! - fraction[1]!)), estimatedBattleTime: time,
    aRemaining: counts(n[0]!), bRemaining: counts(n[1]!), lifetimeOutputPotentialA: potential[0]!, lifetimeOutputPotentialB: potential[1]!,
    frontlineProtectionValue: [potential[0]! - orderedLifetimePotential(initialO[0]!, h[0]!, [2, 1, 0]), potential[1]! - orderedLifetimePotential(initialO[1]!, h[1]!, [2, 1, 0])],
    rearExposureLoss: [exposure[0]! / Math.max(1, sum(h[0]!)), exposure[1]! / Math.max(1, sum(h[1]!))],
    crossTargetDamageShare: allDamage ? rearDamage / allDamage : 0,
    uncertainty: Math.min(1, Math.max(...sides.map((s) => s.uncertainty)) + (live[0] && live[1] ? .2 : 0)), flags, omittedMechanisms:[...new Set(sides.flatMap((s)=>s.omittedMechanisms))], eventCount: events };
}
export const CriterionBattle = criterionBattle;
