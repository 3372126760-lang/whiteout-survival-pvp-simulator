import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CanonicalBodyEffectRegistry, canonicalBodySemanticKey } from "../bodyEffects/canonicalRegistry";
import { CONFIRMED_HERO_SKILL_DEFINITIONS, type HeroSkillDefinition } from "../heroSkills";
import { getValidationCatalog, resolveBodySkillConfigs } from "../validationUi";
import { generateAllHeadFormations, candidateKey } from "../optimizer/candidateGenerator";
import { enumerateCanonicalBodyPool, maxTwoBodyCount } from "../optimizer/jointPipeline/canonicalBodies";
import { createJointCoefficientTable, combineJointCoefficients } from "../optimizer/jointPipeline/coefficients";
import { evaluateJointJ, jointRankCheckpoints, scanJointPeaks } from "../optimizer/jointPipeline/peakScan";
import { defaultOptimizationConfig } from "../optimizer";
import { createPeakJointWorkflow } from "../optimizer/jointPipeline/workflow";
import { createEvaluationExecutor, runOptimizationWorkflow, type EvaluationJob, type EvaluationJobResult } from "../optimizer/execution";
import { OptimizerProfiler, profileOptimizationWorkflow } from "../optimizer/profiling";
import { adaptiveSeedPools } from "../optimizer/adaptiveSampling";
import { localRatioGrid } from "../optimizer/jointPipeline/ratioGrid";
import type { FastBattleResult } from "../battle/fastBattleMode";
import { rallyHeadSearchFixture, OPPONENT_HEAD } from "./fixtures/rallyHeadSearch";
import { getBodySkillOptions, presentBodySkill } from "../../ui/bodySkillPresentation";
import { bodySkillOptionsView } from "../../ui/bodySkillSelectView";
import { performanceReportBody } from "../../ui/optimizerPerformanceView";
import { ratioObjective } from "../optimizer/jointPipeline/ratioPeak";
import { assertFrozenOptimizerFixture, assertMeasuredOptimizerFixture, sharedOptimizerOptions, benchmarkHash,
  type FrozenOptimizerBenchmarkFixture, type MeasuredOptimizerBenchmarkFixture } from "../../../scripts/optimizer-benchmark-fixture";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { jointHeadPolicy } from "../optimizer/jointPipeline/domain";

const registry = new CanonicalBodyEffectRegistry(undefined, "s12");
const fixture = JSON.parse(readFileSync("benchmarks/optimizer/joint-rally-gen12-input.json", "utf8")) as FrozenOptimizerBenchmarkFixture;
const input = { ...fixture.input, serverStage: "s12" as const };
const body = enumerateCanonicalBodyPool(input, {}, input.sideA.leaderHeroIds!, "A");
const all = getValidationCatalog();
const excluded = ["hero-skill.alongsuo.stormy-waves", "hero-skill.gelaige.sword-of-justice", "hero-skill.fulinte.wildfire", "hero-skill.moli.snow-command"];
const skill = (id: string) => CONFIRMED_HERO_SKILL_DEFINITIONS.find((s) => s.id === id)!;
describe("canonical Body policy A–R", () => {
  it("A: Head auto search contains no R/SR heroes", () => {
    const heads = generateAllHeadFormations(input, { fixedBodyExact: true, fixedMemberSkillIds: [] });
    expect(heads.length).toBe(876);
    expect(heads.every((h) => Object.values(h.leaderHeroIds).every((id) => all.leaderHeroes.find((h) => h.heroId === id)?.category === "S"))).toBe(true);
  });
  it("B: Body still includes the SR attack, penetration and life representatives", () => {
    for (const id of ["hero-skill.shuyun.attack", "hero-skill.jiexi.penetration", "hero-skill.patelike.life"])
      expect(body.rows.some((r) => r.memberSkillIds.includes(id))).toBe(true);
  });
  it("C: complete equivalent skills choose the earliest generation", () => {
    expect(registry.forSkill("hero-skill.buladeli.veterans-pride")?.representative.id).toBe("hero-skill.shuyun.attack");
    expect(registry.forSkill("hero-skill.hervor.war-cry")?.representative.id).toBe("hero-skill.jiexi.penetration");
    expect(registry.forSkill("hero-skill.ligeia.steel-fang-gnaw")?.representative.id).toBe("hero-skill.s8.hengdelike.defense-reduction");
  });
  it("D: adding a future identical effect cannot grow the registry", () => {
    const defs = registry.effects.flatMap((e) => e.aliases), original = skill("hero-skill.shuyun.attack");
    const future = { ...original, id: "future.s18.attack", heroId: "future.s18", metadata: { ...original.metadata, generation: 18 } };
    const next = new CanonicalBodyEffectRegistry([...defs, future]);
    expect(next.effects).toHaveLength(25); expect(next.forSkill(future.id)?.representative.id).toBe(original.id);
  });
  it("E: S12 has exactly 25 effects with the eight requested category counts", () => {
    expect(registry.effects).toHaveLength(25);
    expect(registry.categoryCounts()).toEqual({ attack: 3, defense: 3, penetration: 3, life: 1, damageIncrease: 5, skillDamage: 3, damageReduction: 5, vulnerability: 2 });
  });
  it("F: automatic pool has exactly 21 effects and requested categories", () => {
    expect(registry.automaticEffects).toHaveLength(21);
    expect(registry.categoryCounts(true)).toEqual({ attack: 3, defense: 3, penetration: 2, life: 1, damageIncrease: 3, skillDamage: 3, damageReduction: 4, vulnerability: 2 });
  });
  it("G: all four exclusions also exclude their complete semantic aliases", () => {
    for (const id of excluded) {
      const effect = registry.forSkill(id)!; expect(effect.optimizerExcluded).toBe(true);
      expect(body.rows.some((r) => r.memberSkillIds.some((s) => registry.forSkill(s) === effect))).toBe(false);
    }
  });
  it("H: excluded skills remain legal manual runtime instances and exact fixed Bodies", () => {
    expect(resolveBodySkillConfigs(excluded, [], "s12")).toHaveLength(4);
    const fixed = enumerateCanonicalBodyPool(input, { fixedBodyExact: true, fixedMemberSkillIds: excluded }, input.sideA.leaderHeroIds!, "A");
    expect(fixed.rows[0]!.memberSkillIds).toEqual(excluded);
    for (const id of excluded) expect(getBodySkillOptions("s12").some((o) => registry.forSkill(o.skillId) === registry.forSkill(id))).toBe(true);
  });
  it.each([["I", "hero-skill.weien.thunder-raid"], ["J", "hero-skill.ruini.dream-mark"], ["K", "hero-skill.gedun.poisoned-blade"]])("%s: %s is skillDamage category", (_letter, id) => {
    expect(registry.forSkill(id!)?.category).toBe("skillDamage"); expect(presentBodySkill(id!)?.category).toBe("技能伤害类");
  });
  it("L: Ahemosi belongs to damageReduction", () => expect(presentBodySkill("hero-skill.ahemosi.viper-phalanx")?.category).toBe("减伤类"));
  it("M: no specialMechanism or extra-damage category remains", () => {
    expect(Object.keys(registry.categoryCounts())).not.toContain("specialMechanism");
    expect(getBodySkillOptions("s12").every((o) => !/特殊|额外伤害类/.test(o.category))).toBe(true);
    const selected = bodySkillOptionsView({ side: "A", index: 0, stage: "s12", selectedSkillId: "hero-skill.rufus.fire-brigade", selectedLevel: 5, query: "" });
    expect(selected.html).toContain('value="hero-skill.rufus.fire-brigade" selected'); expect(selected.status).toContain("25 / 25");
    expect(selected.html).not.toContain("鲁弗斯（");
  });
  it("N: 21 effects produce exactly 10185 unordered four-slot max-two Bodies", () => {
    expect(maxTwoBodyCount(21)).toBe(10185); expect(body.bodies).toHaveLength(10185);
    const keys = body.rows.map((r) => r.memberSkillIds.map((id) => registry.forSkill(id)!.canonicalBodyEffectId).sort().join("|"));
    expect(new Set(keys).size).toBe(10185);
    expect(body.rows.every((r) => new Set(r.bodySlots.map((s) => s.runtimeInstanceId)).size === 4)).toBe(true);
  });
  it("O: audit counts reconcile and restricted pools explain differences", () => {
    const a = body.audit.canonical!;
    expect(a.canonicalEffectCountBefore).toBe(45); expect(a.canonicalEffectCountAfter).toBe(25);
    expect(a.rawOrderedCombinationCount - a.deduplicatedByPermutation - a.deduplicatedByCanonicalEffect - a.rejectedByExplicitOptimizerExclusion - a.rejectedByMultiplicityLimit).toBe(a.finalBodyCount);
    const restricted = enumerateCanonicalBodyPool({ ...input, rallyBodyPoolIds: ["hero.body.shuyun", "hero.body.jiexi"] }, {}, input.sideA.leaderHeroIds!, "A");
    expect(restricted.audit.canonical!.additionalConstraints).toContain("explicit rallyBodyPoolIds"); expect(restricted.bodies).toHaveLength(1);
  });
  const peaks = Array.from({ length: 10000 }, (_, i) => ({ head: 0, body: i, score: 10000 - i, ratio: { shield: 57, lancer: 3, marksman: 40 } }));
  const checkpoints = jointRankCheckpoints(peaks, ["h"], peaks.map((_, i) => `b${i}`));
  it("P: checkpoints include precisely 1/10/100/1000/2000/5000/10000", () => expect(checkpoints.map((p) => p.rank)).toEqual([1, 10, 100, 1000, 2000, 5000, 10000]));
  it("Q: checkpoint J is monotonically nonincreasing", () => expect(checkpoints.every((p, i) => !i || p.j <= checkpoints[i - 1]!.j)).toBe(true));
  it("R: checkpoint relativeToBest and loss use the actual rank-1 J", () => {
    for (const p of checkpoints) { expect(p.relativeToBest).toBe(p.j / 10000); expect(p.lossFromBest).toBe(1 - p.j / 10000); }
  });
});

describe("frozen reproducible S12 benchmark fixture", () => {
  it("saves full canonical config, formal scenario and explicit owned/optimization/Body pools", () => {
    expect(() => assertFrozenOptimizerFixture(fixture)).not.toThrow();
    expect(fixture.input.serverStage).toBe("s12"); expect(fixture.input.scenarioType).toBe("RALLY");
    expect(fixture.input.ownedHeroIds!.length).toBeGreaterThan(34); expect(fixture.input.rallyBodyPoolIds).toHaveLength(45);
    expect(fixture.input.optimizerHeroPool!.A).toBeDefined(); expect(fixture.input.optimizerHeroPool!.B).toBeDefined();
    expect(fixture.canonicalBattleConfig).toEqual(fixture.input);
    for (const side of [fixture.input.sideA, fixture.input.sideB]) for (const t of ["shield", "lancer", "marksman"] as const) {
      expect(side.troops[t].troopLevel).toBeDefined(); expect(side.troops[t].t12Level).toBe(0);
    }
  });
  it("stores the exact 300 screening and 1000 final common seeds", () => {
    expect(fixture.seedPolicy.screeningSeeds).toHaveLength(300); expect(fixture.seedPolicy.finalSeeds).toHaveLength(1000);
    expect(fixture.seedPolicy.finalSeeds.slice(0, 300)).toEqual(fixture.seedPolicy.screeningSeeds);
    expect(new Set(fixture.seedPolicy.finalSeeds).size).toBe(1000);
  });
  it("requires identical optimizer options except the old/new feature flag", () => {
    const options = fixture.optimizerConfig;
    expect(benchmarkHash(sharedOptimizerOptions(options))).toBe(benchmarkHash(sharedOptimizerOptions(options)));
    const changed = structuredClone(fixture); changed.optimizerConfig = { ...changed.optimizerConfig, firstSeed: changed.optimizerConfig.firstSeed + 1 };
    expect(() => assertFrozenOptimizerFixture(changed)).toThrow();
  });
  it("preserves historical57313/current56859/difference-454 without guessing", () => {
    expect(fixture.historicalBodyCount).toBe(57313); expect(fixture.currentReproducibleBodyCount).toBe(56859); expect(fixture.difference).toBe(-454);
    expect(fixture.historicalInputAvailable).toBe(false); expect(fixture.historicalTotalElapsedMs).toBe(454201.9);
  });
});

describe("staged formal evidence S–AB", () => {
  const input = rallyHeadSearchFixture(), constraints = { fixedLeaders: OPPONENT_HEAD, fixedBodyExact: true, fixedMemberSkillIds: [] };
  const config = { ...defaultOptimizationConfig(19),  constraints,
    theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 1 }, jointPipeline: { criterionKeep: 1, theoryKeep: 1,
      formalStages: [{ trials: 20, keep: 1 }, { trials: 50, keep: 1 }, { trials: 100, keep: 1 }, { trials: 300, keep: 1 }] } };
  const dispatched: EvaluationJob[] = [], execute = createEvaluationExecutor(), profiler = new OptimizerProfiler();
  const result = runOptimizationWorkflow(profileOptimizationWorkflow(createPeakJointWorkflow(input, config, profiler.progress, profiler), profiler), (job): EvaluationJobResult => {
    if (job.kind !== "battle") return execute(job);
    dispatched.push(job);
    const ratio = job.rallyCandidate!.ratios;
    const outcomes = job.seeds.map(() => ({ outcome: "A", roundCount: 12, remaining: {
      A: { shield: ratio.shield, lancer: ratio.lancer, marksman: ratio.marksman * 10 }, B: { shield: 0, lancer: 0, marksman: 0 } } } as FastBattleResult));
    return { samples: { trials: outcomes.length, requestedTrials: outcomes.length, wins: outcomes.length, losses: 0, failedTrials: 0, pruned: false, outcomes },
      performance: { simulatedTrials: outcomes.length, skippedTrials: 0, prunedCandidates: 0, templateBuilds: 1, templateHits: 0 }, timing: { battleCount: outcomes.length, battleElapsedMs: 1 } };
  });
  const profile = result.searchPerformanceReport!, stages = result.searchDiagnostics.searchIntegrityReport!.perStage;
  const stageA = stages.find((s) => s.stage.startsWith("Formal Ratio A"))!, stageB = stages.find((s) => s.stage.startsWith("Formal Ratio B"))!;
  const first = dispatched[0]!, seeds = adaptiveSeedPools(19, 300, 1000), centerKey = candidateKey(first.rallyCandidate!);
  const afterPrefix = dispatched.slice(3), neighborInitial = afterPrefix.filter((j) => j.seeds.length === 20);
  it("S: center and all neighbors compare the identical first 20 common seeds", () => {
    expect(neighborInitial.length).toBeGreaterThan(0);
    for (const job of neighborInitial) expect(job.seeds).toEqual(first.seeds);
    expect(stageA.requestedBattles).toBe(stageA.candidatesEntered * 20);
    expect(profile.formalRatio!.stageASamplesPerRatio).toBe(20);
  });
  it("T: the cached 100-sample center never repeats any sample", () => {
    const centerJobs = dispatched.filter((j) => candidateKey(j.rallyCandidate!) === centerKey);
    expect(new Set(centerJobs.flatMap((j) => j.seeds)).size).toBe(centerJobs.reduce((n, j) => n + j.seeds.length, 0));
    expect(stageA.reusedBattles).toBeGreaterThanOrEqual(20);
  });
  it("U: Stage A costs at most six new neighbors times 20 per lineup", () => {
    expect(stageA.executedBattles).toBeLessThanOrEqual(6 * 20); expect(localRatioGrid(first.rallyCandidate!.ratios, 1, 1).length).toBeLessThanOrEqual(7);
  });
  it("V: only Top2 ratios per lineup enter Stage B", () => {
    expect(stageB.candidatesEntered).toBe(2); expect(profile.formalRatio!.stageARetainedRatioCount).toBe(2);
  });
  it("W: each new ratio receives only the missing 80 seeds in Stage B", () => {
    const additions = afterPrefix.filter((j) => j.seeds.length === 80);
    expect(additions.length).toBeGreaterThan(0); for (const job of additions) expect(job.seeds).toEqual(seeds.screening.slice(20, 100));
    expect(stageB.executedBattles).toBeLessThanOrEqual(2 * 80); expect(stageA.executedBattles + stageB.executedBattles).toBeLessThanOrEqual(280);
  });
  it("X: formalBestRatio is written back to the actual changed candidate", () => {
    const candidate = result.top.find((r) => r.candidate.initialJRank)!.candidate;
    expect(candidate.ratios).toEqual(candidate.formalBestRatio); expect(candidate.ratios).not.toEqual(first.rallyCandidate!.ratios);
  });
  it("Y: Formal300 and Final1000 receive that formalBestRatio", () => {
    const finalist = result.top.find((r) => r.candidate.initialJRank)!.candidate;
    const jobs = dispatched.filter((j) => candidateKey(j.rallyCandidate!) === candidateKey(finalist));
    expect(jobs.some((j) => j.seeds.length === 200)).toBe(true); expect(jobs.some((j) => j.seeds.length === 1000)).toBe(true);
    for (const job of jobs.filter((j) => j.seeds.length >= 200)) expect(job.rallyCandidate!.ratios).toEqual(finalist.formalBestRatio);
  });
  it("Z: final J and initial peak reuse identical compiled coefficients and ratioObjective", () => {
    const heads = generateAllHeadFormations(input, constraints), bodies = enumerateCanonicalBodyPool(input, constraints, OPPONENT_HEAD, "A").bodies;
    const table = createJointCoefficientTable(input, config, heads, bodies), p = scanJointPeaks({ table, headStart: 0, headEnd: 1, shard: 0 }).rows[0]!;
    expect(evaluateJointJ(table, 0, 0, p.ratio)).toBeCloseTo(p.score, 4);
    const c = result.top.find((r) => r.candidate.initialJRank)!.candidate, s = new Float64Array(3), o = new Float64Array(3);
    combineJointCoefficients(table, 0, 0, s, o, new Float64Array(12));
    expect(c.jAtFormalRatio).toBe(evaluateJointJ(table, 0, 0, c.formalBestRatio!));
    expect(c.jAtFormalRatio).toBe(ratioObjective(s, o, [c.ratios.shield / 100, c.ratios.lancer / 100, c.ratios.marksman / 100]));
  });
  it("AA: final DTO, correlation and Developer tables contain all J lineage fields", () => {
    const c = result.top.find((r) => r.candidate.initialJRank)!.candidate;
    for (const key of ["initialJRank", "jPeakRatio", "jMax", "formalBestRatio", "jAtFormalRatio", "jRetentionRatio", "jLoss"]) expect(c).toHaveProperty(key);
    if (c.recalledBy?.includes("localBattleNeighbor")) {
      expect(c).not.toHaveProperty("criterionRatio"); expect(c).not.toHaveProperty("theoryRatio");
    } else {
      expect(c).toHaveProperty("criterionRatio"); expect(c).toHaveProperty("theoryRatio");
    }
    expect(c.jRetentionRatio).toBe(c.jAtFormalRatio! / c.jMax!);
    expect(profile.finalCorrelation!.finalistJRanks).toEqual(result.top.map((r) => r.candidate.initialJRank ?? null));
    const markup = performanceReportBody(profile); expect(markup).toContain("J峰值截断参考"); expect(markup).toContain("Formal Finalist Comparison");
    expect(markup).toContain("B0 车身枚举审计"); expect(profile.bodyEnumerationAudit!.canonical!.finalBodyCount).toBe(1);
  });
  it("AB: formal engine, skill definitions, troop rules, damage and RNG hashes are unchanged", () => {
    const hashes = JSON.parse(readFileSync("benchmarks/optimizer/formal-engine-integrity.json", "utf8")) as { path: string; sha256: string }[];
    expect(hashes.length).toBeGreaterThan(100);
    for (const file of hashes) expect(createHash("sha256").update(readFileSync(file.path, "utf8").replaceAll("\r\n", "\n")).digest("hex"), file.path).toBe(file.sha256);
  });
  it("preserves the measured recall input, complete seeds and candidate domain independently of generated profiles", () => {
    const measured = JSON.parse(readFileSync("benchmarks/optimizer/joint-recall-gen12-input.json", "utf8")) as MeasuredOptimizerBenchmarkFixture;
    expect(() => assertMeasuredOptimizerFixture(measured)).not.toThrow();
    expect(measured.inputSha256).toBe("1ea73d061bac6487e4788599ad0bbb406d28bee90a2a663854f47e49ee5df9cf");
    const restored = restorePersistedConfig(createPersistedEnvelope(measured.input, 1000, measured.optimizerConfig));
    expect(benchmarkHash(restored.input)).toBe(measured.inputSha256);
    // Profiling is session-only; the real Worker/CLI enables it after restore.
    expect(benchmarkHash({ ...restored.optimizationConfig, profiling: true })).toBe(measured.optimizerConfigSha256);
    const side = measured.optimizerConfig.candidateSide ?? "A";
    const heads = generateAllHeadFormations(measured.input, jointHeadPolicy(measured.input, measured.optimizerConfig).headConstraints, undefined, side);
    expect(heads).toHaveLength(1062);
    expect(enumerateCanonicalBodyPool(measured.input, measured.optimizerConfig.constraints, heads[0]!.leaderHeroIds, side).bodies).toHaveLength(10185);
    expect(measured.seedPolicy.screeningSeeds).toHaveLength(300);
    expect(measured.seedPolicy.finalSeeds).toHaveLength(1000);
    const changed = structuredClone(measured);
    changed.seedPolicy.finalSeeds = [...changed.seedPolicy.finalSeeds.slice(1), 1];
    expect(() => assertMeasuredOptimizerFixture(changed)).toThrow(/snapshot mismatch/);
  });
});

describe("strict semantic identity and skill damage channels", () => {
  const original = skill("hero-skill.shuyun.attack");
  it("normalizes implicit immediate lifecycle while preserving inactive RULE_UNKNOWN semantics", () => {
    const explicit = { ...original, levelValues: { 5: { effects: original.levelValues[5]!.effects.map((e) => ({ ...e, lifecycle: { activationTiming: "immediate" as const } })) } } };
    expect(canonicalBodySemanticKey(explicit)).toBe(canonicalBodySemanticKey(original));
    expect(canonicalBodySemanticKey({ ...original, metadata: { ...original.metadata, ruleStatus: "RULE_UNKNOWN" } })).not.toBe(canonicalBodySemanticKey(original));
  });
  it("keeps a required higher-generation alias alongside locked Body identities", () => {
    const constrained = enumerateCanonicalBodyPool({ ...input, rallyBodyPoolIds: ["hero.s11.rufus", "hero.body.shuyun", "hero.body.jiexi"] },
      { requiredHeroIds: ["hero.s11.rufus"], fixedMemberSkillIds: ["hero-skill.shuyun.attack"] }, {}, "A");
    expect(constrained.bodies.length).toBeGreaterThan(0);
    expect(constrained.rows.every((r) => r.memberSkillIds.includes("hero-skill.rufus.fire-brigade"))).toBe(true);
    expect(constrained.audit.canonical!.additionalConstraints).toContain("required Body hero identities");
  });
  it("does not merge equal named effects with different selected levels or disabled states", () => {
    const ids = ["hero-skill.shuyun.attack"], configured = { ...input, rallyBodyPoolIds: ["hero.s11.rufus", "hero.body.shuyun", "hero.body.jiexi"],
      sideA: { ...input.sideA, selectedMemberSkillIds: ids, bodySkills: resolveBodySkillConfigs(ids, [], "s12").map((b) => ({ ...b, skillLevel: 3 })) } };
    const levels = enumerateCanonicalBodyPool(configured, {}, {}, "A");
    expect(levels.audit.canonical!.canonicalEffectCount).toBe(3); expect(levels.bodies).toHaveLength(6);
    expect(levels.bodies.flatMap((b) => b.semantic.skills).filter((s) => s.skillId === ids[0]).every((s) => s.skillLevel === 3)).toBe(true);
    const disabled = enumerateCanonicalBodyPool({ ...configured, sideA: input.sideA, disabledSkillIds: ["hero-skill.shuyun.attack"] }, {}, {}, "A");
    expect(disabled.audit.canonical!.canonicalEffectCount).toBe(3);
  });
  it.each(["trigger", "probability", "duration", "interval", "activation", "lifecycle", "scope", "value", "operation-group", "refresh"])('never merges differing %s semantics', (field) => {
    const copy = structuredClone(original) as unknown as Record<string, unknown>;
    const values = (copy.levelValues as HeroSkillDefinition["levelValues"])[5]!;
    switch (field) {
      case "trigger": copy.trigger = "beforeAttack"; break;
      case "probability": copy.probability = .5; break;
      case "duration": copy.durationRounds = 2; break;
      case "interval": copy.actionMechanic = { kind: "attackCountTrigger", schedule: { source: "army", interval: 2, mode: "onCompleted" } }; break;
      case "activation": copy.activationTiming = "nextRound"; break;
      default: {
        const effect = values.effects[0]!;
        const changes = field === "scope" ? { scope: { source: "lancer" } } : field === "value" ? { value: .3 } : field === "operation-group" ? { group: "different" } : { lifecycle: { durationRounds: 1, refreshMode: field === "refresh" ? "stack" : "replace" } };
        copy.levelValues = { 5: { ...values, effects: [{ ...effect, ...changes }] } };
      }
    }
    expect(canonicalBodySemanticKey(copy as unknown as HeroSkillDefinition)).not.toBe(canonicalBodySemanticKey(original));
  });
  it.each([["hero-skill.weien.thunder-raid", [ .25, .4, .25 ]], ["hero-skill.ruini.dream-mark", [ 0, 1.44, 0 ]], ["hero-skill.gedun.poisoned-blade", [ 0, .8, 0 ]] ] as const)("%s compiles target-weighted skill damage, not a skillDamageIncrease multiplier", (id, expected) => {
    const body = enumerateCanonicalBodyPool(input, { fixedBodyExact: true, fixedMemberSkillIds: [id] }, input.sideA.leaderHeroIds!, "A").bodies;
    const config = { ...defaultOptimizationConfig(), constraints: {} }, heads = [{ leaderHeroIds: {}, memberSkillIds: [] }];
    const table = createJointCoefficientTable(input, config, heads, body);
    // Current-target lancer channels inherit 80% shield + 20% marksman = 1.6.
    [...table.bodyChannels.slice(3, 6)].forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 12));
    expect(table.routes.some((r) => r.key.includes("skillDamageIncrease"))).toBe(false);
  });
});
