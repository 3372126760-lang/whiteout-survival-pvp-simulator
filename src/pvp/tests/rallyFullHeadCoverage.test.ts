import { describe, expect, it } from "vitest";
import { defaultOptimizationConfig, searchSingleWave, availableHeadHeroesByTroop } from "../optimizer";
import { getValidationCatalog } from "../validationUi";
import { rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

const budgets = { criterionKeep: 16, criterionFineKeep: 8, theoryKeep: 4, formalRatioKeep: 2,
  formalStages: [{ trials: 20, keep: 4 }, { trials: 50, keep: 3 }, { trials: 100, keep: 2 }, { trials: 300, keep: 1 }] };
const trial = () => ({ outcome: "B" as const, self: { shield: 1, lancer: 0, marksman: 0 },
  enemy: { shield: 10, lancer: 0, marksman: 0 }, rounds: 1 });

describe("joint peak coverage and bounded formal promotion", () => {
  it("scans every recent-eligible S16 Head and recalls at least one Body per Head before global Criterion cuts", () => {
    const base = rallyHeadSearchFixture(), catalog = getValidationCatalog();
    const pool = (troop: "shield" | "lancer" | "marksman", count: number) => catalog.leaderHeroes
      .filter((hero) => hero.troopType === troop && hero.category === "S").sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0)).slice(0, count).map((hero) => hero.heroId);
    const input = { ...base, serverStage: "s16" as const, maxRounds: 1,
      sideA: { ...base.sideA, leaderHeroIds: { shield: pool("shield", 1)[0]!, lancer: pool("lancer", 1)[0]!, marksman: pool("marksman", 1)[0]! } },
      availableHeroIds: [...pool("shield", 15), ...pool("lancer", 16), ...pool("marksman", 16)] };
    const choices = availableHeadHeroesByTroop(input, {}), all = choices.shield.length * choices.lancer.length * choices.marksman.length;
    const old = [choices.shield, choices.lancer, choices.marksman].map((ids) => ids.filter((id) => (catalog.leaderHeroes.find((h) => h.heroId === id)?.generation ?? 0) < 14).length);
    const expected = all - old.reduce((n, count) => n * count, 1);
    const result = searchSingleWave(input, { ...defaultOptimizationConfig(17), objectiveMode: "singleWin",
      constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] }, jointPipeline: budgets,
      theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 1 } }, undefined,
    (candidate, seeds) => { expect(Object.values(candidate.leaderHeroIds).every((id) => id === null || input.availableHeroIds.includes(id!))).toBe(true); return seeds.map(trial); });
    const joint = result.searchDiagnostics.jointPipeline!;
    expect(joint.peak).toMatchObject({ headCount: expected, bodyCount: 1, evaluatedHeadBodyCount: expected });
    expect(joint.recallAudit).toMatchObject({ perHeadProtectedK: 1, perHeadRawCount: expected, perHeadUniqueCount: expected, mergedRecallCount: expected });
    expect(joint.formalPairs).toBeLessThanOrEqual(4);
    expect(result.searchDiagnostics.evaluatedUniqueHeadCandidateCount).toBeLessThanOrEqual(expected);
    expect(result.searchDiagnostics.headCoverageRate).toBeLessThanOrEqual(100);
  }, 30000);
  it("reports Body alternatives separately and never counts a protected old Head as an auto-search visit", () => {
    const input = { ...rallyHeadSearchFixture(), rallyBodyPoolIds: ["hero.body.shuyun", "hero.body.jiexi", "hero.sr.patelike", "hero.sr.xieergai"] };
    const result = searchSingleWave(input, { ...defaultOptimizationConfig(9), objectiveMode: "singleWin", constraints: {}, jointPipeline: budgets,
      theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 1 } }, undefined, (_candidate, seeds) => seeds.map(trial));
    expect(result.searchDiagnostics.legalHeadCandidateCount).toBe(7);
    expect(result.searchDiagnostics.evaluatedUniqueHeadCandidateCount).toBeLessThanOrEqual(7);
    expect(result.searchDiagnostics.availableBodyCandidateCount).toBeGreaterThan(1);
    const peak = result.searchDiagnostics.jointPipeline!.peak;
    expect(peak.evaluatedHeadBodyCount).toBe(7 * peak.bodyCount);
    expect(result.searchDiagnostics.jointPipeline!.recallAudit!.perHeadRawCount).toBe(7);
    expect(result.current.candidate.recalledBy).toContain("currentConfig");
  });
});
