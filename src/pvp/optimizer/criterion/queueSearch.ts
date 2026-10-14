import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../../heroSkills";
import { TROOP_TYPES, type TroopType } from "../../types";
import { generateRatioGrid } from "../candidateGenerator";
import { optimizerHeadWeaponLevels } from "../heroPools";
import { optimizerRecentHeadEligible } from "../heroSearchPolicy";
import type { ThreeQueueOptimizationOptions, ThreeQueueOptimizationState, ThreeQueueCandidateQueue } from "../threeQueueOptimizer";
import type { OptimizationInput, OptimizationProgress } from "../types";
import type { OptimizerProfiler } from "../profiling";
import { currentCriterionQueueState } from "./threeQueue";
import { sampleQueueCriterion, samplePermutationCriterion, IceFireThreeQueueCriterionRunner, ThreeQueueRandomCriterionRunner } from "./queueRunners";
import { ICE_FIRE_QUEUE_ORDERS, enemyQueueOrders, permuteIceFireState } from "../iceFirePermutations";
import { resolveThreeQueueMode, threeQueueSchedulerType } from "../../scenario";
const key = (q: ThreeQueueCandidateQueue) => JSON.stringify([q.sourceQueueIndex, q.leaderHeroIds, q.ratiosBp, q.headWeaponLevels]);
export function queueHeadsDisjoint(queues: readonly ThreeQueueCandidateQueue[], fixed: readonly boolean[] = []): boolean {
  const owners = new Map<string, number>();
  for (const [index, queue] of queues.entries()) for (const troop of TROOP_TYPES) {
    const id = queue.leaderHeroIds[troop]; if (!id) continue;
    const prior = owners.get(id);
    if (prior !== undefined && !(fixed[prior] && fixed[index])) return false;
    owners.set(id, index);
  }
  return true;
}
export const tripleRatioPattern = (state: ThreeQueueOptimizationState) => state.queues.map((q) => TROOP_TYPES.map((t) => q.ratiosBp[t]).join("/")).join("|");
export const uniqueTripleRatios = (states: readonly ThreeQueueOptimizationState[]) => new Set(states.map(tripleRatioPattern)).size;
interface RankedQueue { queue: ThreeQueueCandidateQueue; score: number; coverage: number[] }
/** Sorted pairs and a bounded Q3 frontier avoid materializing pool^3. */
export function combineQueuePools(pools: readonly (readonly RankedQueue[])[], pairLimit: number, tripleLimit: number, fixed: readonly boolean[] = [],
  pairTheory?: (q1: ThreeQueueCandidateQueue, q2: ThreeQueueCandidateQueue) => number) {
  const pairs: { q1: RankedQueue; q2: RankedQueue; score: number }[] = [];
  for (const q1 of pools[0]!) for (const q2 of pools[1]!) if (queueHeadsDisjoint([q1.queue, q2.queue], fixed) &&
    pools[2]!.some((q3) => queueHeadsDisjoint([q1.queue, q2.queue, q3.queue], fixed)))
    pairs.push({ q1, q2, score: q1.score + q2.score + .15 * Math.min(...q1.coverage.map((v, i) => Math.max(v, q2.coverage[i]!))) });
  pairs.sort((a, b) => b.score - a.score);
  const rawPairCandidateCount = pairs.length;
  const protectedPairs = new Set<typeof pairs[number]>();
  const structures = new Set<string>();
  for (const pair of pairs) {
    const dominant = (q: RankedQueue) => [...TROOP_TYPES].sort((a,b) => q.queue.ratiosBp[b]-q.queue.ratiosBp[a])[0];
    const structure = JSON.stringify([pair.q1.queue.leaderHeroIds, pair.q2.queue.leaderHeroIds, dominant(pair.q1), dominant(pair.q2)]);
    if (!structures.has(structure) && protectedPairs.size < Math.ceil(pairLimit / 5)) { structures.add(structure); protectedPairs.add(pair); }
  }
  for (const pair of pairs) { if (protectedPairs.size >= pairLimit) break; protectedPairs.add(pair); }
  pairs.splice(0, pairs.length, ...protectedPairs);
  if (pairTheory !== undefined) for (const pair of pairs) pair.score += pairTheory(pair.q1.queue, pair.q2.queue);
  pairs.sort((a,b) => b.score-a.score);
  const third = [...pools[2]!].sort((a, b) => b.score - a.score);
  const frontier: { pair: typeof pairs[number]; index: number; bound: number }[] = [];
  const push = (pair: typeof pairs[number], start: number) => {
    let index = start;
    while (index < third.length && !queueHeadsDisjoint([pair.q1.queue, pair.q2.queue, third[index]!.queue], fixed)) index++;
    if (index < third.length) frontier.push({ pair, index, bound: pair.score + third[index]!.score });
  };
  pairs.forEach((pair) => push(pair, 0));
  const candidates: ThreeQueueOptimizationState[] = [];
  while (frontier.length && candidates.length < tripleLimit) {
    frontier.sort((a, b) => b.bound - a.bound);
    const next = frontier.shift()!;
    candidates.push({ queues: [next.pair.q1.queue, next.pair.q2.queue, third[next.index]!.queue] }); push(next.pair, next.index + 1);
  }
  return { candidates, pairCandidates: pairs.length, rawPairCandidateCount,
    pairStructuralPatterns: structures.size, pairPruning: ["hero-disjoint", "Q3-compatibility", "coverage/head/ratio-potential", "structural-diversity", "bounded-Q3-score-frontier"] };
}
export function generateCriterionQueueSeeds(input: OptimizationInput, base: ThreeQueueOptimizationState,
  options: ThreeQueueOptimizationOptions, heroes: Readonly<Record<TroopType, readonly string[]>>,
  onProgress?: (p: OptimizationProgress) => void, profiler?: OptimizerProfiler) {
  const mode = input.scenarioType === "ICE_FIRE_LEAGUE" ? "ICE_FIRE_LEAGUE" : resolveThreeQueueMode(input.threeQueueMode);
  const label = mode === "ICE_FIRE_LEAGUE" ? "冰火战歌" : input.innerEarth?.subMode === "HERO_LAND" ? "英雄之地" : "大地之心";
  const makeRunner = mode === "ICE_FIRE_LEAGUE" ? IceFireThreeQueueCriterionRunner : ThreeQueueRandomCriterionRunner;
  const evaluator = makeRunner(input), enemy = currentCriterionQueueState(input, options.side === "A" ? "B" : "A");
  const ratios = generateRatioGrid(5), poolSize = options.criterionCandidatesPerQueue ?? (mode === "ICE_FIRE_LEAGUE" ? 150 : 120);
  let pairwiseEvaluations = 0, headCount = 0;
  const pools: RankedQueue[][] = [];
  const singleAudits: { rawCandidateCount: number; ratioGridSize: number; uniqueRatiosGenerated: number; uniqueRatiosAfterTheory: number; top20: { head: ThreeQueueCandidateQueue["leaderHeroIds"]; ratio: ThreeQueueCandidateQueue["ratiosBp"]; criterionScore: number }[] }[] = [];
  for (let slot = 0; slot < 3; slot++) {
    const current = base.queues[slot]!, fixed = options.lockHeroes[slot] || mode !== "ICE_FIRE_LEAGUE" && input.attributeInputMode === "finalReport";
    let heads = fixed ? [current.leaderHeroIds] : heroes.shield.flatMap((shield) => heroes.lancer.flatMap((lancer) =>
      heroes.marksman.map((marksman) => ({ shield, lancer, marksman })))).filter((head) => optimizerRecentHeadEligible(input, head, options.side));
    if (heads.length === 0) heads = [current.leaderHeroIds];
    const grid = options.lockRatios[slot] ? [current.ratiosBp] : ratios.map((r) => ({ shield: r.shield * 100, lancer: r.lancer * 100, marksman: r.marksman * 100 }));
    profiler?.begin(`${label} C0 · Q${slot + 1} 单队候选池`, heads.length * grid.length);
    const ranked: RankedQueue[] = [], bestHeads: RankedQueue[] = [];
    const topRaw: RankedQueue[] = [];
    let completed = 0;
    for (const head of heads) {
      headCount++;
      const local = grid.flatMap((ratiosBp) => {
        try {
        const queue = { sourceQueueIndex: slot, leaderHeroIds: head, headWeaponLevels: fixed ? current.headWeaponLevels ?? {} : optimizerHeadWeaponLevels(input, head, options.side), ratiosBp };
        const coverage = enemy.queues.map((opponent, index) => {
          const result = options.side === "A" ? evaluator.matchup(queue, opponent, slot, index) : evaluator.matchup(opponent, queue, index, slot);
          pairwiseEvaluations++; return options.side === "A" ? result.margin : -result.margin;
        });
        return [{ queue, coverage, score: coverage.reduce((sum, v) => sum + v, 0) / 3 + .35 * Math.min(...coverage) }];
        } catch (error) {
          if (error instanceof RangeError && /属性|因子/.test(error.message)) return [];
          throw error;
        }
      }).sort((a, b) => b.score - a.score);
      topRaw.push(...local.slice(0,20)); topRaw.sort((a,b) => b.score-a.score); topRaw.length = Math.min(20,topRaw.length);
      completed += grid.length;
      onProgress?.({ stage: `${label} C0 · Q${slot + 1} 单队候选池`, completed, total: heads.length * grid.length });
      if (local[0]) bestHeads.push(local[0]);
      ranked.push(...local.slice(0, Math.min(poolSize, fixed ? poolSize : 12)));
    }
    ranked.sort((a, b) => b.score - a.score); bestHeads.sort((a, b) => b.score - a.score);
    const selected = new Map<string, RankedQueue>();
    // A strong common hero must not crowd every alternative out of all three pools.
    const disjoint: ThreeQueueCandidateQueue[] = [];
    for (const row of bestHeads) if (queueHeadsDisjoint([...disjoint, row.queue])) {
      selected.set(key(row.queue), row); disjoint.push(row.queue); if (disjoint.length === 3) break;
    }
    const currentRow = ranked.find((row) => key(row.queue) === key(current)); if (currentRow) selected.set(key(current), currentRow);
    for (let index = 0; index < 3; index++) for (const row of [...ranked].sort((a, b) => b.coverage[index]! - a.coverage[index]!).slice(0, Math.ceil(poolSize / 8))) if (selected.size < poolSize) selected.set(key(row.queue), row);
    const usedHeads = new Set<string>();
    for (const row of bestHeads) if (selected.size < Math.ceil(poolSize / 3) && !usedHeads.has(JSON.stringify(row.queue.leaderHeroIds))) {
      selected.set(key(row.queue), row); usedHeads.add(JSON.stringify(row.queue.leaderHeroIds));
    }
    for (const row of ranked) if (selected.size < poolSize) selected.set(key(row.queue), row);
    pools.push([...selected.values()].sort((a, b) => b.score - a.score).slice(0, poolSize));
    singleAudits.push({ rawCandidateCount: heads.length * grid.length, ratioGridSize: grid.length,
      uniqueRatiosGenerated: new Set(grid.map((r) => JSON.stringify(r))).size,
      uniqueRatiosAfterTheory: new Set(pools[slot]!.map((r) => JSON.stringify(r.queue.ratiosBp))).size,
      top20: topRaw.map((row) => ({ head: row.queue.leaderHeroIds, ratio: row.queue.ratiosBp, criterionScore: row.score })) });
    profiler?.end();
  }
  const fixed = options.lockHeroes.map((locked) => locked || mode !== "ICE_FIRE_LEAGUE" && input.attributeInputMode === "finalReport");
  const ownSide = input[options.side === "A" ? "sideA" : "sideB"];
  const capacity = Math.max(1, ownSide.deploymentCapacity ?? TROOP_TYPES.reduce((sum,troop)=>sum+ownSide.troops[troop].count,0));
  const tripleLimit = options.criterionTripleLimit ?? 1000;
  const placements = mode === "ICE_FIRE_LEAGUE" && options.fixedOwnQueueOrder !== true ? 6 : 1;
  const baseTripleLimit = Math.max(1, Math.floor(tripleLimit / placements));
  const fineBudget = options.lockRatios.every(Boolean) ? 0 : Math.min(180, Math.floor(tripleLimit / 5));
  profiler?.begin(`${label} Pair · 两队互补筛选`, pools[0]!.length*pools[1]!.length);
  const combined = combineQueuePools(pools, options.criterionPairLimit ?? 2000, Math.max(1, Math.floor((tripleLimit - fineBudget) / placements)), fixed, (q1, q2) => {
    const pair: ThreeQueueOptimizationState = { queues: [q1, q2, q2] };
    if (mode === "ICE_FIRE_LEAGUE") return Math.min(...enemyQueueOrders(options.enemyPermutationMode ?? "allPermutations").map((order) => {
      const reordered = permuteIceFireState(enemy, order);
      const result = options.side === "A" ? evaluator.run(pair, reordered, options.rootSeed, 2, 3) : evaluator.run(reordered, pair, options.rootSeed, 3, 2);
      return Number(result.winner === options.side);
    }));
    const result = options.side === "A" ? evaluator.run(pair, enemy, options.rootSeed, 2, 3) : evaluator.run(enemy, pair, options.rootSeed, 3, 2);
    const own = options.side === "A" ? result.remainingA : result.remainingB;
    return Number(result.winner === options.side) + .05 * own.flat().reduce((sum,value) => sum+value,0) /
      capacity;
  });
  profiler?.end();
  // The user's current lineup is a protected reference even if generated heads
  // would fail disjointness; its six complete placements must remain searchable.
  if (!combined.candidates.some((c) => JSON.stringify(c) === JSON.stringify(base))) {
    if (combined.candidates.length >= baseTripleLimit) combined.candidates.pop();
    combined.candidates.push(base);
  }
  if (mode === "ICE_FIRE_LEAGUE" && options.fixedOwnQueueOrder !== true) {
    combined.candidates = combined.candidates.flatMap((candidate) => ICE_FIRE_QUEUE_ORDERS.map((order) => permuteIceFireState(candidate, order)));
  }
  const samples = mode === "ICE_FIRE_LEAGUE" ? 1 : options.criterionSchedulerTrials ?? 100;
  const score = (sample: ReturnType<typeof sampleQueueCriterion>) => sample.estimatedWinProbability + .05 * sample.meanRemainingTroops /
    capacity - .01 * sample.uncertainty;
  profiler?.begin(`${label} C1 · 整场调度 Criterion`, combined.candidates.length);
  const evaluate = (candidate: ThreeQueueOptimizationState, index: number) => {
    const sample = mode === "ICE_FIRE_LEAGUE"
      ? samplePermutationCriterion(evaluator, candidate, enemy, options.side, options.rootSeed + 800000, samples, options.enemyPermutationMode ?? "allPermutations")
      : { ...sampleQueueCriterion(evaluator, candidate, enemy, options.side, options.rootSeed + 800000, samples), criterionCurrent: 0, criterionAverage: 0, criterionWorst: 0, permutationCount: 1 };
    onProgress?.({ stage: `${label} C1 · 整场调度 Criterion`, completed: index + 1, total: combined.candidates.length });
    return { candidate, sample, score: score(sample) };
  };
  const compareCriterion = (a: ReturnType<typeof evaluate>, b: ReturnType<typeof evaluate>) => mode === "ICE_FIRE_LEAGUE"
    ? b.sample.criterionWorst - a.sample.criterionWorst || b.sample.criterionAverage - a.sample.criterionAverage || b.sample.criterionCurrent - a.sample.criterionCurrent || b.score - a.score
    : b.score - a.score;
  const ranked = combined.candidates.map(evaluate).sort(compareCriterion);
  const seen = new Set(combined.candidates.map((candidate)=>JSON.stringify(candidate)));
  const fine: ThreeQueueOptimizationState[] = [];
  for (const row of ranked.slice(0,8)) for (let slot=0;slot<3;slot++) {
    if (options.lockRatios[row.candidate.queues[slot]!.sourceQueueIndex ?? slot]) continue;
    const queue=row.candidate.queues[slot]!;
    for (const from of TROOP_TYPES) for (const to of TROOP_TYPES) {
      if (from===to || queue.ratiosBp[from]<100 || fine.length>=fineBudget) continue;
      const ratiosBp={...queue.ratiosBp,[from]:queue.ratiosBp[from]-100,[to]:queue.ratiosBp[to]+100};
      const candidate: ThreeQueueOptimizationState={queues:row.candidate.queues.map((q,i)=>i===slot?{...q,ratiosBp}:q) as unknown as ThreeQueueOptimizationState["queues"]};
      const id=JSON.stringify(candidate);if(!seen.has(id)){seen.add(id);fine.push(candidate);}
    }
  }
  ranked.push(...fine.map(evaluate)); ranked.sort(compareCriterion);
  profiler?.end();
  const theoryRunner = makeRunner(input, "theory"), theoryCandidates = ranked.slice(0, options.criterionTheoryLimit ?? 200);
  profiler?.begin(`${label} C2 · 整场 DeterministicTheory`, theoryCandidates.length);
  const theoryRanked = theoryCandidates.map((row, index) => {
    const theory = mode === "ICE_FIRE_LEAGUE"
      ? samplePermutationCriterion(theoryRunner, row.candidate, enemy, options.side, options.rootSeed + 800000, Math.min(8, samples), options.enemyPermutationMode ?? "allPermutations")
      : { ...sampleQueueCriterion(theoryRunner, row.candidate, enemy, options.side, options.rootSeed + 800000, Math.min(8, samples)), criterionCurrent: 0, criterionAverage: 0, criterionWorst: 0, permutationCount: 1 };
    onProgress?.({ stage: `${label} C2 · 整场 DeterministicTheory`, completed: index + 1, total: theoryCandidates.length });
    const ids = Object.values(row.candidate.queues.flatMap((q) => Object.values(q.leaderHeroIds)));
    const mechanisms = [...new Set(CONFIRMED_HERO_SKILL_DEFINITIONS.filter((skill) => ids.includes(skill.heroId) &&
      (skill.actionMechanic || skill.probability || Object.values(skill.levelValues).some((level) =>
        level.probability || level.periodRounds || level.cooldownRounds || level.effects.some((effect) =>
          ["extraDamage", "temporaryShield", "targetingOverride", "skipNextRoundAction", "targetBoundMark", "decayingDamage"].includes(effect.kind)))))
      .flatMap((skill) => [skill.actionMechanic?.kind ?? "", ...Object.values(skill.levelValues).flatMap((level) => level.effects).map((effect) => effect.kind)]).filter(Boolean))];
    return { ...row, theoryScore: score(theory), criterionScore: row.score,
      theoreticalWinRate: theory.estimatedWinProbability, criterionWinRate: row.sample.estimatedWinProbability,
      mechanisms, score: mode === "ICE_FIRE_LEAGUE" ? theory.criterionWorst : .65 * score(theory) + .35 * row.score, theoryCurrent: theory.criterionCurrent, theoryAverage: theory.criterionAverage, theoryWorst: theory.criterionWorst };
  }).sort((a, b) => mode === "ICE_FIRE_LEAGUE"
    ? b.theoryWorst - a.theoryWorst || b.theoryAverage - a.theoryAverage || b.theoryCurrent - a.theoryCurrent || compareCriterion(a, b)
    : b.score - a.score);
  profiler?.end();
  return { candidates: theoryRanked.map((row) => row.candidate), evidence: theoryRanked.map((row) => ({
    candidate: row.candidate, criterionScore: row.criterionScore, theoryScore: row.theoryScore,
    theoreticalWinRate: row.theoreticalWinRate, criterionWinRate: row.criterionWinRate,
    uncertainty: row.sample.uncertainty, mechanisms: row.mechanisms,
    criterionCurrent: row.sample.criterionCurrent, criterionAverage: row.sample.criterionAverage, criterionWorst: row.sample.criterionWorst,
    theoryCurrent: row.theoryCurrent, theoryAverage: row.theoryAverage, theoryWorst: row.theoryWorst,
  })), audit: {
    enemyPermutationMode: mode === "ICE_FIRE_LEAGUE" ? options.enemyPermutationMode ?? "allPermutations" : "fixedCurrent",
    enemyPermutationCount: mode === "ICE_FIRE_LEAGUE" && options.enemyPermutationMode !== "fixedCurrent" ? 6 : 1,
    myOrderSearchEnabled: mode === "ICE_FIRE_LEAGUE" && options.fixedOwnQueueOrder !== true,
    kernel: "CriterionBattle", schedulerStatus: "confirmed", threeQueueMode: mode, schedulerType: threeQueueSchedulerType(mode),
    schedulerStrategy: mode === "ICE_FIRE_LEAGUE" ? "ICE_FIRE_CURSOR" : "RANDOM_ALIVE_QUEUE",
    singleQueueAudit: singleAudits,
    q1SingleCandidateCount: singleAudits[0]!.rawCandidateCount, q2SingleCandidateCount: singleAudits[1]!.rawCandidateCount, q3SingleCandidateCount: singleAudits[2]!.rawCandidateCount,
    singleCandidateTotal: singleAudits.reduce((sum,a) => sum+a.rawCandidateCount,0),
    q1RawRatioCount: singleAudits[0]!.ratioGridSize, q2RawRatioCount: singleAudits[1]!.ratioGridSize, q3RawRatioCount: singleAudits[2]!.ratioGridSize,
    q1UniqueRatioCount: singleAudits[0]!.uniqueRatiosGenerated, q2UniqueRatioCount: singleAudits[1]!.uniqueRatiosGenerated, q3UniqueRatioCount: singleAudits[2]!.uniqueRatiosGenerated,
    q1UniqueRatiosAtC0: singleAudits[0]!.uniqueRatiosAfterTheory, q2UniqueRatiosAtC0: singleAudits[1]!.uniqueRatiosAfterTheory, q3UniqueRatiosAtC0: singleAudits[2]!.uniqueRatiosAfterTheory,
    uniqueTripleRatioPatternsAtC1: uniqueTripleRatios(ranked.map((row) => row.candidate)),
    uniqueTripleRatioPatternsAtC2: uniqueTripleRatios(theoryRanked.map((row) => row.candidate)),
    uniqueTripleRatioPatternsAtM1: 0, uniqueTripleRatioPatternsAtFinal: 0,
    ratioSearchExecuted: options.lockRatios.some((locked) => !locked), alternativeRatiosEvaluated: false, formalFinalistsCompared: false,
    pairCandidateCount: combined.pairCandidates, rawPairCandidateCount: combined.rawPairCandidateCount,
    pairStructuralPatterns: combined.pairStructuralPatterns, pairPruning: combined.pairPruning,
    tripleCandidateCount: ranked.length,
    singleQueueHeads: headCount, pairwiseEvaluations, queuePoolSizes: pools.map((p) => p.length), singleQueueCandidates: pools.map((p) => p.length),
    pairCandidates: combined.pairCandidates, combinations: ranked.length, tripleCandidates: ranked.length,
    fineTripleCandidates: fine.length, pairTheoryEvaluations: combined.pairCandidates,
    criterionTripleEvaluations: ranked.length, schedulerSeeds: samples, schedulerCriterionSamples: samples,
    theoryTripleCandidates: theoryCandidates.length, formalTripleCandidates: theoryRanked.length, selected: theoryRanked.length,
    estimatedCriterionWinRate: ranked[0]?.sample.estimatedWinProbability ?? 0, meanRemainingTroops: ranked[0]?.sample.meanRemainingTroops ?? 0,
    twoQueueFinishRate: ranked[0]?.sample.twoQueueFinishRate ?? 0, uncertainty: ranked[0]?.sample.uncertainty ?? 1,
    matchSequenceSamples: ranked[0]?.sample.matchSequenceSamples ?? [],
    finalWinRate: null as number | null, formalWinRate: null as number | null,
  } };
}
