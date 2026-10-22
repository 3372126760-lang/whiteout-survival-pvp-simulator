import { describe, expect, it } from "vitest";
import { AdvancedScenarioStates, ADVANCED_SCENARIO_STORAGE_KEY, type ScenarioEditorState } from "./advancedScenarioState";
import { createDefaultValidationInput } from "./defaultInput";
import { defaultOptimizationConfig } from "../pvp/optimizer";
import { defaultSimpleScenarioOptimizationOptions } from "../pvp/optimizer/scenarioOptimizer";
import { defaultThreeQueueOptimizationOptions } from "../pvp/optimizer/threeQueueOptimizer";
import { normalizeInnerEarthInput } from "../pvp/innerEarth";
import { createValidationPreviewState, previewExpectedReportBonuses, toEngineScenario, toValidationThreeQueueConfig } from "../pvp/validationUi/adapter";
import { normalizeBattleInputPolicy, maxT12SkillLevel } from "../pvp/validationUi/inputPolicy";
import { DEFAULT_EXTERNAL_BUFF_CONFIG, TOWN_BUFF_RATES, STANDARD_PET_LEVELS, PET_LIFE_REDUCTION_LEVELS, PET_PENETRATION_REDUCTION_LEVELS } from "../pvp/externalBuffs/data";
import { combatBuffPreset } from "./combatBuffPresets";
import { allocateDeployment } from "./troopDeploymentView";
import { updateInnerEarthDeployment } from "./innerEarthView";
import { copySideAToB, swapBattleSides } from "./sideConfigActions";
import { createPersistedEnvelope, restorePersistedConfig } from "../storage";
import { rawReportSide, zeroReportBonuses } from "../pvp/validationUi/reportBonusContexts";
import { TROOP_TYPES } from "../pvp/types/combat";
import type { ValidationBattleInput } from "../pvp/validationUi/types";
import type { BattleScenarioType } from "../pvp/scenario/scenarioTypes";

const base = createDefaultValidationInput();
function state(scenarioType: BattleScenarioType, attack: number, t12Level: number): ScenarioEditorState {
  const side = (value: typeof base.sideA) => ({ ...value, troops: Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, { ...value.troops[troop], attack, t12Level }])) as typeof value.troops });
  let input = normalizeBattleInputPolicy({ ...base, scenarioType, sideA: side(base.sideA), sideB: side(base.sideB),
    battleContext: scenarioType === "RALLY" ? "rally" : "challenge" });
  if (scenarioType === "INNER_EARTH") input = normalizeInnerEarthInput(input);
  return { input, simulationCount: 1000, optimizationConfig: defaultOptimizationConfig(731),
    simpleOptimizerOptions: defaultSimpleScenarioOptimizationOptions(731), threeQueueOptimizerOptions: defaultThreeQueueOptimizationOptions(731) };
}
function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
describe("independent advanced scenario state", () => {
  it("persists all five complete scenarios and restores Rally Lv24 after reload", () => {
    const storage = memory(), states = new AdvancedScenarioStates(storage);
    const scenarios = ["SINGLE", "THREE_THREE_THREE", "RALLY", "ICE_FIRE_LEAGUE", "INNER_EARTH"] as const;
    scenarios.forEach((scenario, i) => states.save(state(scenario, 2800 + i * 100, scenario === "RALLY" ? 24 : 3)));
    expect(storage.data.has(ADVANCED_SCENARIO_STORAGE_KEY)).toBe(true);
    const reloaded = new AdvancedScenarioStates(storage);
    for (const [i, scenario] of scenarios.entries()) {
      const saved = reloaded.read(scenario)!;
      expect(saved.input.sideA.troops.shield.attack).toBe(2800 + i * 100);
      expect(saved.input.sideB.troops.lancer.t12Level).toBe(scenario === "RALLY" ? 24 : 3);
      expect(saved.optimizationConfig.firstSeed).toBe(731);
      expect(saved.input.scenarioType).toBe(scenario);
    }
  });
  it("copies/swaps only the active scenario and prevents nested references leaking", () => {
    const states = new AdvancedScenarioStates(memory()), rally = state("RALLY", 3500, 24), single = state("SINGLE", 2800, 3);
    states.save(rally); states.save(single);
    const input = { ...single.input, sideB: { ...single.input.sideB, rallyFixedCapacityBonus: 991 } };
    states.save({ ...single, input: swapBattleSides(copySideAToB(input)) });
    expect(states.read("RALLY")!.input).toEqual(rally.input);
    const copy = states.read("RALLY")!;
    (copy.input.sideA.troops.shield as { attack: number }).attack = 17;
    expect(states.read("RALLY")!.input.sideA.troops.shield.attack).toBe(3500);
  });
});
describe("scenario T12 boundary", () => {
  it.each(["SINGLE", "THREE_THREE_THREE", "ICE_FIRE_LEAGUE", "INNER_EARTH"] as const)("clamps both sides and dormant queues in %s to Lv3", (scenario) => {
    const input = state(scenario, 2500, 24).input;
    expect(maxT12SkillLevel(input)).toBe(3);
    for (const side of [input.sideA, input.sideB]) for (const troop of TROOP_TYPES) expect(side.troops[troop].t12Level).toBe(3);
    const imported = restorePersistedConfig(createPersistedEnvelope(input, 1000)).input;
    expect(imported.sideA.troops.shield.t12Level).toBe(3);
  });
  it("keeps Rally Lv24 and does not mutate its source when deriving a Single input", () => {
    const rally = state("RALLY", 3500, 24).input;
    expect(toEngineScenario(rally).sideA.shield.t12Level).toBe(24);
    expect(toEngineScenario({ ...rally, scenarioType: "SINGLE" }).sideB.shield.t12Level).toBe(3);
    expect(rally.sideB.troops.shield.t12Level).toBe(24);
  });
  it("clamps real IceFire child battle skill levels before Worker evaluation", () => {
    const raw = state("ICE_FIRE_LEAGUE", 2800, 3).input;
    const input = { ...raw, sideA: { ...raw.sideA, threeQueues: raw.sideA.threeQueues!.map((queue) =>
      ({ ...queue, t12Levels: { shield: 24, lancer: 13, marksman: 9 } })) as unknown as NonNullable<typeof raw.sideA.threeQueues> } };
    const config = toValidationThreeQueueConfig(input);
    for (const queue of config.attacker.queues) expect(queue.side.shield.t12Level).toBe(3);
  });
});
describe("deployment allocator and combat presets", () => {
  it.each([[100, 0, 0], [0, 100, 0], [0, 0, 100], [33, 33, 34], [33.33, 33.33, 33.34]])("allocates %j%% without losing troops", (shield, lancer, marksman) => {
    for (const total of [0, 1, 2, 7, 100001, 190410]) {
      const counts = allocateDeployment(total, { shield, lancer, marksman });
      expect(counts.shield + counts.lancer + counts.marksman).toBe(total);
      expect(Object.values(counts).every(Number.isSafeInteger)).toBe(true);
    }
  });
  it("applies total plus ratio to the actual Underground ally counts", () => {
    const initial = state("INNER_EARTH", 2800, 3).input;
    const input = normalizeInnerEarthInput(initial, { ...initial.innerEarth!, subMode: "BEAST_CAVE" });
    let next = updateInnerEarthDeployment(input, { field: "total" }, "100001");
    for (const [troop, value] of [["shield", "33"], ["lancer", "33"], ["marksman", "34"]]) next = updateInnerEarthDeployment(next, { field: "ratio", troop }, value!);
    expect(next.innerEarth!.ally.counts).toEqual({ shield: 33000, lancer: 33000, marksman: 34001 });
    expect(next.innerEarth!.enemy).toEqual(input.innerEarth!.enemy);
  });
  it.each(["small", "large"] as const)("uses the canonical %s town definition", (preset) => {
    const next = combatBuffPreset(DEFAULT_EXTERNAL_BUFF_CONFIG, preset);
    expect(Object.values(next.town)).toEqual(Array(6).fill(preset));
    expect(TOWN_BUFF_RATES[preset]).toBe(preset === "small" ? .1 : .2);
    expect(next.pet).toBe(DEFAULT_EXTERNAL_BUFF_CONFIG.pet);
    expect(next.expert).toBe(DEFAULT_EXTERNAL_BUFF_CONFIG.expert);
  });
  it("uses each pet table's highest legal level and keeps expert/capacity settings", () => {
    const side = { ...base.sideA, marchCapacityBonus: .12, rallyCapacityBonus: .18, rallyFixedCapacityBonus: 2222, petMarchCapacityLevel: 7,
      externalBuffs: { ...DEFAULT_EXTERNAL_BUFF_CONFIG, expert: { garethFourthSkillLevel: 12 } } };
    const enabled = { ...side, externalBuffs: combatBuffPreset(side.externalBuffs, "pets") };
    expect(enabled.externalBuffs.pet.attackLevel).toBe(STANDARD_PET_LEVELS.length - 1);
    expect(enabled.externalBuffs.pet.enemyPenetrationReductionLevel).toBe(PET_PENETRATION_REDUCTION_LEVELS.length - 1);
    expect(enabled.externalBuffs.pet.enemyLifeReductionLevel).toBe(PET_LIFE_REDUCTION_LEVELS.length - 1);
    const disabled = { ...enabled, externalBuffs: combatBuffPreset(enabled.externalBuffs, "off") };
    expect(disabled.externalBuffs.pet).toEqual(DEFAULT_EXTERNAL_BUFF_CONFIG.pet);
    expect(disabled.externalBuffs.expert.garethFourthSkillLevel).toBe(12);
    for (const value of [enabled, disabled]) expect([value.marchCapacityBonus, value.rallyCapacityBonus, value.rallyFixedCapacityBonus, value.petMarchCapacityLevel]).toEqual([.12, .18, 2222, 7]);
  });
});
describe("current attributes and historical tool isolation", () => {
  it("does not double count ordinary town/pet/expert effects in finalReport; prediction applies them", () => {
    const sideA = { ...base.sideA, externalBuffs: combatBuffPreset(combatBuffPreset(DEFAULT_EXTERNAL_BUFF_CONFIG, "large"), "pets") };
    const sideB = { ...base.sideB, externalBuffs: { ...sideA.externalBuffs, expert: { garethFourthSkillLevel: 12 } } };
    const configured = { ...base, sideA, sideB };
    const final = createValidationPreviewState({ ...configured, attributeInputMode: "finalReport" });
    for (const troop of TROOP_TYPES) for (const stat of ["attack", "defense", "penetration", "life"] as const)
      expect(final.sideA.troops[troop][stat]).toBeCloseTo(base.sideA.troops[troop][stat] / 100, 12);
    const prediction = previewExpectedReportBonuses({ ...configured, attributeInputMode: "prediction" });
    expect(prediction.A.breakdown.shield.attack.targetBuff).toBeCloseTo(.3, 12);
    expect(prediction.A.breakdown.shield.penetration.targetDebuff).toBeGreaterThan(.05);
  });
  it("ignores old current bonus fields in direct calls, imports, exports and side copies", () => {
    const legacy = { ...base, attributeInputMode: "prediction" as const, sideA: { ...base.sideA, targetBonusMode: "reuseSource" as const,
      targetBattleBonuses: zeroReportBonuses(), sourceReportBonuses: { ...zeroReportBonuses(), shield: { ...zeroReportBonuses().shield, attack: { additive: 77, buff: 300, debuff: 90 } } } } };
    const reference = createValidationPreviewState({ ...base, attributeInputMode: "prediction" });
    expect(createValidationPreviewState(legacy).sideA.troops.shield.attack).toBe(reference.sideA.troops.shield.attack);
    for (const input of [copySideAToB(legacy), swapBattleSides(legacy), restorePersistedConfig(createPersistedEnvelope(legacy, 1000)).input]) {
      expect(input.sideA.targetBonusMode).toBeUndefined(); expect(input.sideB.targetBattleBonuses).toBeUndefined();
    }
    expect(JSON.stringify(createPersistedEnvelope(legacy, 1000))).not.toMatch(/targetBonusMode|targetBattleBonuses/);
  });
  it("reverses history only through the explicit standalone tool", () => {
    const history = { ...base.sideA, reportAttributeBasis: "historicalReport" as const,
      sourceReportBonuses: { attack: { additive: 0, buff: 20, debuff: 2 }, defense: { additive: 0, buff: 0, debuff: 0 }, penetration: { additive: 0, buff: 20, debuff: 2 }, life: { additive: 0, buff: 20, debuff: 0 } } };
    const input: ValidationBattleInput = { ...base, attributeInputMode: "prediction", sideA: history };
    expect(createValidationPreviewState(input).sideA.troops.shield.attack).toBeCloseTo(base.sideA.troops.shield.attack / 100, 12);
    expect(rawReportSide(history).troops.shield.attack).toBeCloseTo((100 + history.troops.shield.attack) * 1.02 / 1.2 - 100, 10);
    expect(input.sideA.troops).toBe(history.troops);
  });
});
