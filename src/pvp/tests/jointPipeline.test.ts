import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaultOptimizationConfig } from "../optimizer";
import { CONFIRMED_HERO_SKILL_DEFINITIONS, type HeroSkillDefinition, type HeroSkillEffect } from "../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS } from "../troopSkills";
import { getValidationCatalog, resolveBodySkillConfigs, createValidationPreviewState } from "../validationUi";
import { TROOP_TYPES } from "../types";
import type { FastBattleResult } from "../battle/fastBattleMode";
import { getTroopConstant } from "../data/troopConstants";
import { candidateToInput, generateAllHeadFormations, candidateKey } from "../optimizer/candidateGenerator";
import { optimizerGeneration, optimizerRecentHeadEligible } from "../optimizer/heroSearchPolicy";
import { optimizationHeroIds, visibleOptimizationHeroIds } from "../optimizer/heroPools";
import { createBodySkillSignature } from "../optimizer/criterion/bodyPreprocess";
import { enumerateBodyCombinations, enumeratePreprocessedBodyPool } from "../optimizer/criterion/bodyEnumeration";
import { canonicalEffectFamily, probabilityBodyDominatedBy } from "../optimizer/jointPipeline/bodyPolicy";
import { expectedIncomingMultiplier, equivalentReduction, roundCoverage, createJointCoefficientTable, combineJointCoefficients } from "../optimizer/jointPipeline/coefficients";
import { localRatioGrid, localRatioBounds } from "../optimizer/jointPipeline/ratioGrid";
import { JOINT_TOP_K, resolveJointPipelineOptions, type JointPeakRow } from "../optimizer/jointPipeline/types";
import { JointPeakHeap, scanJointPeaks } from "../optimizer/jointPipeline/peakScan";
import { findRatioPeak, ratioObjective } from "../optimizer/jointPipeline/ratioPeak";
import { createPeakJointWorkflow } from "../optimizer/jointPipeline/workflow";
import { createEvaluationExecutor, runOptimizationWorkflow, type EvaluationJob, type EvaluationJobResult } from "../optimizer/execution";
import { adaptiveSeedPools } from "../optimizer/adaptiveSampling";
import { OptimizerProfiler, profileOptimizationWorkflow } from "../optimizer/profiling";
import { rallyHeadSearchFixture, OPPONENT_HEAD } from "./fixtures/rallyHeadSearch";
import { compressedRallyBodyNames, rallyRecommendationDetails } from "../../ui/rallyRecommendationView";
import { playerOptimizationProgress } from "../../ui/optimizerProgressView";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";

const emptyBody = { fixedBodyExact: true, fixedMemberSkillIds: [] };
const nora = "hero-skill.nuola.multi-troop-combat", wuming = "hero-skill.wuming.wind-shelter";
function effect(attribute: "attack" | "penetration" = "attack", value = .25): HeroSkillEffect {
  return { id: "test-effect", name: "test", recipient: "selfArmy", scope: { source: "army", target: "all" },
    kind: "attributeModifier", attribute, operation: "multiplyAttributeFactor", group: "skill" + attribute, value };
}
function skill(id: string, effects: readonly HeroSkillEffect[] = [effect()], p = 1): HeroSkillDefinition {
  return { id, heroId: id, name: id, trigger: "passive", probability: p,
    positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: 1, allowedPositions: ["member", "leader"] },
    levelValues: { 5: { effects } }, metadata: { ruleStatus: "supported", source: "mathematical fixture" } };
}
function numericTable() {
  const base = rallyHeadSearchFixture(), ids = [...CONFIRMED_HERO_SKILL_DEFINITIONS, ...CONFIRMED_TROOP_SKILL_DEFINITIONS].map((s) => s.id);
  const input = { ...base, disabledSkillIds: ids, sideA: { ...base.sideA, simulationWeaponLevels: {},
    leaderHeroIds: { shield: null, lancer: null, marksman: null }, troops: Object.fromEntries(TROOP_TYPES.map((t, i) => [t, {
      ...base.sideA.troops[t], attack: 100, penetration: 100, defense: 100, life: 100, troopLevel: i === 1 ? "T3" : "T11-FC3",
      levelMode: "single" as const }])) as typeof base.sideA.troops } };
  const config = { ...defaultOptimizationConfig(), constraints: emptyBody }, heads = generateAllHeadFormations(input, emptyBody);
  const bodies = enumeratePreprocessedBodyPool(input, emptyBody, heads[0]!.leaderHeroIds, { jointPolicy: true }).bodies;
  return { input, config, heads, bodies, table: createJointCoefficientTable(input, config, heads, bodies) };
}
function tableWithSkills(definitions: readonly HeroSkillDefinition[]) {
  const fixture = numericTable();
  const bodyPool = enumerateBodyCombinations({ sources: definitions.map((s) => ({ heroId: s.heroId, skillId: s.id, effectKey: s.id })),
    fixedMemberSkillIds: definitions.map((s) => s.id), fixedBodyExact: true, requiredBodyHeroIds: [], allowDuplicateMembers: true,
    equivalentMemberPositions: false, disabledSkillIds: [], levelForSlot: () => 5 }, { definitions, preprocess: true, jointPolicy: true });
  return createJointCoefficientTable(fixture.input, fixture.config, fixture.heads, bodyPool.bodies);
}
const coefficient = (table: ReturnType<typeof numericTable>["table"]) => {
  const s = new Float64Array(3), o = new Float64Array(3); combineJointCoefficients(table, 0, 0, s, o, new Float64Array(12)); return { s, o };
};
describe("new joint Head legality", () => {
  it("keeps the experimental pipeline opt-in until performance and quality gates pass", () => expect(defaultOptimizationConfig()).not.toHaveProperty("useSimpleRatioPrior"));
  it("uses enabled owned generation rather than serverGeneration", () => {
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: ["hero.s1.nataliya", "hero.s3.miya", "hero.s8.hengdelike"] };
    expect(optimizerGeneration(input)).toBe(8); expect(generateAllHeadFormations(input, emptyBody)).toHaveLength(1);
  });
  it.each([1, 2])("adds no recent-generation constraint when n=%i", (generation) => {
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: getValidationCatalog().leaderHeroes.filter((h) => h.category === "S" && (h.sGeneration ?? 100) <= generation).map((h) => h.heroId) };
    expect(optimizerGeneration(input)).toBe(generation); expect(optimizerRecentHeadEligible(input, { shield: "hero.s1.nataliya" })).toBe(true);
    expect(generateAllHeadFormations(input, emptyBody).length).toBeGreaterThan(0);
  });
  it.each([8, 11])("requires one of the last three generations when n=%i", (generation) => {
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: getValidationCatalog().leaderHeroes.filter((h) => h.category === "S" && (h.sGeneration ?? 100) <= generation).map((h) => h.heroId) };
    const rows = generateAllHeadFormations(input, emptyBody);
    expect(rows.every((r) => Object.values(r.leaderHeroIds).some((id) => (getValidationCatalog().leaderHeroes.find((h) => h.heroId === id)?.sGeneration ?? 0) >= generation - 2))).toBe(true);
    expect(optimizerRecentHeadEligible(input, { shield: "hero.s1.nataliya", lancer: "hero.s1.moli", marksman: "hero.s1.jinman" })).toBe(false);
  });
  it.each(["s2_fc3", "s11"] as const)("filters R/SR from optimizer and automatic choices at %s", (serverStage) => {
    const input = { ...rallyHeadSearchFixture(), serverStage }; delete input.availableHeroIds;
    for (const id of [...optimizationHeroIds(input), ...visibleOptimizationHeroIds(input)]) expect(getValidationCatalog().leaderHeroes.find((h) => h.heroId === id)?.category).toBe("S");
  });
  it("retains a manual R/SR head in formal preview", () => {
    const input = rallyHeadSearchFixture(), manual = { ...input, sideA: { ...input.sideA, leaderHeroIds: { shield: "hero.r.youjin", lancer: "hero.sr.patelike", marksman: "hero.body.shuyun" } } };
    expect(createValidationPreviewState(manual).sideA.heroStates.map((h) => h.heroId)).toContain("hero.r.youjin");
  });
  it("ignores unowned higher generations when computing n", () => {
    const input = { ...rallyHeadSearchFixture(), ownedHeroIds: ["hero.s8.hengdelike"], availableHeroIds: ["hero.s8.hengdelike", "hero.s11.rufus"] };
    expect(optimizerGeneration(input)).toBe(8);
  });
  it("ignores a disabled higher generation in the optimization pool", () => {
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: ["hero.s8.hengdelike", "hero.s11.rufus"], optimizerHeroPool: { A: {
      "hero.s8.hengdelike": { enabled: true, weaponLevel: 2 }, "hero.s11.rufus": { enabled: false, weaponLevel: 10 } } } };
    expect(optimizerGeneration(input)).toBe(8);
  });
});
describe("automatic Body policy and manual preservation", () => {
  it("allows four repeated Body runtime instances in manual config", () => {
    const slots = resolveBodySkillConfigs([nora, nora, nora, nora], [], "s11"); expect(slots).toHaveLength(4);
    expect(new Set(slots.map((s) => s.runtimeInstanceId)).size).toBe(4);
  });
  it("keeps an exact manual four-copy body when only ratios are optimized", () => {
    const input = rallyHeadSearchFixture(), constraint = { fixedBodyExact: true, fixedMemberSkillIds: [nora, nora, nora, nora] };
    const pool = enumeratePreprocessedBodyPool(input, constraint, OPPONENT_HEAD, { jointPolicy: true }); expect(pool.rows).toHaveLength(1);
  });
  it("canonicalizes the same effect across different hero IDs", () => {
    expect(canonicalEffectFamily(effect())).toBe(canonicalEffectFamily({ ...effect(), id: "other-id", name: "other name" }));
  });
  it("distinguishes attack from penetration canonical families", () => expect(canonicalEffectFamily(effect())).not.toBe(canonicalEffectFamily(effect("penetration"))));
  it("canonicalizes equivalent fields independently of object insertion order", () => {
    const source = effect(); const reordered = Object.fromEntries(Object.entries(source).reverse()) as unknown as HeroSkillEffect;
    expect(canonicalEffectFamily(source)).toBe(canonicalEffectFamily(reordered));
  });
  it("normalizes omitted all-target/all-damage scopes and the legacy attribute operation label", () => {
    const explicit = effect(), implicit = { ...effect(), scope: { source: "army" as const }, operation: "addToAttribute" as const };
    expect(canonicalEffectFamily(explicit)).toBe(canonicalEffectFamily(implicit));
  });
  it("enforces max two across different identities sharing an effect", () => {
    const definitions = [skill("a"), skill("b"), skill("c", [effect("penetration")])];
    const pool = enumerateBodyCombinations({ sources: definitions.map((s) => ({ heroId: s.heroId, skillId: s.id, effectKey: s.id })), fixedMemberSkillIds: [], fixedBodyExact: false,
      requiredBodyHeroIds: [], allowDuplicateMembers: true, equivalentMemberPositions: true, disabledSkillIds: [], levelForSlot: () => 5 }, { definitions, jointPolicy: true, preprocess: true });
    expect(pool.rows.length).toBeGreaterThan(0); expect(pool.rows.every((r) => r.memberSkillIds.filter((id) => ["a", "b"].includes(id)).length <= 2)).toBe(true);
  });
  it.each([.25, .20])("prunes p*r=.20 against stable %f in the same full family", (stable) => {
    expect(probabilityBodyDominatedBy(createBodySkillSignature(skill("p", [effect("penetration", .5)], .4)), createBodySkillSignature(skill("s", [effect("penetration", stable)])))).toBe(true);
  });
  it("retains probability skill when p*r exceeds stable", () => expect(probabilityBodyDominatedBy(createBodySkillSignature(skill("p", [effect("penetration", .8)], .4)), createBodySkillSignature(skill("s", [effect("penetration", .25)])))).toBe(false));
  it("never prunes attack by a stable penetration skill", () => expect(probabilityBodyDominatedBy(createBodySkillSignature(skill("p", [effect("attack", .5)], .4)), createBodySkillSignature(skill("s", [effect("penetration", .25)])))).toBe(false));
  it("does not discard a multi-effect skill from its first effect alone", () => expect(probabilityBodyDominatedBy(createBodySkillSignature(skill("p", [effect("attack", .5), effect("penetration", 1)], .4)), createBodySkillSignature(skill("s", [effect("attack", .25)])))).toBe(false));
  it("does not compare mismatching recipient scopes", () => expect(probabilityBodyDominatedBy(createBodySkillSignature(skill("p", [{ ...effect(), scope: { source: "shield" } }], .4)), createBodySkillSignature(skill("s")))).toBe(false));
  it("does not compare skills with extra control semantics", () => expect(probabilityBodyDominatedBy(createBodySkillSignature(skill("p", [effect(), { id: "redirect", name: "redirect", recipient: "selfArmy", scope: { source: "army" }, kind: "targetingOverride", priority: ["marksman"] }], .4)), createBodySkillSignature(skill("s")))).toBe(false));
});
describe("direct PDF coefficients and exact reduction expectations", () => {
  const damage = (group: string, value: number): HeroSkillEffect => ({ id: group, name: group,
    recipient: "selfArmy", scope: { source: "army", target: "all" }, kind: "damageIncrease", group, value });
  const reduction = (value: number): Extract<HeroSkillEffect, { kind: "damageReduction" | "damageIncrease" | "outgoingDamageReduction" | "incomingDamageIncrease" }> => ({ id: "red", name: "red", recipient: "selfArmy",
    scope: { source: "army", target: "all" }, kind: "damageReduction", group: "receivedDamageReduction", value });
  it("adds same-group constant damage before multiplying the base", () => {
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([skill("damage", [damage("g", .2), damage("g", .15)])]));
    expect(actual.o[0]! / base.o[0]!).toBeCloseTo(1.35, 12);
  });
  it("multiplies different damage groups", () => {
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([skill("damage", [damage("g", .2), damage("h", .15)])]));
    expect(actual.o[0]! / base.o[0]!).toBeCloseTo(1.2 * 1.15, 12);
  });
  it("adds typed p*r penetration to its own group", () => {
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([skill("proc", [effect("penetration", .5)], .4)]));
    expect(actual.o[0]! / base.o[0]!).toBeCloseTo(1.2, 12);
  });
  it("compiles fixed first-five-round damage with the 20-round standard", () => {
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([skill("early-damage", [{ ...damage("g", .2), lifecycle: { activeRounds: [1, 2, 3, 4, 5] } }])]));
    expect(actual.o[0]! / base.o[0]!).toBeCloseTo(1.05, 12);
  });
  it("does not apply a round interval twice to periodic extra damage", () => {
    const definition = skill("period", [{ id: "extra", name: "extra", recipient: "selfArmy", scope: { source: "army", target: "currentTarget" }, kind: "extraDamage", coefficient: 1, basis: "parentBaseDamage" }]);
    const scheduled = { ...definition, trigger: "beforeAttack" as const, levelValues: { 5: { periodRounds: 5, periodStartRound: 5, effects: definition.levelValues[5]!.effects } } };
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([scheduled])); expect(actual.o[0]! / base.o[0]!).toBeCloseTo(1.2, 12);
  });
  it("uses attack-count interval once for periodic damage", () => {
    const definition = skill("attack-count", [damage("g", 1)]), scheduled = { ...definition, trigger: "beforeAttack" as const,
      actionMechanic: { kind: "attackCountTrigger" as const, schedule: { source: "army" as const, interval: 5, mode: "onCompleted" as const } } };
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([scheduled])); expect(actual.o[0]! / base.o[0]!).toBeCloseTo(1.2, 12);
  });
  it("compiles fixed first-five-round reduction with the 40-round standard", () => {
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([skill("early-red", [{ ...reduction(.2), lifecycle: { activeRounds: [1, 2, 3, 4, 5] } }])]));
    expect(actual.s[0]! / base.s[0]!).toBeCloseTo(1 / (.125 / 1.2 + .875), 12);
  });
  it("combines a stable and a probability reduction in one shared divisor", () => {
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([skill("stable", [reduction(.3)]), skill("prob", [reduction(.2)], .5)]));
    expect(actual.s[0]! / base.s[0]!).toBeCloseTo(1 / (.5 / 1.3 + .5 / 1.5), 12);
  });
  it("keeps normal-only reductions outside incoming skill damage", () => {
    const table = tableWithSkills([skill("normal", [{ ...reduction(.2), group: "receivedNormalAttackReduction" }])]);
    table.incomingNormalShare = .5; const base = coefficient(numericTable().table), actual = coefficient(table);
    expect(actual.s[0]! / base.s[0]!).toBeCloseTo(1 / (.5 / 1.2 + .5), 12);
  });
  it("preserves probability correlation among effects of a single runtime trigger", () => {
    const base = coefficient(numericTable().table), actual = coefficient(tableWithSkills([skill("prob", [reduction(.2), reduction(.3)], .5)]));
    expect(actual.s[0]! / base.s[0]!).toBeCloseTo(1 / (.5 + .5 / 1.5), 12);
  });
  it.each([0, 1, 2])("retains troop damage coefficient and Cn for troop %i", (i) => {
    const { table } = numericTable(), { o } = coefficient(table); expect(o[i]).toBeCloseTo([1, 3, 4][i]! * getTroopConstant(i === 1 ? "T3" : "T11-FC3") * 4, 8);
  });
  it.each([0, 1, 2])("retains HP coefficient, Cn, life and defense for troop %i", (i) => {
    const { table } = numericTable(), { s } = coefficient(table); expect(s[i]).toBeCloseTo([300, 100, 75][i]! * getTroopConstant(i === 1 ? "T3" : "T11-FC3") * 4, 8);
  });
  it("does not cancel Cn in an 11/3/11 composition", () => { const { s, o } = coefficient(numericTable().table); expect(s[1]! / 100).toBeCloseTo(2.1 * 4); expect(o[1]! / 3).toBeCloseTo(2.1 * 4); });
  it("uses inverse expected damage for a single probability reduction", () => {
    expect(expectedIncomingMultiplier(0, [{ probability: .5, value: .2 }])).toBeCloseTo(.5 + .5 / 1.2, 12);
    expect(equivalentReduction(0, [{ probability: .5, value: .2 }])).not.toBeCloseTo(.1, 6);
  });
  it("adds the stable reduction before enumerating proc states", () => expect(expectedIncomingMultiplier(.3, [{ probability: .5, value: .2 }])).toBeCloseTo(.5 / 1.3 + .5 / 1.5, 12));
  it("exactly enumerates two independent probability reductions", () => expect(expectedIncomingMultiplier(0, [{ probability: .5, value: .2 }, { probability: .4, value: .3 }])).toBeCloseTo(.3 + .3 / 1.2 + .2 / 1.3 + .2 / 1.5, 12));
  it("enumerates the 16 states of four independent Body procs", () => {
    const events = [.1, .2, .3, .4].map((value) => ({ probability: .5, value }));
    let manual = 0; for (let mask = 0; mask < 16; mask++) manual += 1 / 16 / (1 + events.reduce((sum, e, i) => sum + (mask & 1 << i ? e.value : 0), 0));
    expect(expectedIncomingMultiplier(0, events)).toBeCloseTo(manual, 12);
  });
  it.each([0, 1])("handles deterministic probability endpoint %i", (probability) => expect(expectedIncomingMultiplier(.2, [{ probability, value: .5 }])).toBeCloseTo(1 / (1.2 + probability * .5), 12));
  it("integrates first-five-round damage at the 20-round horizon", () => expect(roundCoverage({ activeRounds: [1, 2, 3, 4, 5] }, 20)).toBe(.25));
  it("integrates first-five-round reduction at the 40-round horizon", () => {
    const coverage = roundCoverage({ activeRounds: [1, 2, 3, 4, 5] }, 40); expect(coverage).toBe(.125);
    expect(equivalentReduction(0, [{ probability: coverage, value: .2 }])).toBeCloseTo(1 / (.125 / 1.2 + .875) - 1, 12);
  });
  it("uses typed period/duration/phase and delayed activation", () => {
    expect(roundCoverage({ periodRounds: 5, firstActiveRound: 3, activeWindowRounds: 2 }, 20)).toBe(.4);
    expect(roundCoverage({ activationTiming: "nextRound", durationRounds: 5 }, 20)).toBe(.25);
  });
});
describe("global J pruning and bounded local simplex searches", () => {
  it.each([[300, 100, 75], [10, 10, 10], [1, 50, 2]] as const)("finds a reproducible peak beating a 1%% grid for S=%j", (...s) => {
    const o = [1, 3, 4] as const, peak = findRatioPeak(s, o);
    const grid = localRatioGrid({ shield: 50, lancer: 50, marksman: 0 }, 100, 1);
    expect(peak.bestScore).toBeGreaterThanOrEqual(Math.max(...grid.map((r) => ratioObjective(s, o, TROOP_TYPES.map((t) => r[t] / 100)))) * (1 - 1e-8));
    expect(findRatioPeak(s, o)).toEqual(peak);
  });
  it("supports an exact zero-output boundary", () => { const p = findRatioPeak([1, 1, 1], [1, 0, 0]); expect(p.bestRatio).toEqual({ shield: 100, lancer: 0, marksman: 0 }); });
  it("keeps a survival-only zero-output troop on the KKT boundary", () => { const p = findRatioPeak([100, 1, 1], [0, 1, 1]); expect(p.bestRatio.shield).toBeGreaterThan(60); expect(p.bestRatio.lancer).toBeCloseTo(p.bestRatio.marksman, 8); });
  it("streams strict Top10000 from a larger input without per-head slots", () => {
    const heap = new JointPeakHeap(); for (let i = 0; i < 25000; i++) heap.push({ head: i < 15000 ? 0 : 1, body: i, score: i, ratio: { shield: 50, lancer: 0, marksman: 50 } });
    const rows = heap.sorted(); expect(rows).toHaveLength(JOINT_TOP_K); expect(rows.at(-1)!.score).toBe(15000); expect(rows.every((r) => r.head === 1)).toBe(true);
  });
  it("uses fixed HeadKey/BodyKey ID ties independent of encounter order", () => {
    const rows: JointPeakRow[] = [9, 5, 1, 7, 0].map((body) => ({ head: 0, body, score: 10, ratio: { shield: 50, lancer: 0, marksman: 50 } }));
    const a = new JointPeakHeap(3), b = new JointPeakHeap(3); rows.forEach((r) => a.push(r)); [...rows].reverse().forEach((r) => b.push(r));
    expect(a.sorted()).toEqual(b.sorted()); expect(a.sorted().map((r) => r.body)).toEqual([0, 1, 5]);
  });
  it("has identical serial/sharded global J winners", () => {
    const { table } = numericTable(); table.headCount = 2; table.headBase = Float64Array.from([...table.headBase, ...table.headBase]); table.headChannels = new Float64Array(12); table.headFactors = new Float64Array(24).fill(1);
    const serial = scanJointPeaks({ table, headStart: 0, headEnd: 2, shard: 0 });
    const heap = new JointPeakHeap(); [0, 1].forEach((head) => scanJointPeaks({ table, headStart: head, headEnd: head + 1, shard: head }).rows.forEach((r) => heap.push(r)));
    expect(heap.sorted()).toEqual(serial.rows);
  });
  it("uses all three ±10pp limits for 57/3/40", () => {
    const bounds = localRatioBounds({ shield: 57, lancer: 3, marksman: 40 }, 10); expect(bounds).toEqual({ min: [47, 0, 30], max: [67, 13, 50] });
  });
  it("keeps all 5% points on the local lattice without negative troops", () => {
    const grid = localRatioGrid({ shield: 57, lancer: 3, marksman: 40 }, 10, 5); expect(grid.length).toBeGreaterThan(1); expect(grid.length).toBeLessThan(231);
    expect(grid.every((r) => r.shield >= 47 && r.shield <= 67 && r.lancer >= 0 && r.lancer <= 13 && r.marksman >= 30 && r.marksman <= 50 && Object.values(r).every((v) => v % 5 === 0) && Object.values(r).reduce((a, b) => a + b) === 100)).toBe(true);
  });
  it("handles fractional J centers with the globally anchored 5% lattice", () => {
    const rows = localRatioGrid({ shield: 57.123, lancer: 2.456, marksman: 40.421 }, 10, 5); expect(rows.length).toBeGreaterThan(0); expect(rows.every((r) => Object.values(r).every((v) => v % 5 === 0))).toBe(true);
  });
  it("restricts the 1% grid to both Criterion neighborhood and J domain", () => {
    const outer = localRatioBounds({ shield: 57, lancer: 3, marksman: 40 }, 10), rows = localRatioGrid({ shield: 60, lancer: 0, marksman: 40 }, 5, 1, outer);
    expect(rows.every((r) => r.shield >= 55 && r.shield <= 65 && r.lancer >= 0 && r.lancer <= 5 && r.marksman >= 35 && r.marksman <= 45)).toBe(true);
    expect(rows.some((r) => r.shield === 100)).toBe(false);
  });
  it("uses cumulative 20/50/100/300 and five optimizer finalists by default", () => expect(resolveJointPipelineOptions().formalStages).toEqual([{ trials: 20, keep: 80 }, { trials: 50, keep: 30 }, { trials: 100, keep: 15 }, { trials: 300, keep: 5 }]));
  it("rejects a noncumulative formal schedule", () => expect(() => resolveJointPipelineOptions({ formalStages: [{ trials: 5, keep: 1 }] })).toThrow());
});
describe("formal evidence, full recommendation DTO and progress", () => {
  const input = rallyHeadSearchFixture(), config = { ...defaultOptimizationConfig(19),  objectiveMode: "singleWin" as const, profiling: true,
    constraints: { ...emptyBody, fixedLeaders: OPPONENT_HEAD }, theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 1 },
    jointPipeline: { criterionKeep: 1, theoryKeep: 1, formalStages: [{ trials: 20, keep: 1 }, { trials: 50, keep: 1 }, { trials: 100, keep: 1 }, { trials: 300, keep: 1 }] } };
  const dispatched: EvaluationJob[] = [], progress: string[] = [], execute = createEvaluationExecutor();
  const profiler = new OptimizerProfiler((p) => progress.push(p.stage));
  const workflow = createPeakJointWorkflow(input, config, profiler.progress, profiler);
  const result = runOptimizationWorkflow(profileOptimizationWorkflow(workflow, profiler), (job): EvaluationJobResult => {
    if (job.kind !== "battle") return execute(job);
    dispatched.push(job);
    const ratio = job.rallyCandidate!.ratios;
    const outcomes = job.seeds.map(() => ({ outcome: "A", roundCount: 12, remaining: {
      A: { shield: ratio.shield, lancer: ratio.lancer, marksman: ratio.marksman * 10 }, B: { shield: 0, lancer: 0, marksman: 0 } } } as FastBattleResult));
    return { samples: { trials: outcomes.length, requestedTrials: outcomes.length, wins: outcomes.length, losses: 0, failedTrials: 0, pruned: false, outcomes },
      performance: { simulatedTrials: outcomes.length, skippedTrials: 0, prunedCandidates: 0, templateBuilds: 1, templateHits: 0 }, timing: { battleCount: outcomes.length, battleElapsedMs: 1 } };
  });
  it("dispatches real battle jobs from Formal onward", () => expect(dispatched.every((j) => j.kind === "battle" && j.collectOutcomes && j.rallyCandidate)).toBe(true));
  it("reuses 20→50→100 seed prefixes incrementally", () => expect(dispatched.slice(0, 3).map((j) => j.seeds.length)).toEqual([20, 30, 50]));
  it("reviews integer ratio neighbors using formal samples", () => expect(result.searchDiagnostics.jointPipeline!.formalRatioCandidates).toBeGreaterThan(1));
  it("uses formal local comparison to advance a changed ratio", () => {
    const initial = dispatched[0]!.rallyCandidate!, selected = result.top[0]!.candidate; expect(selected.ratios.marksman).toBeGreaterThan(initial.ratios.marksman);
  });
  it("reuses 300 samples in a final 1000 common-seed verification", () => {
    const row = result.searchDiagnostics.searchIntegrityReport!.perStage.at(-1)!; expect(row.reusedBattles).toBeGreaterThanOrEqual(300);
    expect(result.top.every((r) => r.trials === 1000)).toBe(true);
    const topJobs = dispatched.filter((j) => candidateKey(j.rallyCandidate!) === candidateKey(result.top[0]!.candidate));
    expect(new Set(topJobs.flatMap((j) => j.seeds)).size).toBe(1000);
  });
  it("uses the same final seeds for comparisons and optimization finalists", () => {
    const seeds = adaptiveSeedPools(19, 300, 1000).final;
    const grouped = new Map<string, number[]>(); for (const j of dispatched) { const key = candidateKey(j.rallyCandidate!); grouped.set(key, [...(grouped.get(key) ?? []), ...j.seeds]); }
    for (const row of result.top) expect(new Set(grouped.get(candidateKey(row.candidate)))).toEqual(new Set(seeds));
  });
  it("keeps baseline independent of the J/criterion/theory slots", () => {
    const a = result.searchDiagnostics.jointPipeline!; expect(a.peak.retainedCount).toBe(1); expect(a.criterionPairs).toBe(1); expect(a.formalPairs).toBe(1); expect(a.comparisonCandidates).toBe(1);
  });
  it("emits each player-visible stage and no stale C0-C3 labels", () => {
    for (const name of ["H0", "B0", "J Preparation", "J Peak", "Recall Merge", "Criterion", "Theory", "Formal 20", "Formal 50", "Formal 100", "Formal 300", "Final 1000"]) expect(progress.some((p) => p.startsWith(name))).toBe(true);
  });
  it("displays three Head names and actual fixed weapon levels", () => expect(rallyRecommendationDetails(result.top[0]!.candidate, [])).toMatch(/车头：.*专武 Lv0.*专武 Lv0.*专武 Lv0/));
  it("compresses Body names while retaining all four independent slots", () => {
    const text = compressedRallyBodyNames([nora, nora, wuming, wuming]); expect(text).toMatch(/×2.*\/.*×2/);
    expect(resolveBodySkillConfigs([nora, nora, wuming, wuming], [], "s11")).toHaveLength(4);
  });
  it("displays Body, tiers and ratios on a recommendation card", () => {
    const html = rallyRecommendationDetails({ ...result.top[0]!.candidate, memberSkillIds: [nora, nora, wuming, wuming] }, []);
    expect(html).toContain("车身："); expect(html).toContain("兵阶（盾 / 矛 / 射）"); expect(html).toContain("配比（盾 / 矛 / 射）");
  });
  it("applies Head/Weapon/Body/Ratio/Tiers/levels fully to canonical config", () => {
    const candidate = { ...result.top[0]!.candidate, memberSkillIds: [nora, nora, wuming, wuming], bodySkillLevels: [5, 4, 3, 2],
      troopLevels: { shield: "T11-FC3", lancer: "T3", marksman: "T11-FC3" }, headWeaponLevels: Object.fromEntries(Object.values(OPPONENT_HEAD).map((id) => [id, 7])) };
    const mapped = candidateToInput(input, candidate); expect(mapped.sideA.leaderHeroIds).toEqual(OPPONENT_HEAD);
    expect(mapped.sideA.simulationWeaponLevels).toMatchObject(candidate.headWeaponLevels); expect(mapped.sideA.bodySkills!.map((b) => b.skillLevel)).toEqual([5, 4, 3, 2]);
    expect(new Set(mapped.sideA.bodySkills!.map((b) => b.runtimeInstanceId)).size).toBe(4); expect(mapped.sideA.rallyDeployment!.ratios).toEqual(candidate.ratios);
    expect(TROOP_TYPES.map((t) => mapped.sideA.troops[t].troopLevel)).toEqual(["T11-FC3", "T3", "T11-FC3"]); expect(mapped.sideB).toBe(input.sideB);
  });
  it("persists the new flag and configurable stage cuts", () => {
    const restored = restorePersistedConfig(createPersistedEnvelope(input, 1000, config)); expect(restored.optimizationConfig).not.toHaveProperty("useSimpleRatioPrior");
    expect(restored.optimizationConfig.jointPipeline?.criterionKeep).toBe(1);
  });
  it("shows stage/count/percent/elapsed/ETA/total without exposing raw config", () => {
    let time = 0; const p = new OptimizerProfiler(undefined, () => time); p.begin("J · 峰值搜索", 100); time = 5000;
    p.progress({ stage: "J · 峰值搜索", completed: 50, total: 100 });
    const text = playerOptimizationProgress({ stage: "J · 峰值搜索", completed: 50, total: 100 }, p.snapshot());
    expect(text).toContain("50 / 100 · 50.0%"); for (const label of ["阶段已用", "预计剩余", "总已用"]) expect(text).toContain(label);
  });
  it("keeps no fake ETA when no completed work is available", () => expect(playerOptimizationProgress({ stage: "H0", completed: 0, total: 0 }, null)).toContain("估算中"));
  it("keeps formal engine modules outside the pipeline dependency's edits", () => {
    const source = readFileSync(new URL("../optimizer/jointPipeline/workflow.ts", import.meta.url), "utf8");
    expect(source).toContain("BattleSampleLedger"); expect(source).not.toMatch(/Math\.random|createSeededRandomSource/);
  });
});
