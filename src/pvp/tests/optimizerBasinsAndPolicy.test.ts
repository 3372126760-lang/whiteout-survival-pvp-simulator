import { describe, it, expect, vi } from "vitest";
import { buildHeroPoolAudit, compareHeroDominance, deriveHeroEffectSignature, optimizerRarityAllowed,
  recentGenerations, satisfiesRecentGeneration, type HeroEffectSignature } from "../optimizer/heroSearchPolicy";
import { generateAllHeadFormations, generateBodyFormations } from "../optimizer/candidateGenerator";
import { DEFAULT_BASIN_SEARCH, emptyRatioSearchAudit, fineRatioWindow, searchRatioBasins } from "../optimizer/basinSearch";
import { defaultOptimizationConfig, searchSingleWave } from "../optimizer";
import { createTheoryTemplateBuilder, defaultTheoryOptions, estimateDeterministicBattle,
  nextRoundExpectedOutput, type TheoryTemplate } from "../optimizer/theory";
import { createExpectationProgram, damageDependencyPolicy } from "../optimizer/theory/expectationProgram";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS } from "../troopSkills";
import { createValidationPreviewState, getValidationCatalog, type RallyTroopRatios } from "../validationUi";
import { rallyHeadSearchFixture, opponentCandidate } from "./fixtures/rallyHeadSearch";
import type { TROOP_TYPES } from "../types";

describe("optimizer-only hero policy and conservative proof", () => {
  it("excludes R/SR from automatic head search at every generation", () => {
    for (const rarity of ["R", "SR"]) {
      expect(optimizerRarityAllowed({ rarity }, 1)).toBe(false);
      expect(optimizerRarityAllowed({ rarity }, 2)).toBe(false);
      expect(optimizerRarityAllowed({ rarity }, 3)).toBe(false);
      expect(optimizerRarityAllowed({ rarity, generation: 4 }, 11)).toBe(false);
      expect(optimizerRarityAllowed({ rarity, generation: 3 }, 11)).toBe(false);
      expect(optimizerRarityAllowed({ rarity, generation: null }, 11)).toBe(false);
    }
    expect(optimizerRarityAllowed({ rarity: "SSR", generation: 4 }, 11)).toBe(true);
    expect(recentGenerations(1)).toEqual([1]); expect(recentGenerations(2)).toEqual([1, 2]);
    const heroes = [{ heroId: "looks-like-s11", troopType: "shield" as const, rarity: "SSR", generation: null },
      { heroId: "recent", troopType: "lancer" as const, rarity: "SSR", generation: 9 }];
    expect(satisfiesRecentGeneration({ shield: "looks-like-s11" }, 11, heroes)).toBe(false);
    expect(satisfiesRecentGeneration({ shield: "looks-like-s11", lancer: "recent" }, 11, heroes)).toBe(true);
  });
  it("retains older heroes inside a recent-containing head and removes old-only heads",()=>{
    const input=rallyHeadSearchFixture(),rows=generateAllHeadFormations(input,{fixedBodyExact:true,fixedMemberSkillIds:[]});
    expect(rows).toHaveLength(7);
    expect(rows.every((row)=>satisfiesRecentGeneration(row.leaderHeroIds,11))).toBe(true);
    expect(rows.some((row)=>Object.values(row.leaderHeroIds).some((id)=>id?.startsWith("hero.s1.")))).toBe(true);
    const catalog=getValidationCatalog(),audit=buildHeroPoolAudit(input,catalog.leaderHeroes.filter((h)=>(h.generation??1)<=11));
    expect(audit.rarityFilteredHeroes).toHaveLength(13); // All R/SR are independent categories excluded from S3+ head search.
    expect(audit.counts.afterRecentCombinations).toBeLessThan(audit.counts.afterRarityCombinations);
    expect(audit.exclusions.some((e)=>e.exclusionReason==="rarityRule")).toBe(true);
    expect(audit.exclusions.some((e)=>e.exclusionReason==="recentGenerationRule")).toBe(true);
    expect(audit.optimizerHeroPoolAfterFilter.some((h)=>h.rarity==="SR")).toBe(false);
  });
  it("searches teammate body heroes independently of the head's owned pool",()=>{
    const input={...rallyHeadSearchFixture(),rallyBodyPoolIds:["hero.body.shuyun","hero.s5.nuola"]};
    const skill="hero-skill.shuyun.attack",rows=generateBodyFormations(input,{},input.sideB.leaderHeroIds!);
    expect(rows).toHaveLength(6);expect(rows.every((row)=>row.memberSkillIds.filter((id)=>id===skill).length===2)).toBe(true);
    expect(input.availableHeroIds).not.toContain("hero.body.shuyun");
  });
  const signature = (id: string, values: readonly number[]): HeroEffectSignature => ({ heroId: id, troopType: "shield",
    complete: true, proofBarriers: [], conditions: "same external/weapon/static conditions",
    effects: values.map((value, i) => ({ semantic: `complete-passive-effect-${i}`, value, probability: 1 })) });
  it("requires a complete semantic proof, not a generation or one copied skill", () => {
    expect(compareHeroDominance(signature("s1", [.1, .2, .3]), signature("s16", [.1, .2, .3])).status).toBe("nonDominated");
    expect(compareHeroDominance(signature("old", [.1, .2, .3]), signature("new", [.1, .25, .1])).status).toBe("nonDominated");
    const relation = compareHeroDominance(signature("old", [.1, .2, .3]), signature("new", [.1, .25, .3]));
    expect(relation.status).toBe("strictlyDominated"); expect(relation.comparedEffects).toHaveLength(3);
    expect(compareHeroDominance(signature("old", [.1, .2, .3]), { ...signature("new", [.1, .25, .3]),
      proofBarriers: ["dodge/target redirect"] }).status).toBe("nonDominated");
    expect(compareHeroDominance(signature("old", [.1, .2, .3]), { ...signature("new", [.1, .25, .3]), conditions: "different weapons" }).status).toBe("likelyDominated");
    expect(deriveHeroEffectSignature("hero.s8.jiatuo").proofBarriers.length).toBeGreaterThan(0);
    const audit = buildHeroPoolAudit(rallyHeadSearchFixture(), getValidationCatalog().leaderHeroes);
    expect(audit.dominanceRelations.filter((row) => row.status === "strictlyDominated")).toHaveLength(0);
  });
});

describe("formal multiple-basin ratio refinement", () => {
  it("continues 5% climbs, then searches multiple bounded 1% windows reproducibly", () => {
    interface C { head: string; ratios: RallyTroopRatios; fine?: boolean; }
    interface E { candidate: C; score: number; }
    const seeds: E[] = [
      { candidate: { head: "one", ratios: { shield: 10, lancer: 20, marksman: 70 } }, score: -900 },
      { candidate: { head: "two", ratios: { shield: 70, lancer: 10, marksman: 20 } }, score: -900 },
    ];
    const evaluate = (candidate: C): E => ({ candidate,
      score: -((candidate.ratios.shield - (candidate.head === "one" ? 40 : 50)) ** 2) - (candidate.ratios.lancer - 20) ** 2 });
    const run = () => {
      const audit = emptyRatioSearchAudit();
      const workflow = searchRatioBasins(seeds, { candidate: (row) => row.candidate, ratios: (c) => c.ratios,
        head: (c) => c.head, key: (c) => `${c.head}:${Object.values(c.ratios).join("/")}`,
        child: (c, ratios, fine) => ({ ...c, ratios, fine }), compare: (a, b) => b.score - a.score,
        evaluate: function* (candidates) { yield []; return candidates.map(evaluate); },
      }, { ...DEFAULT_BASIN_SEARCH, maxClimbRounds: 8 }, audit);
      let result = workflow.next(); while (!result.done) result = workflow.next([]);
      return { result: result.value, audit };
    };
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("unseeded"); });
    try {
      const first = run(); expect(run()).toEqual(first);
      expect(first.audit.basins[0]!.centers.length).toBeGreaterThan(3);
      expect(first.audit.basins[0]!.fineCenter?.shield).toBe(40);
      expect(first.audit.fineBasinCount).toBe(2); expect(first.audit.fineHeroLineupCount).toBe(2);
      expect(first.result.fine.some((c) => c.ratios.shield === 39 && c.ratios.lancer === 21)).toBe(true);
      expect(first.result.fine.length).toBeLessThan(300);
      expect(random).not.toHaveBeenCalled();
    } finally { random.mockRestore(); }
    expect(fineRatioWindow({ shield: 25, lancer: 20, marksman: 55 }, 5)).toHaveLength(121);
  });
  it("M1 ratios can move; final formal samples overrule theory and retain the manual reference", () => {
    const config = { ...defaultOptimizationConfig(71), objectiveMode: "singleWin" as const,
      constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] }, protectedCandidates: [opponentCandidate()],
      monteCarloStages: [{ trials: 2, keep: 100 }, { trials: 3, keep: 100 }, { trials: 4, keep: 12 }, { trials: 5, keep: 4 }],
      verificationTrials: 11, verificationTop: 2, topN: 2,
      basinSearch: { maxClimbRounds: 2, maxBasins: 3, fineBasins: 3, fineRadius: 2 } };
    const run = () => searchSingleWave({ ...rallyHeadSearchFixture(), maxRounds: 1 }, config, undefined, (candidate, seeds) => seeds.map(() => ({
      outcome: "A" as const, rounds: 1, self: { shield: 10000 - (candidate.ratios.shield - 47) ** 2 - (candidate.ratios.lancer - 18) ** 2,
        lancer: 0, marksman: 0 }, enemy: { shield: 0, lancer: 0, marksman: 0 } })));
    const result = run(); expect(run().top).toEqual(result.top);
    expect(result.searchDiagnostics.jointPipeline?.formalRatio?.lineupCount).toBeGreaterThan(0);
    expect(result.searchDiagnostics.jointPipeline?.formalRatio?.generatedRatioCount).toBeGreaterThan(0);
    expect(result.top.every((row) => row.trials === 1000)).toBe(true);
    expect(result.top.some((row) => row.candidate.formalBestRatio !== undefined)).toBe(true);
    expect(result.searchDiagnostics.jointPipeline?.recallAudit?.finalistRecallSources.some((row) => row.recalledBy.includes("protectedReference"))).toBe(true);
  });
});

describe("target-related expected next-round output", () => {
  it("25% remaining troops preserve 50% output with unchanged targets/conditions", () => {
    const side = { total: 300, counts: [100, 100, 100], hp: [100,100,100], ehp: [100,100,100],
      damage: [1,2,3,4,5,6,7,8,9], normalDamage: [1,2,3,4,5,6,7,8,9], priorities: [[0,1,2],[0,1,2],[0,1,2]], uncertainty: 0 };
    const template: TheoryTemplate = { sideA: side, sideB: side, targetSide: "A", maxRounds: 1, probabilityEquivalents: [], omittedMechanisms: [] };
    const full = nextRoundExpectedOutput(template, [[100,100,100],[100,100,100]], Math.sqrt(300));
    const quarter = nextRoundExpectedOutput(template, [[25,25,25],[100,100,100]], Math.sqrt(300));
    expect(quarter.total[0] / full.total[0]).toBeCloseTo(.5, 12);
    expect(quarter.matrix[0]).toHaveLength(9); expect(quarter.matrix[0][3]).not.toBe(quarter.matrix[0][5]);
  });
  function program(heroes: Readonly<Partial<Record<typeof TROOP_TYPES[number], string>>>, keep: readonly string[]) {
    const base = rallyHeadSearchFixture();
    const input = { ...base, maxRounds: 12, sideA: { ...base.sideA, leaderHeroIds: heroes },
      sideB: { ...base.sideB, leaderHeroIds: {} },
      disabledSkillIds: [...CONFIRMED_HERO_SKILL_DEFINITIONS, ...CONFIRMED_TROOP_SKILL_DEFINITIONS].map((skill) => skill.id).filter((id) => !keep.includes(id)) };
    const state = createValidationPreviewState(input);
    return createExpectationProgram(state, defaultTheoryOptions(), new Set(input.disabledSkillIds));
  }
  it("splits ambush into target-specific 80/20 damage branches", () => {
    const p = program({}, ["lancer-ambush"]), runtime = p.createRuntime();
    const row = p.runRound(1, [[0,100,0],[100,100,100]], Math.sqrt(300), runtime);
    expect(row.damage[1]![0]).toBeCloseTo(.8 * row.output.matrix[0][3]!, 10);
    expect(row.damage[1]![2]).toBeCloseTo(.2 * row.output.matrix[0][5]!, 10);
    expect(row.damage[1]![1]).toBe(0);
  });
  it("uses actual fifth attacks and next-round two-round duration, never a per-round average", () => {
    const p = program({ shield: "hero.s11.eleonora" }, ["hero-skill.eleonora.soaring-flame"]), runtime = p.createRuntime();
    const outputs: number[] = [];
    for (let round = 1; round <= 8; round++) outputs.push(p.runRound(round, [[100,0,0],[100,0,0]], 10, runtime).output.total[0]);
    expect(outputs[4]).toBeCloseTo(outputs[0]!, 10);
    expect(outputs[5]).toBeGreaterThan(outputs[4]!); expect(outputs[6]).toBeCloseTo(outputs[5]!, 10);
    expect(outputs[7]).toBeCloseTo(outputs[0]!, 10); expect(runtime.counts[0]![0]).toBe(8);
  });
  it("distinguishes attack-attempt extra damage from successful-hit extra damage", () => {
    const freya = CONFIRMED_HERO_SKILL_DEFINITIONS.find((skill) => skill.id === "hero-skill.freya.crescent-scythe")!;
    const reina = CONFIRMED_HERO_SKILL_DEFINITIONS.find((skill) => skill.id === "hero-skill.lingnai.shadow-blade")!;
    expect(damageDependencyPolicy(freya).requiresMainHit).toBe(true);
    expect(damageDependencyPolicy(reina).affectedByDodge).toBe(false);
    const base = rallyHeadSearchFixture();
    const keep = [reina.id, "hero-skill.lingnai.swift-shadow-dance"];
    const input = { ...base, sideA: { ...base.sideA, leaderHeroIds: { lancer: "hero.s4.lingnai" } },
      sideB: { ...base.sideB, leaderHeroIds: { lancer: "hero.s4.lingnai" } },
      disabledSkillIds: [...CONFIRMED_HERO_SKILL_DEFINITIONS, ...CONFIRMED_TROOP_SKILL_DEFINITIONS].map((s) => s.id).filter((id) => !keep.includes(id)) };
    const p = createExpectationProgram(createValidationPreviewState(input), defaultTheoryOptions(), new Set(input.disabledSkillIds));
    const row = p.runRound(1, [[0,100,0],[100,0,0]], 10, p.createRuntime());
    const noDodgeInput = { ...input, disabledSkillIds: [...input.disabledSkillIds, "hero-skill.lingnai.swift-shadow-dance"] };
    const noDodge = createExpectationProgram(createValidationPreviewState(noDodgeInput), defaultTheoryOptions(), new Set(noDodgeInput.disabledSkillIds));
    const full = noDodge.runRound(1, [[0,100,0],[100,0,0]], 10, noDodge.createRuntime());
    expect(row.output.total[0]).toBeGreaterThan(.8 * full.output.total[0]);
    expect(row.output.total[0]).toBeLessThan(full.output.total[0]);
  });
  it("uses the numeric critical expectation and applies next-round Gatot shields before HP losses", () => {
    const critical = program({ shield: "hero.s10.gregory" }, ["hero-skill.gregory.steel-phalanx"]);
    const normal = program({ shield: "hero.s10.gregory" }, []);
    const counts = [[100,0,0],[100,0,0]];
    const c = critical.runRound(1, counts, 10, critical.createRuntime());
    const plain = normal.runRound(1, counts, 10, normal.createRuntime());
    expect(c.output.total[0] / plain.output.total[0]).toBeCloseTo(1.25, 10);
    const shield = program({ shield: "hero.s8.jiatuo" }, ["hero-skill.jiatuo.kings-gift"]), runtime = shield.createRuntime();
    const one = shield.runRound(1, counts, 10, runtime), two = shield.runRound(2, counts, 10, runtime);
    expect(two.damage[0]![0]).toBeLessThan(one.damage[0]![0]!);
    expect(runtime.shields.some((layer) => layer.start === 3)).toBe(true);
  });
  it("resolves explicit multi-target extras even when the main attack targets a shield", () => {
    const p = program({ marksman: "hero.s10.blanchette" }, ["hero-skill.blanchette.dawn-sniper"]), runtime = p.createRuntime();
    p.runRound(1, [[0,0,100],[100,100,100]], 10, runtime);
    const second = p.runRound(2, [[0,0,100],[100,100,100]], 10, runtime);
    expect(second.damage[1]![0]).toBeGreaterThan(0);
    expect(second.damage[1]![1]).toBeGreaterThan(0); expect(second.damage[1]![2]).toBeGreaterThan(0);
  });
  it("cached round plans produce the same result regardless of ratio scan order", () => {
    const input = { ...rallyHeadSearchFixture(), maxRounds: 5 };
    const builder = createTheoryTemplateBuilder(defaultTheoryOptions());
    const first = builder(input), second = builder(input);
    const ratios = [[50,20,30], [15,35,50], [100,0,0]];
    const expected = ratios.map((ratio) => estimateDeterministicBattle(first, ratio));
    const reversed = [...ratios].reverse().map((ratio) => estimateDeterministicBattle(second, ratio)).reverse();
    expect(reversed).toEqual(expected);
  });
  it("keeps float casualties and reports matrix/retention without inventing a win rate", () => {
    const input = { ...rallyHeadSearchFixture(), maxRounds: 2 };
    const template = createTheoryTemplateBuilder(defaultTheoryOptions())(input);
    const result = estimateDeterministicBattle(template, [50.01,19.99,30]);
    expect(result.counts.flat().some((n) => n > 0 && !Number.isInteger(n))).toBe(true);
    expect(result.outputMatrix[0]).toHaveLength(9); expect(result.outputRetention).toHaveLength(2);
    expect(result).not.toHaveProperty("winRate");
  });
});
