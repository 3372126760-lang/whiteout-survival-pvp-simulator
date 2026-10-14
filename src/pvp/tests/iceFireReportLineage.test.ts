import { normalizeRecognitionResult } from "./fixtures/historicalReportRecognition";
import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { copySideAToB, swapBattleSides } from "../../ui/sideConfigActions";
import { applyRecognizedReport } from "../../ui/applyRecognizedReport";
import { createPersistedEnvelope, restorePersistedConfig, LocalStorageConfigStorage, AUTOSAVE_STORAGE_KEY } from "../../storage";
import { TROOP_TYPES } from "../types/combat";
import { createPureTroopBattleState } from "../scenario/pureTroopScenario";
import { getValidationThreeQueues, toValidationThreeQueueConfig } from "../validationUi/adapter";
import { captureQueueReportBaseline, changeQueueAttribute, changeQueueHero,
  createQueueReportLineageAudit, normalizeIceFireReportLineage, normalizeQueueReportLineage,
  queueHeroIds } from "../validationUi/queueReportLineage";
import { zeroReportBonuses } from "../validationUi/reportBonusContexts";
import { applyThreeQueueCandidate, type ThreeQueueOptimizationState } from "../optimizer/threeQueueOptimizer";
import { createCriterionThreeQueueEvaluator, currentCriterionQueueState } from "../optimizer/criterion/threeQueue";
import { defaultOptimizationConfig } from "../optimizer";
import type { ValidationBattleInput, ValidationQueueConfig, ValidationSideInput } from "../validationUi/types";

const lineup = { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" };
const weapons = Object.fromEntries(Object.values(lineup).map((id) => [id, 10]));
const emptyHeroes = { shield: null, lancer: null, marksman: null };

function staleInput(): ValidationBattleInput {
  const base = createDefaultValidationInput();
  const side = (original: ValidationSideInput): ValidationSideInput => ({ ...original,
    reportHeroIds: Object.values(lineup), reportHeroByTroop: lineup, reportWeaponLevels: weapons,
    simulationWeaponLevels: weapons,
    threeQueues: getValidationThreeQueues(base.sideA).map((queue) => ({ ...queue,
      leaderHeroIds: emptyHeroes, reportHeroByTroop: lineup, reportWeaponLevels: weapons,
      weaponLevels: weapons, attributeSource: "importedReport",
      reportLineage: { source: "historicalReport", attributeSnapshot: structuredClone(queue.attributes!) },
    })) as unknown as NonNullable<ValidationSideInput["threeQueues"]> });
  return { ...base, scenarioType: "ICE_FIRE_LEAGUE", attributeInputMode: "prediction",
    sideA: side(base.sideA), sideB: side(base.sideB), maxRounds: 2 };
}
const queue = (input: ValidationBattleInput, key: "sideA" | "sideB" = "sideB", index = 0) =>
  getValidationThreeQueues(input[key])[index]!;
function withQueue(input: ValidationBattleInput, value: ValidationQueueConfig,
  key: "sideA" | "sideB" = "sideB", index = 0): ValidationBattleInput {
  return { ...input, [key]: { ...input[key], threeQueues: input[key].threeQueues!.map((q, i) =>
    i === index ? value : q) as unknown as NonNullable<ValidationSideInput["threeQueues"]> } };
}
function expectEmpty(value: ValidationQueueConfig) {
  expect(queueHeroIds(value.leaderHeroIds)).toEqual([]);
  expect(queueHeroIds(value.reportHeroByTroop ?? {})).toEqual([]);
  expect(value.reportWeaponLevels).toEqual({});
  expect(value.weaponLevels).toEqual({});
  expect(value.reportLineage).toBeUndefined();
}

describe("IceFire queue report lineage", () => {
  it("A: B1 no heroes + 240% does not subtract old S11 heroes and reaches the battle as factor 3.4", () => {
    const input = staleInput();
    const original = structuredClone(input);
    const config = toValidationThreeQueueConfig(input);
    const b1 = config.defender.queues[0].side;
    expect(b1.heroes).toEqual([]);
    expect(b1.reportHeroes).toEqual([]);
    expect(b1.shield.attack).toBe(2.4);
    const state = createPureTroopBattleState({ id: "lineage-regression", maxRounds: 1,
      sideA: config.attacker.queues[0].side, sideB: b1 });
    expect(1 + state.sideB.troops.shield.attack).toBeCloseTo(3.4, 12);
    const audit = createQueueReportLineageAudit(queue(input), "sideB.threeQueues[0]");
    expect(audit.simulationHeroIds).toEqual([]);
    expect(audit.reportHoldHeroIds).toEqual([]);
    expect(audit.heroStaticDeltaPercent.shield).toEqual({ attack: 0, defense: 0, penetration: 0, life: 0 });
    expect(audit.reportValueSource.shield!.attack).toMatchObject({ value: 240,
      path: "sideB.threeQueues[0].attributes.shield.attack" });
    expect(input).toEqual(original);
  });

  it("also blocks shared reportHeroIds and weapon fallbacks when queues have no local baseline", () => {
    const input = staleInput();
    const { reportHeroByTroop: _heroes, reportWeaponLevels: _weapons,
      reportLineage: _lineage, ...bare } = input.sideB.threeQueues![0];
    void [_heroes, _weapons, _lineage];
    const config = toValidationThreeQueueConfig(withQueue(input, bare));
    expect(config.defender.queues[0].side.reportHeroes).toEqual([]);
    expect(config.defender.queues[0].side.heroes).toEqual([]);
  });

  it("B: configuring S11 then clearing each slot removes holds, weapons, and hero skill metadata", () => {
    let value: ValidationQueueConfig = { ...staleInput().sideB.threeQueues![0], leaderHeroIds: lineup, weaponLevels: weapons,
      heroSkillLevels: { "hero-skill.rufus.fire-brigade": 5 } };
    for (const troop of TROOP_TYPES) {
      const removed = value.leaderHeroIds[troop];
      value = changeQueueHero(value, troop, null);
      expect(queueHeroIds(value.reportHeroByTroop ?? {})).not.toContain(removed);
      expect(value.weaponLevels?.[removed!]).toBeUndefined();
      expect(value.reportWeaponLevels?.[removed!]).toBeUndefined();
    }
    expectEmpty(value);
    expect(value.heroSkillLevels).toEqual({});
  });

  it("C: legacy THREE_QUEUE -> IceFire and autosave restore discard stale holds even without preflight", () => {
    const old = JSON.parse(JSON.stringify(createPersistedEnvelope(staleInput(), 1000)));
    old.schemaVersion = 3;
    old.data.input.scenarioType = "THREE_QUEUE";
    old.data.input.threeQueueMode = "ICE_FIRE_LEAGUE";
    for (const key of ["sideA", "sideB"] as const) {
      old.data.input[key].reportHeroIds = Object.values(lineup);
      old.data.input[key].reportHeroByTroop = lineup;
      for (const value of old.data.input[key].threeQueues) {
        value.reportHeroByTroop = lineup; value.reportWeaponLevels = weapons;
        value.weaponLevels = weapons;
      }
    }
    for (const options of [{}, { validateBattleState: false }]) {
      const restored = restorePersistedConfig(old, options);
      expect(restored.input.scenarioType).toBe("ICE_FIRE_LEAGUE");
      for (const key of ["sideA", "sideB"] as const) {
        expect(restored.input[key].reportHeroIds).toEqual([]);
        getValidationThreeQueues(restored.input[key]).forEach(expectEmpty);
      }
    }
  });

  it("D: A -> B deep copy followed by clearing B, and swapping sides, cannot revive holds", () => {
    const a = { ...queue(staleInput(), "sideA"), leaderHeroIds: lineup, weaponLevels: weapons };
    const initial = withQueue(staleInput(), a, "sideA");
    const copied = copySideAToB(initial);
    let b = queue(copied);
    for (const troop of TROOP_TYPES) b = changeQueueHero(b, troop, null);
    const cleared = withQueue(copied, b);
    expectEmpty(queue(cleared));
    expect(queueHeroIds(queue(cleared, "sideA").leaderHeroIds)).toEqual(Object.values(lineup));
    const swapped = swapBattleSides(cleared);
    expectEmpty(queue(swapped, "sideA"));
    expectEmpty(queue(normalizeIceFireReportLineage(staleInput())));
  });

  it("E: manual overwrite resets historical hero and value provenance while keeping current Buff settings", () => {
    const base = staleInput().sideB.threeQueues![0];
    const historical: ValidationQueueConfig = { ...base, leaderHeroIds: { lancer: "hero.s3.miya" },
      sourceReportAttributes: base.attributes!, sourceReportBonuses: zeroReportBonuses(),
      reportAttributeBasis: "historicalReport", targetBonusMode: "custom",
      targetBattleBonuses: zeroReportBonuses() };
    const updated = changeQueueAttribute(historical, "shield", "attack", 240);
    expect(updated.attributeSource).toBe("manualInput");
    expect(updated.reportLineage).toBeUndefined();
    expect(queueHeroIds(updated.reportHeroByTroop ?? {})).toEqual(["hero.s3.miya"]);
    expect(updated.sourceReportAttributes).toBeUndefined();
    expect(updated.sourceReportBonuses).toBeUndefined();
    expect(updated.reportAttributeBasis).toBe("raw");
    expect(updated.targetBattleBonuses).toEqual(historical.targetBattleBonuses);
    const audit = createQueueReportLineageAudit(updated, "sideB.threeQueues[0]");
    expect(audit.heroStaticDeltaPercent.lancer!.attack).toBe(0);
    expect(audit.reportValueSource.shield!.attack).toMatchObject({ source: "manualInput", value: 240 });
  });

  it("rejects a saved baseline when its attribute snapshot no longer matches the current values", () => {
    const base = staleInput().sideB.threeQueues![0];
    const changed: ValidationQueueConfig = { ...base, leaderHeroIds: { lancer: "hero.s3.miya" },
      attributes: { ...base.attributes!, shield: { ...base.attributes!.shield, attack: 300 } } };
    const normalized = normalizeQueueReportLineage(changed, true);
    expect(normalized.reportLineage).toBeUndefined();
    expect(normalized.attributeSource).toBe("manualInput");
    expect(queueHeroIds(normalized.reportHeroByTroop ?? {})).toEqual(["hero.s3.miya"]);
  });

  it("F: six empty queues with 240% save and reload successfully through the real autosave API", () => {
    const memory = new Map<string, string>();
    const storage = new LocalStorageConfigStorage({ getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); }, removeItem: (key) => { memory.delete(key); } });
    const input = staleInput();
    storage.saveAutosave(input, 1000, defaultOptimizationConfig(input.randomSeed));
    expect(memory.has(AUTOSAVE_STORAGE_KEY)).toBe(true);
    const restored = storage.loadAutosave()!.input;
    const config = toValidationThreeQueueConfig(restored);
    for (const side of [config.attacker, config.defender]) for (const value of side.queues) {
      expect(value.side.heroes).toEqual([]); expect(value.side.reportHeroes).toEqual([]);
      expect(1 + value.side.shield.attack).toBeCloseTo(3.4, 12);
    }
  });

  it("preserves explicit, value-bound historical lineage and keeps optimizer baselines fixed", () => {
    const input = staleInput();
    const value = { ...input.sideB.threeQueues![0], leaderHeroIds: lineup, reportHeroByTroop: { lancer: "hero.s3.miya" } };
    const normalized = normalizeQueueReportLineage(value, true);
    expect(queueHeroIds(normalized.reportHeroByTroop ?? {})).toEqual(["hero.s3.miya"]);
    expect(createQueueReportLineageAudit(normalized, "A1").heroStaticDeltaPercent.lancer!.attack).not.toBe(0);
    const attributes = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      { attack: 5000, defense: 5000, penetration: 5000, life: 5000 }])) as NonNullable<ValidationQueueConfig["attributes"]>;
    const baseline = captureQueueReportBaseline({ ...changeQueueAttribute(value, "shield", "attack", 5000), attributes });
    const candidate: ThreeQueueOptimizationState = { queues: [0, 1, 2].map((index) => ({
      leaderHeroIds: index === 0 ? { lancer: "hero.s3.miya" } : {},
      headWeaponLevels: {}, ratiosBp: { shield: 5000, lancer: 2000, marksman: 3000 },
    })) as unknown as ThreeQueueOptimizationState["queues"] };
    const applied = applyThreeQueueCandidate(withQueue(input, baseline, "sideA"), "A", candidate);
    expect(queue(applied, "sideA").attributes).toEqual(baseline.attributes);
    expect(queue(applied, "sideA").reportHeroByTroop).toEqual(baseline.reportHeroByTroop);
    const restored = restorePersistedConfig(createPersistedEnvelope(applied, 1000)).input;
    expect(queue(restored, "sideA").reportLineage).toEqual(baseline.reportLineage);
  });

  it("Criterion baseline evaluation also ignores shared stale holds", () => {
    const input = staleInput();
    const result = createCriterionThreeQueueEvaluator(input).matchup(
      currentCriterionQueueState(input, "A").queues[0], currentCriterionQueueState(input, "B").queues[0], 0, 0);
    expect(Number.isFinite(result.margin)).toBe(true);
  });

  it("OCR applies only to the selected IceFire queue and does not reuse historical hero metadata", () => {
    const lines = TROOP_TYPES.flatMap((troop, ti) =>
      ["攻击力", "防御力", "穿透", "生命"].map((stat, si) => ({
        text: `${({ shield: "盾兵", lancer: "矛兵", marksman: "射手" })[troop]}${stat} 2612.8%`,
        confidence: .99, box: [[10, ti * 150 + si * 30], [300, ti * 150 + si * 30],
          [300, ti * 150 + si * 30 + 20], [10, ti * 150 + si * 30 + 20]] as const })));
    const report = normalizeRecognitionResult({ imageId: "lineage", width: 600, height: 600, lines });
    const input = staleInput();
    const applied = applyRecognizedReport(input, report, "left", "B", "explicitZero", 1);
    expect(applied.sideA.troops).toBe(input.sideA.troops);
    expect(applied.sideA.threeQueues?.map((q) => q.attributes)).toEqual(input.sideA.threeQueues?.map((q) => q.attributes));
    expect(queue(applied, "sideB", 1).attributes!.lancer.attack).toBeCloseTo(2612.8, 8);
    expectEmpty(queue(applied, "sideB", 1));
    expect(queue(applied, "sideB", 1).attributeSource).toBe("importedReport");
    expect(applied.sideB.troops).toBe(input.sideB.troops);
  });

  it.each(["SINGLE", "RALLY"] as const)("leaves %s report lineage unchanged", (scenarioType) => {
    const input = { ...staleInput(), scenarioType };
    expect(normalizeIceFireReportLineage(input)).toBe(input);
    expect(copySideAToB(input).sideB.reportHeroIds).toEqual(input.sideA.reportHeroIds);
  });
});
