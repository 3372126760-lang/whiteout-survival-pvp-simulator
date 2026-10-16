import { describe, expect, it } from "vitest";
import { scanJointPeaks, JointPeakHeap, compareJointPeaks, evaluateJointJ } from "../optimizer/jointPipeline/peakScan";
import type { JointCoefficientTable } from "../optimizer/jointPipeline/coefficients";
import { mergePeakRecall, peakPairKey } from "../optimizer/jointPipeline/recall";
import { createJointRankInspector } from "../optimizer/jointPipeline/rankDiagnostics";
import { resolveJointPipelineOptions, JOINT_TOP_K } from "../optimizer/jointPipeline/types";
import type { PreprocessedBodyRow } from "../optimizer/criterion/bodyPreprocess";
import { recallSourceLabel, renderJointCandidateDiagnostics } from "../../ui/jointCandidateView";
import { OLD_HEAD, OPPONENT_HEAD, rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";
import { defaultOptimizationConfig } from "../optimizer";
import { getValidationCatalog } from "../validationUi";
import { initializeOptimizationHeroPool, optimizationHeroIds } from "../optimizer/heroPools";
import { optimizerGeneration, recentGenerations } from "../optimizer/heroSearchPolicy";
import { OptimizerProfiler } from "../optimizer/profiling";
import { performanceReportBody } from "../../ui/optimizerPerformanceView";

function table(bodyCount = 10001): JointCoefficientTable {
  const base = new Float64Array([1, 1, 1, 100, 100, 100, 1, 1, 1, 1, 1, 1]);
  const bodyChannels = new Float64Array(bodyCount * 6);
  for (let b = 0; b < bodyCount; b++) for (let lane = 0; lane < 3; lane++) bodyChannels[b * 6 + lane] = (bodyCount - b) / 1e6;
  return { headCount: 2, bodyCount, headBase: base, headFactors: new Float64Array(24).fill(1), routes: [], headValues: new Float64Array(),
    bodyOffsets: new Uint32Array(bodyCount + 1), bodyTerms: new Uint32Array(), bodyValues: new Float64Array(), headChannels: new Float64Array(12),
    bodyChannels, reductions: [], incomingNormalShare: 1 };
}
describe("Global Top10000 plus per-Head protection", () => {
  it("defaults K to exactly 1 and validates explicit K", () => {
    expect(resolveJointPipelineOptions().perHeadProtectedK).toBe(1);
    expect(resolveJointPipelineOptions({ perHeadProtectedK: 3 }).perHeadProtectedK).toBe(3);
    expect(resolveJointPipelineOptions({ perHeadProtectedK: 123 }).perHeadProtectedK).toBe(123);
    for (const k of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => resolveJointPipelineOptions({ perHeadProtectedK: k })).toThrow();
  });
  it("fully scans H×B, keeps Global10000 unchanged and gives a globally weak Head its actual best Body", () => {
    const t = table(), chunk = scanJointPeaks({ table: t, headStart: 0, headEnd: 2, shard: 0 });
    expect(chunk.evaluatedHeadBodyCount).toBe(2 * t.bodyCount);
    expect(chunk.rows).toHaveLength(JOINT_TOP_K);
    expect(chunk.rows.every((row) => row.head === 0)).toBe(true);
    expect(chunk.perHeadRows.map((row) => [row.head, row.body])).toEqual([[0, 0], [1, 0]]);
    for (const row of chunk.perHeadRows) expect(evaluateJointJ(t, row.head, row.body, row.ratio)).toBeCloseTo(row.score, 9);
    const recall = mergePeakRecall(chunk.rows, chunk.perHeadRows, 1);
    expect(recall.audit).toMatchObject({ globalTopJCount: 10000, perHeadRawCount: 2, perHeadUniqueCount: 2,
      overlapWithGlobalTopJ: 1, mergedRecallCount: 10001, addedOnlyByPerHeadCount: 1 });
    expect(recall.sources.get("0:0")).toEqual(["globalTopJ", "perHeadBestJ"]);
    expect(recall.sources.get("1:0")).toEqual(["perHeadBestJ"]);
    expect(recall.sources.get("0:1")).toEqual(["globalTopJ"]);
    expect(recall.rows.length).toBeLessThanOrEqual(chunk.rows.length + t.headCount);
  });
  it("supports K3 and deterministic shard merging, including lexical tie breaking", () => {
    const t = table(17), whole = scanJointPeaks({ table: t, headStart: 0, headEnd: 2, shard: 0, perHeadProtectedK: 3 });
    const parts = [0, 1].map((head) => scanJointPeaks({ table: t, headStart: head, headEnd: head + 1, shard: head, perHeadProtectedK: 3 }));
    const heap = new JointPeakHeap(); parts.reverse().forEach((part) => part.rows.forEach((row) => heap.push(row)));
    expect(heap.sorted()).toEqual(whole.rows);
    expect(parts.flatMap((p) => p.perHeadRows).sort(compareJointPeaks)).toEqual([...whole.perHeadRows].sort(compareJointPeaks));
    expect(whole.perHeadRows.map((row) => row.body)).toEqual([0, 1, 2, 0, 1, 2]);
    const recall = mergePeakRecall(whole.rows, [...whole.perHeadRows, whole.perHeadRows[0]!], 3);
    expect(new Set(recall.rows.map(peakPairKey)).size).toBe(recall.rows.length);
    expect(recall.audit.mergedRecallCount).toBeLessThanOrEqual(whole.rows.length + 2 * 3);
    t.bodyChannels.fill(0);
    expect(scanJointPeaks({ table: t, headStart: 0, headEnd: 2, shard: 0 }).perHeadRows.map((r) => r.body)).toEqual([0, 0]);
  });
  it("computes exact axis ranks and honestly demonstrates a Body that Top1 still cannot recall", () => {
    const t = table(), chunk = scanJointPeaks({ table: t, headStart: 0, headEnd: 2, shard: 0 });
    const bodies = Array.from({ length: t.bodyCount }, (_, i) => ({ ids: [`math-body-${i}`], semantic: { skills: [{ skillLevel: 5 }] } })) as unknown as PreprocessedBodyRow[];
    const heads = [OLD_HEAD, OPPONENT_HEAD].map((leaderHeroIds) => ({ leaderHeroIds }));
    const inspector = createJointRankInspector(t, rallyHeadSearchFixture(), defaultOptimizationConfig(), heads, bodies, chunk.rows, "A");
    const candidate = { leaderHeroIds: OPPONENT_HEAD, memberSkillIds: ["math-body-7"], bodySkillLevels: [5], ratios: { shield: 64, lancer: 36, marksman: 0 } };
    const rank = inspector.diagnose(candidate);
    expect(rank).toMatchObject({ initialGlobalJRank: null, bodyRankWithinHead: 8, headRankWithinBody: 2 });
    expect(mergePeakRecall(chunk.rows, chunk.perHeadRows, 1).rows.some((row) => row.head === 1 && row.body === 7)).toBe(false);
    const larger = scanJointPeaks({ table: t, headStart: 0, headEnd: 2, shard: 0, perHeadProtectedK: 8 });
    expect(larger.perHeadRows.some((row) => row.head === 1 && row.body === 7)).toBe(true);
    expect(inspector.peakEvaluationCount).toBeLessThan(2 * t.bodyCount);
  });
  it("never labels a protected current/reference candidate as automatically searched merely because it has a J rank", () => {
    expect(recallSourceLabel(["currentConfig"])).toBe("当前配置（保护复验）");
    expect(recallSourceLabel(["protectedReference"])).not.toContain("本轮自动搜索");
    expect(recallSourceLabel(["globalTopJ", "perHeadBestJ"])).toContain("Both");
    const html = renderJointCandidateDiagnostics({ initialGlobalJRank: 3952, jMax: 100,
      jPeakRatio: { shield: 68.83, lancer: 7.03, marksman: 24.14 }, formalBestRatio: { shield: 59, lancer: 16, marksman: 25 },
      jAtFormalRatio: 96.68, jRetentionRatio: .9668, jLoss: .0332 });
    for (const text of ["Head×Body J峰值全局排名", "68.83 / 7.03 / 24.14", "59.00 / 16.00 / 25.00", "96.68%", "3.32%"])
      expect(html).toContain(text);
  });
  it("renders all seven checkpoints, cutoff, separate J values, protected sources and exact rank domains", () => {
    const profiler = new OptimizerProfiler();
    profiler.jointPeak = { headCount: 1062, bodyCount: 10185, evaluatedHeadBodyCount: 10816470,
      objectiveEvaluationCount: 10816470, kktEvaluationCount: 0, avgObjectiveCallsPerHeadBody: 1,
      elapsedMs: 1, preparationElapsedMs: 1, evaluatedHeadBodyPerSecond: 1, workerCount: 4, retainedCount: 10000, top10000CutoffJ: 1,
      rankCheckpoints: [1, 10, 100, 1000, 2000, 5000, 10000].map((rank) => ({ rank, j: 10001 - rank,
        relativeToBest: (10001 - rank) / 10000, lossFromBest: (rank - 1) / 10000,
        headKey: "view-head", bodyKey: "view-body", peakRatio: { shield: 70, lancer: 25, marksman: 5 } })) };
    profiler.finalCorrelation = { finalistJRanks: [3952], finalistJRetentionRatios: [.9668], bestFormalInitialJRank: 3952,
      maxInitialJRankAmongTop5: 3952, finalists: [{ formalRank: 1, headKey: "view-head", bodyKey: "view-body", trials: 1000, winRate: .652,
        initialGlobalJRank: 3952, recalledBy: ["currentConfig"], bodyRankWithinHead: 7, headRankWithinBody: 161,
        jPeakRatio: { shield: 70, lancer: 25, marksman: 5 }, formalBestRatio: { shield: 64, lancer: 36, marksman: 0 },
        jMax: 100, jAtFormalRatio: 96.68, jRetentionRatio: .9668, jLoss: .0332 }] };
    const html = performanceReportBody(profiler.snapshot());
    for (const rank of [1, 10, 100, 1000, 2000, 5000, 10000]) expect(html).toContain(`#${rank}</td>`);
    for (const text of ["J峰值截断参考", "Top10000 cutoff J", "J10000 / J1", "0.0100%", "7 / 10185", "161 / 1062", "当前配置（保护复验）", "96.6800%", "3.3200%"])
      expect(html).toContain(text);
    expect(html).not.toContain("本轮自动搜索");
  });
  it.each(["s12", "s13", "s14", "s15", "s16"] as const)("automatically derives the %s Head pool from the registry", (serverStage) => {
    const old = { ...rallyHeadSearchFixture(), availableHeroIds: undefined } as unknown as ReturnType<typeof rallyHeadSearchFixture>;
    delete (old as { availableHeroIds?: readonly string[] }).availableHeroIds;
    const input = initializeOptimizationHeroPool({ ...initializeOptimizationHeroPool(old), serverStage });
    const n = Number(serverStage.slice(1));
    expect(optimizationHeroIds(input)).toEqual(getValidationCatalog().leaderHeroes.filter((hero) => hero.category === "S" && (hero.generation ?? 100) <= n).map((hero) => hero.heroId));
    expect(optimizerGeneration(input)).toBe(n);
    const restricted = { ...input, ownedHeroIds: getValidationCatalog().leaderHeroes.filter((hero) => (hero.generation ?? 100) <= 10).map((hero) => hero.heroId) };
    expect(recentGenerations(optimizerGeneration(restricted))).toEqual([8, 9, 10]);
  });
});
