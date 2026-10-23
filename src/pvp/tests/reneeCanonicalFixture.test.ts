import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readReneeFixture } from "../../../scripts/benchmark-renee-stacking";
import { compileValidationBattle, runValidationBattleCore, toEngineScenario } from "../validationUi";
import { generateAllHeadFormations } from "../optimizer/candidateGenerator";
import { jointHeadPolicy } from "../optimizer/jointPipeline/domain";
import { adaptiveSeedPools } from "../optimizer/adaptiveSampling";
import { reneeDecapitationReference } from "./fixtures/reneeDecapitationChain";

const MARK = "hero-skill.ruini.dream-mark";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
describe("user-supplied 60/39/1 vs 49/1/50 canonical benchmark", () => {
  it("preserves the original bytes, canonical input, deployment and engine snapshot", () => {
    const { input, fixture } = readReneeFixture();
    expect(fixture.sourceFileSha256).toBe("3dde023d1bb73889978721e693df6cff76566e131431e780f28ba819beace1cb");
    expect(fixture.inputSha256).toBe("a5aca8f702307a82baf8b161017870d4e7f2d95559c3a98caa481d6ff1c6036b");
    expect(digest(toEngineScenario(input))).toBe(fixture.engineScenarioSha256);
    expect(JSON.parse(readFileSync(reneeDecapitationReference.inputFixture, "utf8"))).toEqual(input);
    expect(input.randomSeed).toBe(502926396); expect(input.maxRounds).toBe(1500);
    expect(input.sideA.rallyDeployment).toEqual({ totalTroops: 1800000, ratios: { shield: 60, lancer: 39, marksman: 1 } });
    expect(input.sideB.rallyDeployment).toEqual({ totalTroops: 1800000, ratios: { shield: 49, lancer: 1, marksman: 50 } });
    expect(input.sideA.bodySkills!.filter((s) => s.skillId === MARK)).toHaveLength(2);
    for (const own of [input.sideA, input.sideB]) for (const id of Object.values(own.leaderHeroIds!))
      expect(own.simulationWeaponLevels![id!]).toBe(10);
  });
  it("freezes a common Final1000 and the explicit current-default search settings", () => {
    const { input, fixture } = readReneeFixture(), config = fixture.optimizerConfig;
    expect(fixture.optimizerOptionsProvenance).toContain("not claimed to be historical optimizer settings");
    expect(fixture.seeds.final).toEqual(adaptiveSeedPools(config.firstSeed, 300, 1000).final);
    expect(fixture.seeds.final).toHaveLength(1000); expect(new Set(fixture.seeds.final).size).toBe(1000);
    expect(config.firstSeed).toBe(input.randomSeed); expect(config.verificationTrials).toBe(1000);
    expect(config.jointPipeline!.perHeadProtectedK).toBe(1);
    expect(generateAllHeadFormations(input, jointHeadPolicy(input, config).headConstraints, undefined, "A")).toHaveLength(1062);
    expect(fixture.rallyBodyPoolIds).toContain("hero.s6.ruini");
  });
  it("replays the supplied seed deterministically and emits a 3B merged skill payload", () => {
    const { input } = readReneeFixture(), before = digest(input), compiled = compileValidationBattle(input);
    const first = compiled.runTrial(input.randomSeed, "none"), second = compiled.runTrial(input.randomSeed, "none");
    expect(second).toEqual(first);
    expect(first.roundCount).toBeLessThan(input.maxRounds);
    expect(compiled.initialState.sideA.troops.lancer.initialCount).toBe(702000);
    const traced = runValidationBattleCore({ ...input, maxRounds: 21 });
    const payloads = traced.simulation.trace.rounds.flatMap((r) => r.damageEvents.filter((e) => e.sourceSkillId === MARK));
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.every((e) => e.sourceSide === "A" && e.skillCoefficient === 3 && e.damageType === "skillDamage")).toBe(true);
    const r20 = traced.simulation.trace.rounds.find((r) => r.round === 20)!;
    expect(r20.heroSkills.filter((s) => s.side === "A" && s.skillId === MARK && s.triggered)).toHaveLength(2);
    expect(r20.damageEvents.find((e) => e.sourceSide === "A" && e.sourceTroop === "lancer" && e.damageType === "normalAttack")?.targetTroop).toBe("shield");
    const r21 = traced.simulation.trace.rounds.find((r) => r.round === 21)!;
    const markEvents = r21.damageEvents.filter((e) => e.sourceSkillId === MARK);
    expect(markEvents).toHaveLength(1);
    expect(markEvents[0]).toMatchObject({ targetTroop: "shield", skillCoefficient: 3, roundedDamage: 9776244201 });
    expect(digest(input)).toBe(before);
  });
});
