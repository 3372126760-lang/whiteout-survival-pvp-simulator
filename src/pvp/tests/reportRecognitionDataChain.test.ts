import { describe, expect, it } from "vitest";
import { TROOP_TYPES, createPureTroopBattleState, getValidationThreeQueues,
  previewRecognizedAttribute,
  toValidationThreeQueueConfig, type ParsedBattleReport,
  type ParsedBattleReportSide, type ParsedSpecialBonus,
  type ReportAttribute } from "../../pvp";
import { applyRecognizedReport } from "../../ui/applyRecognizedReport";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { mergeOwnedReportImage, pendingRecognitionSides } from
  "../../ui/reportImportDrafts";

const box = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
const stats: readonly ReportAttribute[] = ["attack", "defense", "penetration", "life"];

function side(sourceSide: "left" | "right", owner: "A" | "B",
  officialAttack: number): ParsedBattleReportSide {
  const official: ParsedSpecialBonus = { label: "官职赐予部队攻击力",
    canonicalLabel: "官职赐予部队攻击力", category: "additive",
    sourceArmy: owner, effectTarget: "self", troopScope: "all",
    activeInThisBattle: true, attribute: "attack", scope: "general",
    amount: { value: officialAttack, confidence: 1, box } };
  return { sourceSide, troopSetup: {}, specialEvidence: true,
    specialBonuses: { additive: [official], buffs: [], debuffs: [] },
    attributes: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      Object.fromEntries(stats.map((stat) => [stat, {
        value: owner === "A" && troop === "lancer" && stat === "attack" ?
          2612.8 : 200, confidence: 1, box,
      }]))])) };
}

function report(column: ParsedBattleReportSide): ParsedBattleReport {
  return { imageId: column.sourceSide, pageTypes: ["attributes", "specialBonuses"],
    ...(column.sourceSide === "left" ? { left: column } : { right: column }),
    warnings: [], confidence: 1 };
}

describe("OCR preview and applied three-queue data chain", () => {
  it("keeps 2612.8 in OCR preview while formal Q1 is still 300.2", () => {
    const base = createDefaultValidationInput();
    const queues = getValidationThreeQueues(base.sideA);
    const formal = { ...base, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const,
      sideA: { ...base.sideA, threeQueues: [{ ...queues[0],
        attributes: { ...queues[0].attributes!, lancer: {
          ...queues[0].attributes!.lancer, attack: 300.2 } } },
        queues[1], queues[2]] as NonNullable<typeof base.sideA.threeQueues> } };
    const a = side("left", "A", 0);
    const b = side("right", "B", 5);
    const drafts = mergeOwnedReportImage({ A: null, B: null }, "A", report(a));
    expect(pendingRecognitionSides(drafts, { A: false, B: false },
      "prediction")).toEqual(["A"]);
    expect(formal.sideA.threeQueues[0].attributes!.lancer.attack).toBe(300.2);
    const preview = previewRecognizedAttribute(a, b, "A", "lancer", "attack");
    expect(preview.reportValueSource).toEqual({ value: 2612.8,
      source: "ocrPreview" });
    expect(preview.specialBonusAdditivePercent).toBe(0);
    expect(preview.rawPercent).toBeCloseTo(2612.8, 10);
    expect(previewRecognizedAttribute(b, a, "B", "lancer", "attack")
      .specialBonusAdditivePercent).toBe(5);
    const applied = applyRecognizedReport(formal, report(a), "left", "A",
      "complete", 0);
    expect(formal.sideA.threeQueues[0].attributes!.lancer.attack).toBe(300.2);
    expect(applied.sideA.threeQueues?.[0].attributes?.lancer.attack)
      .toBeCloseTo(2612.8, 10);
    expect(applied.sideA.threeQueues?.[0].importedReportModifiers?.lancer.attack.additive)
      .toBe(0);
    expect(applied.sideA.troops).toEqual(formal.sideA.troops);
    expect(applied.sideA.threeQueues?.[1].attributes).toEqual(queues[1].attributes);
    expect(applied.sideA.threeQueues?.[2].attributes).toEqual(queues[2].attributes);
    expect(pendingRecognitionSides(drafts, { A: true, B: false },
      "prediction")).toEqual([]);
    const scenario = toValidationThreeQueueConfig(applied);
    const state = createPureTroopBattleState({ id: "ocr-applied-q1",
      sideA: scenario.attacker.queues[0]!.side,
      sideB: scenario.defender.queues[0]!.side, maxRounds: 1 });
    expect(state.sideA.troops.lancer.attack).toBeCloseTo(26.128, 10);
  });

  it("commits confirmed troop counts as only the selected queue's ratios", () => {
    const base = createDefaultValidationInput();
    const formal = { ...base, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const };
    const recognized = { ...side("left", "A", 0), troopSetup: {
      shield: { count: { value: 4000, confidence: 1, box } },
      lancer: { count: { value: 3000, confidence: 1, box } },
      marksman: { count: { value: 3000, confidence: 1, box } },
    } };
    const previous = getValidationThreeQueues(formal.sideA);
    const applied = applyRecognizedReport(formal, report(recognized), "left", "A",
      "complete", 1);
    expect(applied.sideA.threeQueues?.[1].ratios).toEqual({ shield: 40,
      lancer: 30, marksman: 30 });
    expect(applied.sideA.threeQueues?.[0].ratios).toEqual(previous[0].ratios);
    expect(applied.sideA.threeQueues?.[2].ratios).toEqual(previous[2].ratios);
    expect(applied.sideA.troops).toEqual(formal.sideA.troops);
    expect(formal.sideA.threeQueues).toEqual(base.sideA.threeQueues);
  });

  it("blocks only attack preview for an unresolved attack bonus", () => {
    const a = { ...side("left", "A", 0), unmatchedBonuses: [{
      rawText: "未知攻击加成", normalizedText: "未知攻击加成",
      possibleAttribute: "attack" as const, nearestRegistryCandidates: [],
    }] };
    const b = side("right", "B", 5);
    expect(() => previewRecognizedAttribute(a, b, "A", "lancer", "attack"))
      .toThrow(/attack.*待确认/);
    expect(previewRecognizedAttribute(a, b, "A", "lancer", "defense")
      .rawPercent).toBe(200);
    const formal = { ...createDefaultValidationInput(),
      attributeInputMode: "prediction" as const };
    expect(() => applyRecognizedReport(formal, report(a), "left", "A",
      "complete")).toThrow(/未归类/);
    expect(formal.sideA.troops.lancer.attack).toBe(240);
  });
});
