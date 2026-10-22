import { jointHeadPolicy } from "./domain";
import { TROOP_TYPES } from "../../types";
import { resolveValidationTroopCounts } from "../../validationUi";
import { availableHeadHeroesByTroop, candidateKey, candidateToInput, candidateHeadWeaponLevels,
  currentRallyRatios, generateAllHeadFormations, headFormationGenerationAudit } from "../candidateGenerator";
import { currentHeadHeroIds, currentHeadWeaponLevels } from "../searchDimensions";
import { optimizerPoolAudit, optimizationHeroPoolFilterAudit } from "../heroPools";
import { enumerateCanonicalBodyPool } from "./canonicalBodies";
import { prepareCriterionHead, compileCriterionTemplate } from "../criterion/compiler";
import { criterionBattle } from "../criterion/solver";
import type { Triple } from "../criterion/types";
import { emptyCriterionAudit } from "../criterion/searchTypes";
import { knownRallyStructureReferences, recordCriterionCoverage } from "./references";
import { createTheoryTemplateBuilder, defaultTheoryOptions, estimateTheoryCandidate, headLineupKey } from "../theory";
import { BattleSampleLedger, adaptiveSeedPools, emptySearchIntegrityReport, type AdaptiveStageAudit } from "../adaptiveSampling";
import { evaluateSingleCandidate, type SingleSearchResult } from "../singleWaveSearch";
import { SingleWinObjective } from "../objectives";
import { createOptimizationContext, optimizationContextAudit } from "../optimizationContext";
import type { CandidateEvaluation, OptimizationConfig, OptimizationInput, OptimizationProgress, RallyCandidate } from "../types";
import type { OptimizationWorkflow } from "../execution";
import type { OptimizerProfiler } from "../profiling";
import { createJointCoefficientTable } from "./coefficients";
import { JointPeakHeap, evaluateJointJ, jointRankCheckpoints } from "./peakScan";
import { JOINT_TOP_K, resolveJointPipelineOptions, type JointPipelineAudit, type JointPeakRow } from "./types";
import { mergePeakRecall, peakPairKey } from "./recall";
import { createJointRankInspector } from "./rankDiagnostics";
import { localRatioGrid, localRatioBounds } from "./ratioGrid";

export function* createPeakJointWorkflow(input: OptimizationInput, config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void, profiler?: OptimizerProfiler): OptimizationWorkflow<SingleSearchResult> {
  const started = performance.now(), settings = resolveJointPipelineOptions(config.jointPipeline);
  const side = config.candidateSide ?? "A", enemy = side === "A" ? "B" : "A", own = input[side === "A" ? "sideA" : "sideB"];
  const theoryOptions = config.theory ?? defaultTheoryOptions(), audit = emptyCriterionAudit();
  const { dimensions, headConstraints } = jointHeadPolicy(input, config);
  Object.assign(audit, dimensions, optimizationContextAudit(createOptimizationContext(input, side)), optimizationHeroPoolFilterAudit(input, side));
  const progress = (stage: string, completed: number, total: number) => onProgress?.({ stage, completed, total });
  let time = performance.now(); profiler?.begin("H0 · 合法车头生成", 1);
  const formations = [...generateAllHeadFormations(input, headConstraints, undefined, side)].sort((a, b) =>
    headLineupKey(a.leaderHeroIds) < headLineupKey(b.leaderHeroIds) ? -1 : headLineupKey(a.leaderHeroIds) > headLineupKey(b.leaderHeroIds) ? 1 : 0);
  Object.assign(audit, headFormationGenerationAudit(input, headConstraints, undefined, side));
  if (!formations.length) throw new Error("没有合法车头/车身组合，请检查英雄池与锁定条件。");
  audit.legalHeads = formations.length; profiler?.end(); audit.headGenerationTime = performance.now() - time;
  time = performance.now(); profiler?.begin("B0 · canonical 车身效果与无序组合", 1);
  const bodyPool = enumerateCanonicalBodyPool(input, config.constraints, formations[0]!.leaderHeroIds, side);
  const bodyKey = (b: typeof bodyPool.bodies[number]) => b.ids.map((id, i) => `${id}@Lv${b.semantic.skills[i]!.skillLevel}`).join("|");
  const bodies = [...bodyPool.bodies].sort((a, b) => bodyKey(a) < bodyKey(b) ? -1 : bodyKey(a) > bodyKey(b) ? 1 : 0);
  Object.assign(audit, bodyPool.audit); audit.legalBodyCount = bodies.length;
  if (profiler) profiler.bodyEnumerationAudit = bodyPool.audit;
  if (!bodies.length) throw new Error("没有合法车身组合，请检查车身池与锁定条件。");
  profiler?.end(); audit.bodyPreprocessTime = performance.now() - time;
  time = performance.now(); profiler?.begin("J Preparation · 静态签名与免伤状态预计算", formations.length + bodies.length);
  const table = createJointCoefficientTable(input, config, formations, bodies), preparationElapsedMs = performance.now() - time;
  profiler?.end();
  const peakProfile: JointPipelineAudit["peak"] = { headCount: formations.length, bodyCount: bodies.length,
    evaluatedHeadBodyCount: 0, objectiveEvaluationCount: 0, kktEvaluationCount: 0, avgObjectiveCallsPerHeadBody: 0, elapsedMs: 0, preparationElapsedMs,
    evaluatedHeadBodyPerSecond: 0, workerCount: 0, retainedCount: 0, top10000CutoffJ: null };
  if (profiler) profiler.jointPeak = peakProfile;
  const heap = new JointPeakHeap(), perHeadPeaks: JointPeakRow[] = []; time = performance.now(); profiler?.begin("J Peak · Head×Body 峰值搜索", formations.length * bodies.length, Math.min(JOINT_TOP_K, formations.length * bodies.length));
  // Sixteen bounded shards expose progress and support the existing worker pool.
  const chunk = Math.max(1, Math.ceil(formations.length / 16));
  for (let offset = 0; offset < formations.length; offset += chunk * 4) {
    const jobs = Array.from({ length: Math.min(4, Math.ceil((formations.length - offset) / chunk)) }, (_, shard) => ({
      kind: "jointPeak" as const, input, seeds: [], side,
      jointPeakJob: { table, perHeadProtectedK: settings.perHeadProtectedK, headStart: offset + shard * chunk, headEnd: Math.min(formations.length, offset + (shard + 1) * chunk), shard } }));
    const rows = yield jobs;
    for (const row of rows) {
      if (!row.jointPeak) throw new Error("Missing J peak result.");
      peakProfile.evaluatedHeadBodyCount += row.jointPeak.evaluatedHeadBodyCount;
      peakProfile.objectiveEvaluationCount += row.jointPeak.objectiveEvaluationCount;
      peakProfile.kktEvaluationCount += row.jointPeak.kktEvaluationCount;
      peakProfile.workerCount = Math.max(peakProfile.workerCount, row.performance.workerCount ?? 0);
      for (const peak of row.jointPeak.rows) heap.push(peak);
      perHeadPeaks.push(...row.jointPeak.perHeadRows);
    }
    peakProfile.elapsedMs = performance.now() - time;
    peakProfile.avgObjectiveCallsPerHeadBody = peakProfile.objectiveEvaluationCount / peakProfile.evaluatedHeadBodyCount;
    peakProfile.evaluatedHeadBodyPerSecond = peakProfile.evaluatedHeadBodyCount * 1000 / peakProfile.elapsedMs;
    peakProfile.top10000CutoffJ = heap.rows[0]?.score ?? null;
    progress("J Peak · Head×Body 峰值搜索", peakProfile.evaluatedHeadBodyCount, formations.length * bodies.length);
  }
  profiler?.end(); profiler?.begin("Recall Merge · 全局 Top10000 ∪ 每 Head TopK", heap.rows.length + perHeadPeaks.length);
  const globalPeaks = heap.sorted(), recall = mergePeakRecall(globalPeaks, perHeadPeaks, settings.perHeadProtectedK), peaks = recall.rows;
  peakProfile.retainedCount = globalPeaks.length;
  if (peakProfile.evaluatedHeadBodyCount !== formations.length * bodies.length)
    throw new Error("The complete Head×Body J domain was not scanned.");
  if (recall.audit.perHeadUniqueCount !== formations.length * Math.min(settings.perHeadProtectedK, bodies.length))
    throw new Error("Per-head J recall coverage is incomplete.");
  if (profiler) profiler.recallAudit = recall.audit;
  profiler?.end();
  peakProfile.rankCheckpoints = jointRankCheckpoints(globalPeaks, formations.map((h) => headLineupKey(h.leaderHeroIds)), bodies.map(bodyKey));
  if (globalPeaks.length !== Math.min(JOINT_TOP_K, formations.length * bodies.length)) throw new Error("J global TopK is incomplete.");
  const weaponLevels = formations.map((h) => candidateHeadWeaponLevels(input, h.leaderHeroIds, config.constraints, side));
  const troopLevels = Object.fromEntries(TROOP_TYPES.map((t) => [t, own.troops[t].troopLevel])) as NonNullable<RallyCandidate["troopLevels"]>;
  const initialRanks = new Map(globalPeaks.map((p, i) => [peakPairKey(p), i + 1]));
  const pairPeaks = new Map<string, JointPeakRow>();
  const pairKey = (c: RallyCandidate) => candidateKey({ ...c, ratios: { shield: 0, lancer: 0, marksman: 0 } });
  const toCandidate = (peak: JointPeakRow): RallyCandidate => { const c: RallyCandidate = { initialJRank: initialRanks.get(peakPairKey(peak)) ?? null,
    initialGlobalJRank: initialRanks.get(peakPairKey(peak)) ?? null, recalledBy: recall.sources.get(peakPairKey(peak))!, jMax: peak.score, jPeakRatio: peak.ratio,
    leaderHeroIds: formations[peak.head]!.leaderHeroIds,
    memberSkillIds: bodies[peak.body]!.ids, headWeaponLevels: weaponLevels[peak.head]!,
    bodySkillLevels: bodies[peak.body]!.semantic.skills.map((s) => s.skillLevel), troopLevels, ratios: peak.ratio }; pairPeaks.set(pairKey(c), peak); return c; };
  const headTemplates = new Map<number, ReturnType<typeof prepareCriterionHead>>();
  type Pair = { peak: JointPeakRow; candidate: RallyCandidate };
  let criterionEvaluations = 0, theoryEvaluations = 0;
  time = performance.now(); profiler?.begin("Criterion · 局部 5% 粗筛", peaks.length);
  const criterionRows: Pair[] = [];
  for (const [index, peak] of peaks.entries()) {
    const pairStarted = performance.now();
    const candidate = toCandidate(peak);
    let head = headTemplates.get(peak.head);
    if (!head) { head = prepareCriterionHead(candidateToInput(input, { ...candidate, memberSkillIds: [] }, side)); headTemplates.set(peak.head, head); }
    const raw = compileCriterionTemplate(head, bodies[peak.body]!.signature, side), template = side === "A" ? raw : { a: raw.b, b: raw.a };
    const total = template.a.counts.reduce((a, b) => a + b, 0), grid = localRatioGrid(peak.ratio, 10, 5);
    let best: RallyCandidate | undefined;
    for (const ratios of grid) {
      const estimate = criterionBattle(template, TROOP_TYPES.map((t) => total * ratios[t] / 100) as unknown as Triple);
      criterionEvaluations++;
      if (!best || estimate.margin > best.criterionEstimate!.margin) best = { ...candidate, ratios, criterionRatio: ratios,
        criterionEstimate: estimate, criterionPerspectiveSide: side, selectionReasons: ["matrixCriterion"] };
    }
    if (!best) throw new Error("Local 5% simplex grid is empty.");
    criterionRows.push({ peak, candidate: best });
    if (!initialRanks.has(peakPairKey(peak))) recall.audit.addedOnlyCriterionElapsedMs = (recall.audit.addedOnlyCriterionElapsedMs ?? 0) + performance.now() - pairStarted;
    progress("Criterion · 局部 5% 粗筛", index + 1, peaks.length);
  }
  criterionRows.sort((a, b) => b.candidate.criterionEstimate!.margin - a.candidate.criterionEstimate!.margin || a.peak.head - b.peak.head || a.peak.body - b.peak.body);
  const criterionKeep = criterionRows.slice(0, settings.criterionKeep); profiler?.end(); audit.matrixCriterionTime = performance.now() - time;
  audit.matrixCriterionCandidates = audit.criterionEvaluations = criterionEvaluations;
  time = performance.now(); profiler?.begin("Criterion · 局部 1% 细筛", criterionKeep.length);
  const criterionFineRows: Pair[] = []; let criterionFineEvaluations = 0;
  for (const [index, row] of criterionKeep.entries()) {
    const raw = compileCriterionTemplate(headTemplates.get(row.peak.head)!, bodies[row.peak.body]!.signature, side);
    const template = side === "A" ? raw : { a: raw.b, b: raw.a }, total = template.a.counts.reduce((a, b) => a + b, 0);
    const grid = localRatioGrid(row.candidate.ratios, settings.theoryRadius, 1, localRatioBounds(row.peak.ratio, 10));
    let best: RallyCandidate | undefined;
    for (const ratios of grid) {
      const estimate = criterionBattle(template, TROOP_TYPES.map((t) => total * ratios[t] / 100) as unknown as Triple); criterionFineEvaluations++;
      if (!best || estimate.margin > best.criterionEstimate!.margin) best = { ...row.candidate, ratios, criterionRatio: ratios, criterionEstimate: estimate };
    }
    if (!best) throw new Error("Local 1% Criterion grid is empty.");
    criterionFineRows.push({ peak: row.peak, candidate: best }); progress("Criterion · 局部 1% 细筛", index + 1, criterionKeep.length);
  }
  criterionFineRows.sort((a, b) => b.candidate.criterionEstimate!.margin - a.candidate.criterionEstimate!.margin || a.peak.head - b.peak.head || a.peak.body - b.peak.body);
  const criterionFineKeep = criterionFineRows.slice(0, settings.criterionFineKeep); profiler?.end();
  audit.matrixCriterionTime += performance.now() - time;
  audit.matrixCriterionCandidates += criterionFineEvaluations; audit.criterionEvaluations += criterionFineEvaluations;
  const buildTheory = createTheoryTemplateBuilder(theoryOptions); time = performance.now(); profiler?.begin("Theory · 局部 1% 细筛", criterionFineKeep.length);
  const theoryRows: Pair[] = [];
  for (const [index, row] of criterionFineKeep.entries()) {
    const template = buildTheory(candidateToInput(input, row.candidate, side), side);
    const grid = localRatioGrid(row.candidate.ratios, settings.theoryRadius, 1, localRatioBounds(row.peak.ratio, 10));
    let best: RallyCandidate | undefined;
    for (const ratios of grid) {
      const estimate = estimateTheoryCandidate(template, TROOP_TYPES.map((t) => ratios[t])); theoryEvaluations++;
      if (!best || estimate.theoryScore > best.theoryEstimate!.theoryScore) best = { ...row.candidate, ratios, theoryRatio: ratios,
        theoryEstimate: estimate, selectionReasons: ["roundTheory"] };
    }
    if (!best) throw new Error("Local 1% simplex grid is empty.");
    theoryRows.push({ peak: row.peak, candidate: best }); progress("Theory · 局部 1% 细筛", index + 1, criterionFineKeep.length);
  }
  theoryRows.sort((a, b) => b.candidate.theoryEstimate!.theoryScore - a.candidate.theoryEstimate!.theoryScore || a.peak.head - b.peak.head || a.peak.body - b.peak.body);
  const formal = theoryRows.slice(0, settings.theoryKeep); profiler?.end(); audit.deterministicTheoryTime = performance.now() - time;
  audit.deterministicTheoryCandidates = theoryEvaluations; audit.battleEngineCandidates = formal.length;
  const pipeline: JointPipelineAudit = { recallAudit: recall.audit, body: bodyPool.audit.canonical!, peak: peakProfile, criterionPairs: peaks.length, criterionEvaluations,
    averageLocal5PercentRatios: criterionEvaluations / peaks.length, criterionFinePairs: criterionKeep.length, criterionFineEvaluations,
    theoryPairs: criterionFineKeep.length, theoryEvaluations,
    formalPairs: formal.length, formalRatioCandidates: 0, finalOptimizerCandidates: 0, comparisonCandidates: 0, finalTrials: Math.max(1000, config.verificationTrials) };
  const seeds = adaptiveSeedPools(config.firstSeed, 300, pipeline.finalTrials), integrity = emptySearchIntegrityReport(seeds.finalScreeningPrefix);
  const current: RallyCandidate = { initialJRank: null, initialGlobalJRank: null, recalledBy: ["currentConfig"], formalBestRatio: currentRallyRatios(input, side), leaderHeroIds: currentHeadHeroIds(input, side), headWeaponLevels: currentHeadWeaponLevels(input, side),
    memberSkillIds: input.scenarioType === "CITY_DEFENSE" && side === "A" ? [] : own.bodySkills?.map((b) => b.skillId) ?? own.selectedMemberSkillIds,
    bodySkillLevels: own.bodySkills?.map((b) => b.skillLevel) ?? own.selectedMemberSkillIds.map(() => 5), troopLevels,
    ratios: currentRallyRatios(input, side), selectionReasons: ["currentConfig"] };
  const currentKey = candidateKey(current), unique = (rows: readonly RallyCandidate[]) => {
    const map = new Map<string, RallyCandidate>();
    for (const c of rows) { const key = candidateKey(c), previous = map.get(key); if (!previous) map.set(key, c);
      else map.set(key, { ...previous, recalledBy: [...new Set([...(previous.recalledBy ?? []), ...(c.recalledBy ?? [])])],
        selectionReasons: [...new Set([...(previous.selectionReasons ?? []), ...(c.selectionReasons ?? [])])] }); }
    return [...map.values()];
  };
  const ledger = new BattleSampleLedger(candidateKey, (c: RallyCandidate) => candidateKey(c) === currentKey ? input : candidateToInput(input, c, side), side, profiler, seeds.screeningSet);
  const counts = resolveValidationTroopCounts(own, input.scenarioType === "CITY_DEFENSE" ? "challenge" : "rally", input.attributeInputMode ?? "finalReport"), total = TROOP_TYPES.reduce((sum, t) => sum + counts[t], 0);
  const records: { stage: string; candidates: number; trials: number; retained: number; simulatedTrials: number }[] = [];
  const visited = new Map<string, RallyCandidate["leaderHeroIds"]>();
  const compare = (a: CandidateEvaluation, b: CandidateEvaluation) => SingleWinObjective.compare(a, b) || (candidateKey(a.candidate) < candidateKey(b.candidate) ? -1 : 1);
  const stage = function* (name: string, candidates: readonly RallyCandidate[], stageSeeds: readonly number[]): OptimizationWorkflow<CandidateEvaluation[]> {
    const list = unique(candidates), startedAt = performance.now();
    const record: AdaptiveStageAudit = { stage: name, candidatesEntered: list.length, candidatesAdvanced: list.length, candidatesEliminated: 0,
      requestedBattles: 0, executedBattles: 0, reusedBattles: 0, cacheHitRate: 0, elapsedMs: 0 };
    integrity.perStage.push(record); profiler?.begin(name, list.length); progress(name, 0, list.length);
    yield* ledger.sample(list, stageSeeds, record, (n) => progress(name, n, list.length));
    const rows = list.map((candidate) => {
      if (candidate.recalledBy?.some((source) => source === "globalTopJ" || source === "perHeadBestJ"))
        visited.set(headLineupKey(candidate.leaderHeroIds), candidate.leaderHeroIds);
      return evaluateSingleCandidate(candidate, total, stageSeeds, () => ledger.outcomes(candidate, stageSeeds).map((r) => ({
        outcome: r.outcome === side ? "A" as const : r.outcome === enemy ? "B" as const : r.outcome,
        self: r.remaining[side], enemy: r.remaining[enemy], rounds: r.roundCount })));
    }).sort(compare);
    profiler?.end(); record.elapsedMs = performance.now() - startedAt;
    records.push({ stage: name, candidates: list.length, trials: stageSeeds.length, retained: list.length, simulatedTrials: record.executedBattles });
    recordCriterionCoverage(audit, name, list); return rows;
  };
  let pool = formal.map((r) => r.candidate), top: CandidateEvaluation[] = [];
  for (const [index, setting] of settings.formalStages.entries()) {
    const rows = yield* stage(`Formal ${setting.trials} · 累计正式战斗`, pool, seeds.screening.slice(0, setting.trials));
    top = rows.slice(0, setting.keep);
    const record = integrity.perStage.at(-1)!; record.candidatesAdvanced = top.length; record.candidatesEliminated = rows.length - top.length;
    records.at(-1)!.retained = top.length;
    if (index === 2) {
      const parents = top, ratioStarted = performance.now();
      const neighbors = parents.flatMap((r) => localRatioGrid(r.candidate.ratios, 1, 1)
        .map((ratios) => ({ ...r.candidate, ratios, selectionReasons: ["fineSearch" as const] })));
      pipeline.formalRatioCandidates = neighbors.length;
      const ratioProfile = { lineupCount: parents.length, generatedRatioCount: neighbors.length, stageASamplesPerRatio: 20,
        stageARequestedBattles: 0, stageAExecutedBattles: 0, stageAReusedBattles: 0, stageARetainedRatioCount: 0,
        stageBSamplesPerRatio: 100, stageBRequestedBattles: 0, stageBExecutedBattles: 0, stageBReusedBattles: 0, elapsedMs: 0 };
      pipeline.formalRatio = ratioProfile; if (profiler) profiler.formalRatio = ratioProfile;
      const testedA = yield* stage("Formal Ratio A · 共同 20 场保留 Top2 比例", neighbors, seeds.screening.slice(0, 20));
      const aRecord = integrity.perStage.at(-1)!;
      Object.assign(ratioProfile, { stageARequestedBattles: aRecord.requestedBattles, stageAExecutedBattles: aRecord.executedBattles, stageAReusedBattles: aRecord.reusedBattles });
      const retained = new Map<string, CandidateEvaluation[]>();
      for (const row of testedA) { const key = pairKey(row.candidate), list = retained.get(key) ?? []; if (list.length < 2) list.push(row); retained.set(key, list); }
      const topTwo = [...retained.values()].flat(); ratioProfile.stageARetainedRatioCount = topTwo.length;
      aRecord.candidatesAdvanced = records.at(-1)!.retained = topTwo.length; aRecord.candidatesEliminated = testedA.length - topTwo.length;
      const tested = yield* stage("Formal Ratio B · Top2 累计 100 场", topTwo.map((r) => r.candidate), seeds.screening.slice(0, 100));
      const bRecord = integrity.perStage.at(-1)!;
      Object.assign(ratioProfile, { stageBRequestedBattles: bRecord.requestedBattles, stageBExecutedBattles: bRecord.executedBattles, stageBReusedBattles: bRecord.reusedBattles });
      const byPair = new Map<string, CandidateEvaluation>();
      for (const row of tested) {
        const key = pairKey(row.candidate);
        if (!byPair.has(key)) {
          const candidate = row.candidate, peak = pairPeaks.get(pairKey(candidate))!, jAtFormalRatio = evaluateJointJ(table, peak.head, peak.body, candidate.ratios);
          const jRetentionRatio = peak.score ? jAtFormalRatio / peak.score : 1;
          byPair.set(key, { ...row, candidate: { ...candidate, formalBestRatio: candidate.ratios, jAtFormalRatio, jRetentionRatio, jLoss: 1 - jRetentionRatio } });
        }
      }
      top = [...byPair.values()].sort(compare).slice(0, settings.formalRatioKeep);
      bRecord.candidatesAdvanced = records.at(-1)!.retained = top.length; bRecord.candidatesEliminated = tested.length - top.length;
      ratioProfile.elapsedMs = performance.now() - ratioStarted; integrity.fineSearch.basinCount = parents.length;
      integrity.fineSearch.basin1PercentEntered = parents.length;
      integrity.fineSearch.generated1PercentRatios = neighbors.length;
    }
    pool = top.map((r) => r.candidate);
  }
  pipeline.finalOptimizerCandidates = pool.length;
  // Comparisons never occupy J, Criterion, Theory or Formal promotion slots.
  const references = [...(config.protectedCandidates ?? []), ...knownRallyStructureReferences(input, config)]
    .filter((c) => dimensions.headSearchEnabled || headLineupKey(c.leaderHeroIds) === headLineupKey(current.leaderHeroIds));
  const comparisons = unique([current, ...references.map((c) => ({ ...c, initialJRank: null, initialGlobalJRank: null, recalledBy: ["protectedReference" as const], formalBestRatio: c.ratios }))]); pipeline.comparisonCandidates = comparisons.length;
  const verified = yield* stage(`Final ${pipeline.finalTrials} · common seeds 复验`, unique([...pool, ...comparisons]), seeds.final);
  const baseline = verified.find((r) => candidateKey(r.candidate) === currentKey)!;
  if (!baseline) throw new Error("Exact baseline was not verified.");
  const inspector = createJointRankInspector(table, input, config, formations, bodies, globalPeaks, side);
  for (let i = 0; i < verified.length; i++) {
    const row = verified[i]!, candidate = { ...row.candidate, ...inspector.diagnose(row.candidate), formalBestRatio: row.candidate.ratios };
    const pair = inspector.indices(candidate);
    if (pair && candidate.jMax !== undefined) {
      const jAtFormalRatio = evaluateJointJ(table, pair.head, pair.body, candidate.ratios);
      const jRetentionRatio = candidate.jMax ? jAtFormalRatio / candidate.jMax : 1;
      Object.assign(candidate, { jAtFormalRatio, jRetentionRatio, jLoss: 1 - jRetentionRatio });
    }
    verified[i] = { ...row, candidate };
  }
  recall.audit.finalistRecallSources = verified.map((r) => ({ headKey: headLineupKey(r.candidate.leaderHeroIds), bodyKey: r.candidate.memberSkillIds.join("|"), recalledBy: r.candidate.recalledBy ?? [], winRate: r.winRate }));
  recall.audit.bestFormalRecallSource = verified[0]?.candidate.recalledBy ?? [];
  recall.audit.debugCandidates = [current, ...(config.jointDebugCandidates ?? [])].map((c) => {
    const lineage = inspector.diagnose(c), pair = inspector.indices(c);
    const best = pair ? perHeadPeaks.filter((p) => p.head === pair.head).sort((a, b) => b.score - a.score || a.body - b.body)[0] : undefined;
    return { ...lineage, recalledBy: pair ? recall.sources.get(peakPairKey(pair)) ?? [] : [],
      headKey: headLineupKey(c.leaderHeroIds), bodyKey: c.memberSkillIds.join("|"),
      minimumPerHeadK: lineage.bodyRankWithinHead ?? null, recalledByTop1: lineage.bodyRankWithinHead === 1,
      ...(best ? { bestBodyForHead: { bodyKey: bodies[best.body]!.ids.join("|"), jMax: best.score, jPeakRatio: best.ratio } } : {}) };
  });
  recall.audit.rankDiagnosticPeakEvaluations = inspector.peakEvaluationCount;
  const ranked = verified.slice(0, config.topN), heads = [...visited.values()];
  const finalCorrelation = { finalistJRanks: verified.map((r) => r.candidate.initialJRank ?? null),
    finalistJRetentionRatios: verified.map((r) => r.candidate.jRetentionRatio ?? null),
    bestFormalInitialJRank: verified[0]?.candidate.initialJRank ?? null,
    maxInitialJRankAmongTop5: Math.max(0, ...verified.slice(0, 5).map((r) => r.candidate.initialJRank ?? 0)) || null,
    finalists: verified.map((r, i) => ({ ...r.candidate, formalRank: i + 1, headKey: headLineupKey(r.candidate.leaderHeroIds),
      bodyKey: r.candidate.memberSkillIds.join("|"), trials: r.trials, winRate: r.winRate })) };
  pipeline.finalCorrelation = finalCorrelation; if (profiler) profiler.finalCorrelation = finalCorrelation;
  integrity.final.finalistsAt300 = integrity.final.finalistsAt500 = integrity.final.finalistsAt1000 = verified.length;
  integrity.final.screeningRuns = ledger.executedScreeningRuns; integrity.final.independentValidationRuns = ledger.executedIndependentRuns;
  audit.battleRunsRequested = integrity.perStage.reduce((sum, r) => sum + r.requestedBattles, 0);
  audit.battleRunsExecuted = integrity.perStage.reduce((sum, r) => sum + r.executedBattles, 0);
  audit.battleRunsReused = integrity.perStage.reduce((sum, r) => sum + r.reusedBattles, 0);
  audit.finalCandidates = verified.length; audit.uniqueFinalHeads = new Set(verified.map((r) => headLineupKey(r.candidate.leaderHeroIds))).size;
  audit.uniqueFinalBodies = new Set(verified.map((r) => r.candidate.memberSkillIds.join("|"))).size;
  audit.totalWallTime = performance.now() - started;
  audit.finalists = verified.map((r) => {
    const c = r.candidate, mapped = candidateKey(c) === currentKey ? input : candidateToInput(input, c, side), actual = mapped[side === "A" ? "sideA" : "sideB"].bodySkills ?? [];
    return { headHeroIds: c.leaderHeroIds, headWeaponLevels: c.headWeaponLevels ?? {}, weaponLevelSource: candidateKey(c) === currentKey ? "exactBaseline" as const : dimensions.headSearchEnabled ? "optimizerHeroPool" as const : "fixedCurrentHead" as const,
      bodySkillIds: c.memberSkillIds, bodySkillLevels: actual.map((b) => b.skillLevel),
      bodySlots: actual.map((b, i) => ({ heroDefinitionId: b.heroDefinitionId ?? b.heroId, runtimeInstanceId: b.runtimeInstanceId ?? `${side}-body-${i}`,
        effectFamily: bodyPool.rows.find((row) => row.memberSkillIds.join("|") === c.memberSkillIds.join("|"))?.bodySlots[i]?.effectFamily ?? b.skillId,
        skillId: b.skillId, level: b.skillLevel })), ratios: c.ratios, trials: r.trials, wins: r.wins, winRate: r.winRate,
      winRateConfidenceInterval: r.wilson95, selectionReasons: c.selectionReasons ?? [], uncertainty: c.theoryEstimate?.uncertainty ?? 0,
      ...(c.theoryEstimate ? { theoryScore: c.theoryEstimate.theoryScore } : {}), ...(c.criterionEstimate ? { criterion: c.criterionEstimate } : {}) };
  });
  const choices = availableHeadHeroesByTroop(input, config.constraints, undefined, side);
  return { top: ranked, coarseBest: ranked[0]!, current: verified.find((r) => candidateKey(r.candidate) === currentKey)!, evaluatedCandidates: ledger.evaluatedBatches, performance: ledger.performance,
    searchDiagnostics: { jointPipeline: pipeline, criterionAudit: audit, bodyEnumerationAudit: bodyPool.audit, searchDimensionAudit: dimensions,
      weaponAudit: dimensions.headSearchEnabled ? optimizerPoolAudit(input, side) : [], searchIntegrityReport: integrity,
      theoryOptions, monteCarloStages: records, legalHeadCandidateCount: formations.length, evaluatedUniqueHeadCandidateCount: heads.length,
      headCoverageRate: heads.length / formations.length * 100, fixedBody: !dimensions.bodySearchEnabled,
      availableBodyCandidateCount: bodies.length, stage1Trials: 20, stage1CandidateCount: formal.length,
      retainedHeadCandidateCount: new Set(formal.map((r) => r.peak.head)).size, stage2RatioCandidateCount: theoryEvaluations,
      fixedHead: !dimensions.headSearchEnabled, searchDimensions: { headShield: dimensions.headSearchEnabled,
        headLancer: dimensions.headSearchEnabled, headMarksman: dimensions.headSearchEnabled, body: dimensions.bodySearchEnabled, troopRatio: true },
      availableHeadHeroesByTroop: choices, shieldCandidateCount: choices.shield.length, lancerCandidateCount: choices.lancer.length,
      marksmanCandidateCount: choices.marksman.length, headCandidateCount: formations.length, bodyCandidateCount: bodies.length,
      ratioCandidateCount: criterionEvaluations, totalCandidateCount: formations.length * bodies.length,
      coarseRatioCandidateCount: criterionEvaluations, coarseCandidateCount: peaks.length, generatedFormationCount: formations.length,
      evaluatedHeadLineups: heads, bestHeadLineup: ranked[0]!.candidate.leaderHeroIds, optimizationTargetSide: side, candidateChangedSide: side } };
}
