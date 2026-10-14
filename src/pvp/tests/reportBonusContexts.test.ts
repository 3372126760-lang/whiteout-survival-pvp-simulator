import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { applyRecognizedReport } from "../../ui/applyRecognizedReport";
import { createValidationPreviewState, previewExpectedReportBonuses, toValidationThreeQueueConfig,
  type ValidationBattleInput, type ValidationReportBonusMatrix } from "../index";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import type { ParsedBattleReport } from "../battleReportRecognition/types";

const stats = ["attack", "defense", "penetration", "life"] as const;
const troops = ["shield", "lancer", "marksman"] as const;
function modifiers(additive: number, buff: number, debuff: number): ValidationReportBonusMatrix {
  return Object.fromEntries(troops.map((troop) => [troop,
    Object.fromEntries(stats.map((stat) => [stat, { additive, buff, debuff }]))])) as ValidationReportBonusMatrix;
}
function manualHistory(): ValidationBattleInput {
  const base = createDefaultValidationInput();
  return { ...base, attributeInputMode: "prediction", sideA: { ...base.sideA,
    troops: Object.fromEntries(troops.map((troop) => [troop, { ...base.sideA.troops[troop],
      attack: 200, defense: 200, penetration: 200, life: 200 }])) as typeof base.sideA.troops,
    sourceReportBonuses: modifiers(5, 20, 10), reportAttributeBasis: "historicalReport" } };
}

describe("historical versus target report contexts", () => {
  it("reverses manual historical bonuses but defaults the target to zero", () => {
    const input = manualHistory();
    const before = JSON.stringify(input);
    const row = previewExpectedReportBonuses(input).A.breakdown.lancer.attack;
    const raw = 300 * 1.1 / 1.2 - 100 - 5;
    expect(row.inputReportBonus).toBeCloseTo(raw / 100, 12);
    expect(row).toMatchObject({ sourceReportAdditive: .05, sourceReportBuff: .2,
      sourceReportDebuff: .1, targetAdditive: 0, targetBuff: 0, targetDebuff: 0 });
    expect(row.finalBonus).toBeCloseTo(raw / 100, 12);
    expect(createValidationPreviewState(input).sideA.troops.lancer.attack).toBeCloseTo(raw / 100, 12);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("reuses the original only on explicit selection", () => {
    const input = manualHistory();
    const configured = { ...input, sideA: { ...input.sideA, targetBonusMode: "reuseSource" as const } };
    const row = previewExpectedReportBonuses(configured).A.breakdown.shield.attack;
    expect(row).toMatchObject({ targetAdditive: .05, targetBuff: .2, targetDebuff: .1 });
    expect(row.finalBonus).toBeCloseTo(2, 12);
    expect(createValidationPreviewState(configured).sideA.troops.shield.attack).toBeCloseTo(2, 12);
  });
  it("displays the target rate itself rather than a report-value-dependent residual", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, attributeInputMode: "prediction" as const,
      sideA: { ...base.sideA, troops: { ...base.sideA.troops,
        lancer: { ...base.sideA.troops.lancer, attack: 140 } },
        targetBonusMode: "custom" as const, targetBattleBonuses: modifiers(0, 20, 0) } };
    const row = previewExpectedReportBonuses(input).A.breakdown.lancer.attack;
    expect(row.finalBonus).toBeCloseTo(1.88, 12);
    expect(row.targetBuff).toBe(.2);
    // The old residual display would label a 20% factor as a 48-point increase.
    expect(row.finalBonus - row.inputReportBonus).toBeCloseTo(.48, 12);
  });
  it("keeps custom target values independent of changes in historical context", () => {
    const input = manualHistory();
    const first = { ...input, sideA: { ...input.sideA,
      targetBonusMode: "custom" as const, targetBattleBonuses: modifiers(0, 30, 5) } };
    const second = { ...first, sideA: { ...first.sideA, sourceReportBonuses: modifiers(0, 60, 30) } };
    for (const configured of [first, second]) {
      const row = previewExpectedReportBonuses(configured).A.breakdown.shield.attack;
      expect(row).toMatchObject({ targetAdditive: 0, targetBuff: .3, targetDebuff: .05 });
      expect(row.finalBonus).toBeCloseTo((1 + row.inputReportBonus) * 1.3 / 1.05 - 1, 12);
    }
    expect(first.sideA.targetBattleBonuses).toBe(second.sideA.targetBattleBonuses);
  });
  it("treats an accepted OCR report and manual historical report identically", () => {
    const box = [[0, 0], [10, 0], [10, 10], [0, 10]] as const;
    const field = (value: number) => ({ value, confidence: .99, box });
    const bonus = (value: number, category: "additive" | "buff" | "debuff", stat: typeof stats[number]) => ({
      label: category === "additive" ? `官职赐予部队${stat}` : stat, attribute: stat, scope: "general" as const, category,
      troopScope: "all" as const, effectTarget: category === "debuff" ? "enemy" as const : "self" as const,
      amount: field(value),
    });
    const context: ParsedBattleReport = { imageId: "historical-context", confidence: .99, warnings: [],
      pageTypes: ["attributes", "specialBonuses"], left: { sourceSide: "left", specialEvidence: true,
        troopSetup: {}, attributes: Object.fromEntries(troops.map((troop) => [troop,
          Object.fromEntries(stats.map((stat) => [stat, field(200)]))])),
        specialBonuses: { additive: stats.map((stat) => bonus(5, "additive", stat)),
          buffs: stats.map((stat) => bonus(20, "buff", stat)), debuffs: [] } },
      right: { sourceSide: "right", specialEvidence: true, troopSetup: {}, attributes: {},
        specialBonuses: { additive: [], buffs: [], debuffs: stats.map((stat) => bonus(10, "debuff", stat)) } } };
    const imported = applyRecognizedReport(createDefaultValidationInput(), context, "left", "A", "complete");
    const manual = manualHistory();
    for (const mode of ["none", "reuseSource", "custom"] as const) {
      const configure = (input: ValidationBattleInput) => ({ ...input, sideA: { ...input.sideA,
        targetBonusMode: mode, targetBattleBonuses: modifiers(0, 10, 5) } });
      expect(createValidationPreviewState(configure(imported)).sideA.troops.lancer.attack)
        .toBeCloseTo(createValidationPreviewState(configure(manual)).sideA.troops.lancer.attack, 12);
    }
    expect(imported.sideA.sourceReportAttributes?.lancer.attack).toBe(200);
    expect(imported.sideA.targetBonusMode).toBe("none");
  });
  it("does not propagate historical environment into the independently configured opponent", () => {
    const input = manualHistory();
    const configured = { ...input, sideA: { ...input.sideA,
      externalBuffs: { ...input.sideA.externalBuffs!, town: { ...input.sideA.externalBuffs!.town,
        enemyAttackReduction: "large" as const } } } };
    expect(previewExpectedReportBonuses(configured).B.breakdown.shield.attack.targetDebuff).toBe(0);
  });
  it("roundtrips source, target, mode and input basis independently", () => {
    const input = manualHistory();
    const configured = { ...input, sideA: { ...input.sideA, targetBonusMode: "custom" as const,
      targetBattleBonuses: modifiers(0, 30, 5) } };
    const restored = restorePersistedConfig(createPersistedEnvelope(configured, 1000)).input;
    expect(restored.sideA.sourceReportBonuses).toEqual(configured.sideA.sourceReportBonuses);
    expect(restored.sideA.targetBattleBonuses).toEqual(configured.sideA.targetBattleBonuses);
    expect(restored.sideA.reportAttributeBasis).toBe("historicalReport");
    expect(createValidationPreviewState(restored).sideA.troops.shield.attack)
      .toBeCloseTo(createValidationPreviewState(configured).sideA.troops.shield.attack, 12);
  });
  it("keeps historical and target contexts local to each queue", () => {
    const input = manualHistory();
    const queues = input.sideA.threeQueues!.map((queue, index) => ({ ...queue,
      attributes: Object.fromEntries(troops.map((troop) => [troop, {
        attack: 200, defense: 200, penetration: 200, life: 200 }])) as NonNullable<NonNullable<typeof input.sideA.threeQueues>[0]["attributes"]>,
      reportAttributeBasis: "historicalReport" as const, sourceReportBonuses: modifiers(0, 20, 10),
      targetBonusMode: index === 0 ? "none" as const : "reuseSource" as const }));
    const configured = { ...input, scenarioType: "THREE_QUEUE" as const,
      sideA: { ...input.sideA, targetBonusMode: "custom" as const, targetBattleBonuses: modifiers(0, 99, 99),
        threeQueues: queues as unknown as NonNullable<typeof input.sideA.threeQueues> } };
    const config = toValidationThreeQueueConfig(configured);
    expect(config.attacker.queues[0].side.lancer.attack).toBeCloseTo(1.75, 12);
    expect(config.attacker.queues[0].side.targetBattleBonuses?.lancer.attack)
      .toEqual({ additive: 0, buff: 0, debuff: 0 });
    expect(config.attacker.queues[1].side.targetBattleBonuses?.lancer.attack)
      .toEqual({ additive: 0, buff: 20, debuff: 10 });
  });
});

