import { describe, expect, it } from "vitest";
import { createOptimizerBenchmarkFixture, restoreOptimizerBenchmarkFixture } from "./optimizerBenchmarkFixture";
import { rallyHeadSearchFixture, OPPONENT_HEAD } from "../pvp/tests/fixtures/rallyHeadSearch";
import { defaultOptimizationConfig, runRallyOptimization } from "../pvp/optimizer";
import { toEngineScenario, compileValidationBattle, getValidationCatalog } from "../pvp/validationUi";
import { createStageSeeds } from "../pvp/optimizer/seedSet";
import { createDefaultValidationInput } from "./defaultInput";
import { TROOP_TYPES } from "../pvp/types";
import type { ValidationSideInput } from "../pvp/validationUi";

function setup() {
  const base = rallyHeadSearchFixture();
  const input = { ...base, simulationMode: "fixedSeed" as const, maxRounds: 30,
    sideA: { ...base.sideA, leaderHeroIds: OPPONENT_HEAD,
      simulationWeaponLevels: Object.fromEntries(Object.values(OPPONENT_HEAD).map((id) => [id, 6])),
      rallyDeployment: { totalTroops: 6, ratios: { shield: 50, lancer: 33, marksman: 17 } },
      troops: { shield: { ...base.sideA.troops.shield, count: 3, t12Level: 7 }, lancer: { ...base.sideA.troops.lancer, count: 2, t12Level: 8 }, marksman: { ...base.sideA.troops.marksman, count: 1, t12Level: 9 } } },
    sideB: { ...base.sideB, rallyDeployment: { totalTroops: 6, ratios: { shield: 50, lancer: 33, marksman: 17 } },
      troops: { shield: { ...base.sideB.troops.shield, count: 3, attack: 333 }, lancer: { ...base.sideB.troops.lancer, count: 2, life: 444 }, marksman: { ...base.sideB.troops.marksman, count: 1, penetration: 555 } } } };
  const config = { ...defaultOptimizationConfig(413), objectiveMode: "singleWin" as const, profiling: true,
    constraints: { fixedLeaders: OPPONENT_HEAD, fixedBodyExact: true, fixedMemberSkillIds: [] },
    jointPipeline: { perHeadProtectedK: 3, criterionKeep: 1, criterionFineKeep: 1, theoryKeep: 1, formalRatioKeep: 1,
      formalStages: [20, 50, 100, 300].map((trials) => ({ trials, keep: 1 })) },
    theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 1 }, verificationTrials: 1000, topN: 2 };
  return { input, config };
}
describe("complete optimization Benchmark Fixture", () => {
  it("exports effective inventories, full canonical sides, retains, exact common seeds and restores after JSON reload", async () => {
    const { input, config } = setup(), before = JSON.stringify(input);
    const fixture = await createOptimizerBenchmarkFixture(input, config);
    const restored = await restoreOptimizerBenchmarkFixture(JSON.stringify(fixture));
    expect(JSON.stringify(input)).toBe(before);
    expect(fixture.seedPolicy.finalSeeds).toHaveLength(1000);
    expect(fixture.seedPolicy.screeningSeeds).toHaveLength(300);
    expect(fixture.envelope.data.input.ownedHeroIds).toBeDefined();
    expect(fixture.envelope.data.input.optimizerHeroPool!.A).toBeDefined();
    expect(fixture.envelope.data.input.rallyBodyPoolIds).toBeDefined();
    expect(restored.optimizationConfig.jointPipeline?.perHeadProtectedK).toBe(3);
    expect(toEngineScenario(restored.input)).toEqual(toEngineScenario(input));
    expect(fixture.searchSpace).toMatchObject({ headCount: 1, bodyCount: 1, headBodyCount: 1 });
    const first = compileValidationBattle(input), second = compileValidationBattle(restored.input);
    for (const seed of createStageSeeds(413, 5)) expect(second.runFastTrial(seed)).toEqual(first.runFastTrial(seed));
    const bodyHeroes = ["hero.body.shuyun", "hero.body.jiexi", "hero.sr.patelike", "hero.sr.xieergai"];
    const fixedSkills = bodyHeroes.map((id) => {
      const group = getValidationCatalog().memberSkills.find((row) => row.sourceHeroIds.includes(id))!;
      return group.sourceSkillIds[group.sourceHeroIds.indexOf(id)]!;
    });
    const requiredBody = await createOptimizerBenchmarkFixture(input, { ...config,
      constraints: { fixedBodyExact: true, fixedMemberSkillIds: fixedSkills, requiredHeroIds: [bodyHeroes[0]!] } });
    expect(requiredBody.searchSpace).toMatchObject({ headCount: 7, bodyCount: 1, fixedHead: false, fixedBody: true });
    await expect(restoreOptimizerBenchmarkFixture(JSON.stringify(requiredBody))).resolves.toBeDefined();
  });
  it("reruns the exact same formal candidates and seed results after export/import", async () => {
    const setupValue = setup(), empty = { shield: null, lancer: null, marksman: null };
    // Full panels, heroes and T12 settings are checked above. This integration
    // case keeps real battles and all 1000 Final seeds; higher attack avoids
    // spending most of the test on long, low-damage duels.
    const base = createDefaultValidationInput();
    const compact = (side: ValidationSideInput): ValidationSideInput => ({ ...side,
      leaderHeroIds: empty, simulationWeaponLevels: {},
      troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, { ...side.troops[troop], count: 1, attack: 1000 }])) as ValidationSideInput["troops"],
      rallyDeployment: { totalTroops: 3, ratios: { shield: 34, lancer: 33, marksman: 33 } } });
    const input = { ...base, scenarioType: "RALLY" as const, battleContext: "rally" as const, maxRounds: 30,
      ownedHeroIds: [], sideA: compact(base.sideA), sideB: compact(base.sideB) };
    const config = { ...setupValue.config, constraints: { ...setupValue.config.constraints, fixedLeaders: empty } };
    const fixture = await createOptimizerBenchmarkFixture(input, config);
    const restored = await restoreOptimizerBenchmarkFixture(JSON.stringify(fixture));
    const a = runRallyOptimization(input, config), b = runRallyOptimization(restored.input, restored.optimizationConfig);
    expect(a.singleWaveTop).toEqual(b.singleWaveTop);
    expect(a.currentEvaluation).toEqual(b.currentEvaluation);
    expect(a.currentEvaluation.trials).toBe(1000);
    expect(a.singleWaveTop.every((row) => row.trials === 1000)).toBe(true);
    expect(a.searchDiagnostics?.jointPipeline?.peak.evaluatedHeadBodyCount).toBe(b.searchDiagnostics?.jointPipeline?.peak.evaluatedHeadBodyCount);
  }, 30000);
  it("rejects changed panels, retains, inventory, seeds and dimensions instead of silently reproducing another input", async () => {
    const { input, config } = setup(), original = await createOptimizerBenchmarkFixture(input, config);
    for (const change of [(f: typeof original) => { (f.envelope.data.input.sideA.troops.shield as { attack: number }).attack++; },
      (f: typeof original) => { f.envelope.data.optimizationConfig!.jointPipeline!.perHeadProtectedK = 2; },
      (f: typeof original) => { (Object.values(f.envelope.data.input.optimizerHeroPool!.A!)[0] as { enabled: boolean }).enabled = false; },
      (f: typeof original) => { f.seedPolicy.finalSeeds = [...f.seedPolicy.finalSeeds.slice(1), 1]; },
      (f: typeof original) => { f.searchSpace.headCount++; }]) {
      const fixture = structuredClone(original); change(fixture);
      await expect(restoreOptimizerBenchmarkFixture(JSON.stringify(fixture))).rejects.toThrow();
    }
  });
});
