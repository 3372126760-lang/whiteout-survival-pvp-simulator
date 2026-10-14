import { describe, expect, it } from "vitest";
import { defaultOptimizationConfig } from "../optimizer";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { optimizationTargetLabel, rallyOptimizationSide, updateRallyOptimizationSide } from "../../ui/optimizationTarget";
const aHead = { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" };
const bHead = { shield: "hero.s10.gregory", lancer: "hero.s3.miya", marksman: "hero.s10.freise" };
const aBody = ["hero-skill.shuyun.attack", "hero-skill.jiexi.penetration"];
const bBody = ["hero-skill.wuming.wind-shelter", "hero-skill.nuola.multi-troop-combat", "hero-skill.shuyun.attack", "hero-skill.jiexi.penetration"];
const fixture = () => {
  const base = createDefaultValidationInput();
  return { ...base, scenarioType: "RALLY" as const, battleContext: "rally" as const,
    sideA: { ...base.sideA, leaderHeroIds: aHead, selectedMemberSkillIds: aBody },
    sideB: { ...base.sideB, leaderHeroIds: bHead, selectedMemberSkillIds: ["stale"],
      bodySkills: bBody.map((skillId, slot) => ({ heroId: `test-${slot}`, skillId, expeditionSkillSlot: 1 as const, skillLevel: 5 })) } };
};
describe("optimizer candidate target UI semantics", () => {
  it("defaults old rally configurations to A and uses role-free single A/B labels", () => {
    expect(rallyOptimizationSide(defaultOptimizationConfig(88))).toBe("A");
    expect(optimizationTargetLabel("SINGLE", "A")).toBe("A方");
    expect(optimizationTargetLabel("SINGLE", "B")).toBe("B方");
    expect(optimizationTargetLabel("THREE_THREE_THREE", "B")).toBe("B方");
    expect(optimizationTargetLabel("RALLY", "A")).toBe("集结进攻方");
    expect(optimizationTargetLabel("RALLY", "B")).toBe("集结防守方");
  });
  it("migrates both current locks to B, clears side-specific protected candidates and keeps effort settings", () => {
    const input = fixture(), config = { ...defaultOptimizationConfig(89), objectiveMode: "minRallies" as const,
      constraints: { fixedLeaders: aHead, fixedBodyExact: true, fixedMemberSkillIds: aBody,
        forbiddenHeroIds: ["forbidden"], minGeneration: 3 }, protectedCandidates: [{ leaderHeroIds: aHead, memberSkillIds: aBody,
        ratios: { shield: 50, lancer: 20, marksman: 30 } }] };
    const before = JSON.stringify({ input, config }), next = updateRallyOptimizationSide(input, config, "B");
    expect(next).toMatchObject({ candidateSide: "B", objectiveMode: "singleWin", constraints: {
      fixedLeaders: bHead, fixedBodyExact: true, fixedMemberSkillIds: bBody, forbiddenHeroIds: ["forbidden"], minGeneration: 3 } });
    expect(next.protectedCandidates).toBeUndefined();
    expect(next.stages).toBe(config.stages); expect(next.criterion).toBe(config.criterion); expect(next.firstSeed).toBe(89);
    expect(JSON.stringify({ input, config })).toBe(before);
    const back = updateRallyOptimizationSide(input, next, "A");
    expect(back.constraints.fixedLeaders).toEqual(aHead); expect(back.constraints.fixedMemberSkillIds).toEqual(aBody);
  });
  it("does not create locks when switching an unlocked configuration", () => {
    const config = defaultOptimizationConfig(90), next = updateRallyOptimizationSide(fixture(), config, "B");
    expect(next.constraints.fixedLeaders).toBeUndefined(); expect(next.constraints.fixedMemberSkillIds).toBeUndefined();
    expect(next.constraints).toEqual(config.constraints);
  });
  it("keeps partial locked roles and body prefix length while taking their values from the new side", () => {
    const config = { ...defaultOptimizationConfig(91), constraints: { fixedLeaders: { marksman: aHead.marksman },
      fixedMemberSkillIds: aBody.slice(0, 1) } };
    const next = updateRallyOptimizationSide(fixture(), config, "B");
    expect(next.constraints.fixedLeaders).toEqual({ marksman: bHead.marksman });
    expect(next.constraints.fixedMemberSkillIds).toEqual(bBody.slice(0, 1));
  });
  it("returns the same object for an unchanged side and corrects unsafe B objective modes", () => {
    const config = defaultOptimizationConfig(92);
    expect(updateRallyOptimizationSide(fixture(), config, "A")).toBe(config);
    const unsafe = { ...config, candidateSide: "B" as const, objectiveMode: "auto" as const };
    expect(updateRallyOptimizationSide(fixture(), unsafe, "B").objectiveMode).toBe("singleWin");
  });
});
