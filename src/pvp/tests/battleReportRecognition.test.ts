import { sourceReportBonuses } from "../validationUi/reportBonusContexts";
import { normalizeRecognitionResult } from "./fixtures/historicalReportRecognition";
import { describe, expect, it } from "vitest";
import { createValidationPreviewState, mapDoubleSidedFinalReport, mapReportSide,
  reverseReportAttribute, deriveRawReportAttribute,
  specialTotals, type OcrImage, type OcrLine, type ParsedBattleReport,
  type ParsedSpecialBonus } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

function line(text: string, x: number, y: number, confidence = .98): OcrLine {
  return { text, confidence, box: [[x, y], [x + 145, y],
    [x + 145, y + 25], [x, y + 25]] };
}
function sampleImage(): OcrImage {
  const lines: OcrLine[] = [];
  const troops = ["盾兵", "矛兵", "射手"];
  const attributes = ["攻击力", "防御力", "穿透", "生命"];
  for (const [side, x] of [["left", 20], ["right", 620]] as const) {
    for (let t = 0; t < 3; t += 1) {
      for (let a = 0; a < 4; a += 1) {
        const y = 30 + (t * 4 + a) * 42;
        lines.push(line(`${troops[t]}${attributes[a]}`, x, y));
        lines.push(line(`${side === "left" ? 140 : 220}.00%`, x + 175, y));
      }
      lines.push(line(`${troops[t]}等级 T10-FC10`, x, 570 + t * 36));
      lines.push(line(`${troops[t]}数量 93,666`, x, 700 + t * 36));
    }
  }
  return { imageId: "two-sided", width: 1200, height: 850, lines };
}
function withSpecial(report: ParsedBattleReport): ParsedBattleReport {
  const left = report.left!;
  return { ...report, left: { ...left, specialEvidence: true,
    specialBonuses: {
      additive: [{ label: "官职攻击", attribute: "attack", scope: "general",
        amount: { value: 10, confidence: .99, box: line("", 20, 0).box } }],
      buffs: [{ label: "宠物攻击", attribute: "attack", scope: "general",
        amount: { value: 20, confidence: .99, box: line("", 20, 0).box } }],
      debuffs: [{ label: "罪人攻击降低", attribute: "attack", scope: "general",
        amount: { value: 5, confidence: .99, box: line("", 20, 0).box } }],
    } } };
}

describe("local report recognition and mapping", () => {
  it("maps left to A and right to B without a hard-coded OCR side", () => {
    const parsed = normalizeRecognitionResult(sampleImage());
    const mapped = mapDoubleSidedFinalReport(createDefaultValidationInput(), parsed, "A");
    expect(mapped.sideA.troops.shield.attack).toBe(140);
    expect(mapped.sideB.troops.shield.attack).toBe(220);
    expect(mapped.sideA.troops.lancer.count).toBe(93_666);
    expect(parsed.left?.attributes.shield?.attack?.box).toBeDefined();
  });
  it("maps left to B and right to A", () => {
    const mapped = mapDoubleSidedFinalReport(createDefaultValidationInput(),
      normalizeRecognitionResult(sampleImage()), "B");
    expect(mapped.sideA.troops.shield.attack).toBe(220);
    expect(mapped.sideB.troops.shield.attack).toBe(140);
  });
  it("reverses A from left without applying A's enemy debuff to itself", () => {
    const input = { ...createDefaultValidationInput(), attributeInputMode: "prediction" as const };
    const mapped = mapReportSide(input, withSpecial(normalizeRecognitionResult(sampleImage())),
      "left", "A", "prediction", false, undefined, true);
    expect(mapped.sideA.troops.shield.attack).toBeCloseTo(90, 10);
    expect(mapped.sideA.troops.shield.defense).toBe(140);
    expect(sourceReportBonuses(mapped.sideA).shield.attack).toEqual({
      additive: 10, buff: 20, debuff: 0 });
    expect(createValidationPreviewState(mapped).sideA.troops.shield.attack).toBeCloseTo(.9, 10);
    const reuse = { ...mapped, sideA: { ...mapped.sideA, targetBonusMode: "reuseSource" as const } };
    expect(createValidationPreviewState(reuse).sideA.troops.shield.attack).toBeCloseTo(.9, 10);
  });
  it("applies an opposing owner's enemy debuff in the inverse calculation", () => {
    const input = { ...createDefaultValidationInput(), attributeInputMode: "prediction" as const };
    const report = withSpecial(normalizeRecognitionResult(sampleImage()));
    const opponent = { ...report.left!, sourceSide: "right" as const,
      specialBonuses: { additive: [], buffs: [],
        debuffs: report.left!.specialBonuses!.debuffs } };
    const mapped = mapReportSide(input, report, "left", "A", "prediction",
      false, opponent);
    expect(mapped.sideA.troops.shield.attack).toBeCloseTo(100, 10);
    expect(sourceReportBonuses(mapped.sideA).shield.attack.debuff).toBe(5);
  });
  it("reverses B from right independently, and requires a special explanation or explicit zero", () => {
    const parsed = normalizeRecognitionResult(sampleImage());
    const input = { ...createDefaultValidationInput(), attributeInputMode: "prediction" as const };
    expect(() => mapReportSide(input, parsed, "right", "B", "prediction"))
      .toThrow(/特殊加成信息不完整/);
    const mapped = mapReportSide(input, parsed, "right", "B", "prediction", true,
      undefined, true);
    expect(mapped.sideB.troops.shield.attack).toBe(220);
    expect(mapped.sideA.troops.shield.attack).toBe(240);
  });
  it("requires manual confirmation for low confidence and never reapplies weapon stats in final mode", () => {
    const parsed = normalizeRecognitionResult(sampleImage());
    const left = parsed.left!;
    const report: ParsedBattleReport = { ...parsed, left: { ...left,
      attributes: { ...left.attributes, shield: { ...left.attributes.shield,
        attack: { ...left.attributes.shield!.attack!, confidence: .72 } } } } };
    const base = createDefaultValidationInput();
    expect(() => mapDoubleSidedFinalReport(base, report, "A")).toThrow(/人工确认/);
    const confirmed: ParsedBattleReport = { ...report, left: { ...report.left!,
      attributes: { ...report.left!.attributes, shield: {
        ...report.left!.attributes.shield,
        attack: { ...report.left!.attributes.shield!.attack!, confirmed: true } } } } };
    const weaponInput = { ...base, sideA: { ...base.sideA,
      leaderHeroIds: { ...base.sideA.leaderHeroIds, marksman: "hero.s11.rufus" },
      simulationWeaponLevels: { "hero.s11.rufus": 10 } } };
    const mapped = mapDoubleSidedFinalReport(weaponInput, confirmed, "A");
    const preview = createValidationPreviewState(mapped);
    expect(mapped.sideA.troops.marksman.attack).toBe(140);
    expect(preview.sideA.troops.marksman.attack).toBeCloseTo(1.4, 12);
    expect(preview.sideA.heroStates.find((hero) => hero.heroId === "hero.s11.rufus")
      ?.weaponLevel).toBe(0);
  });
  it("validates the inverse formula and rejects malformed percent values", () => {
    expect(reverseReportAttribute(140, 10, 20, 5)).toBeCloseTo(100, 12);
    const raw = deriveRawReportAttribute({ reportPercent: 300.2,
      additivePercent: 5, buffDecimal: .3, debuffDecimal: .2 });
    expect((100 + raw + 5) * 1.3 / 1.2 - 100).toBeCloseTo(300.2, 10);
    expect(() => reverseReportAttribute(140, 0, -100, 0)).toThrow();
  });
  it("does not treat a special-section heading as proof of zero bonuses", () => {
    const base = sampleImage();
    const parsed = normalizeRecognitionResult({ ...base, lines: [...base.lines,
      line("特殊加成说明", 20, 800)] });
    expect(parsed.left?.specialEvidence).toBe(false);
    expect(() => mapReportSide({ ...createDefaultValidationInput(),
      attributeInputMode: "prediction" }, parsed, "left", "A", "prediction"))
      .toThrow(/特殊加成信息不完整/);
    const explicitNone = normalizeRecognitionResult({ ...base, lines: [...base.lines,
      line("无特殊加成", 20, 800)] });
    expect(explicitNone.left?.specialEvidence).toBe(true);
  });
  it("checks percent, troop count, and real fire-crystal level formats", () => {
    const parsed = normalizeRecognitionResult({ imageId: "formats", width: 700,
      height: 300, lines: [line("盾兵攻击力", 20, 10), line("12,34%", 190, 10),
        line("盾兵数量", 20, 50), line("93,66", 190, 50),
        line("盾兵等级 T11-FC2", 20, 90), line("矛兵等级 T12-FC7", 20, 130),
        line("矛兵数量", 20, 170), line("93,666", 190, 170),
        line("矛兵T12技能5", 20, 210)] });
    expect(parsed.left?.attributes.shield?.attack).toBeUndefined();
    expect(parsed.left?.troopSetup.shield?.count).toBeUndefined();
    expect(parsed.left?.troopSetup.shield?.level?.needsConfirmation).toBe(true);
    expect(parsed.left?.troopSetup.shield?.level?.legalCandidates).toContain("T11-FC3");
    expect(parsed.left?.troopSetup.lancer?.level?.value).toBe("T12-FC7");
    expect(parsed.left?.troopSetup.lancer?.count?.value).toBe(93_666);
    expect(parsed.left?.troopSetup.lancer).not.toHaveProperty("t12SkillLevel");
  });
  it("requires confirmation for a low-confidence special bonus", () => {
    const report = withSpecial(normalizeRecognitionResult(sampleImage()));
    const left = report.left!;
    const low = { ...report, left: { ...left, specialBonuses: {
      ...left.specialBonuses!, buffs: left.specialBonuses!.buffs.map((bonus) =>
        ({ ...bonus, amount: { ...bonus.amount, confidence: .6 } })) } } };
    expect(() => mapReportSide({ ...createDefaultValidationInput(),
      attributeInputMode: "prediction" }, low, "left", "A", "prediction",
    false, undefined, true))
      .toThrow(/人工确认/);
  });
  it("rejects malformed manually entered special percentages", () => {
    const report = withSpecial(normalizeRecognitionResult(sampleImage()));
    const left = report.left!;
    const invalid = { ...report, left: { ...left, specialBonuses: {
      ...left.specialBonuses!, buffs: left.specialBonuses!.buffs.map((bonus) =>
        ({ ...bonus, amount: { ...bonus.amount, value: -20 } })) } } };
    expect(() => mapReportSide({ ...createDefaultValidationInput(),
      attributeInputMode: "prediction" }, invalid, "left", "A", "prediction",
    false, undefined, true))
      .toThrow(/百分比格式无效/);
  });
  it("keeps left and right special bonuses separate using text anchors", () => {
    const parsed = normalizeRecognitionResult({ imageId: "special-columns", width: 1000,
      height: 160, lines: [line("宠物攻击力 +5%", 30, 25),
        line("宠物攻击力 +15%", 620, 25),
        line("官职防御力 +8%", 30, 75),
        line("罪人防御力降低 12%", 620, 75)] });
    expect(parsed.left?.specialBonuses?.buffs[0]?.amount.value).toBe(5);
    expect(parsed.right?.specialBonuses?.buffs[0]?.amount.value).toBe(15);
    expect(parsed.left?.specialBonuses?.additive[0]?.amount.value).toBe(8);
    expect(parsed.right?.specialBonuses?.debuffs[0]?.amount.value).toBe(12);
  });
  it("sums each multiplier group once and routes effects by source army and target", () => {
    const row = (label: string, amount: number, category: "additive" | "buff" | "debuff",
      sourceArmy: "A" | "B", effectTarget: "self" | "enemy",
      troopScope: "all" | "shield" = "all"): ParsedSpecialBonus => ({
      label, attribute: "attack", amount: { value: amount, confidence: .99,
        box: line(label, 20, 20).box }, category, sourceArmy, effectTarget,
      troopScope, scope: "garrison", activeInThisBattle: true,
    });
    const report = normalizeRecognitionResult(sampleImage());
    const own = { ...report.left!, specialEvidence: true,
      specialBonuses: {
        additive: [row("官职攻击", 5, "additive", "A", "self")],
        buffs: [row("部队攻击", 20, "buff", "A", "self"),
          row("守城攻击", 10, "buff", "A", "self", "shield")],
        debuffs: [row("敌方攻击", 8, "debuff", "A", "enemy")],
      } };
    const opponent = { ...report.right!, specialEvidence: true,
      specialBonuses: {
        additive: [], buffs: [],
        debuffs: [row("敌方攻击", 20, "debuff", "B", "enemy"),
          row("专家攻击", 5, "debuff", "B", "enemy")],
      } };
    const shield = specialTotals(own, "shield", "attack", opponent, "A");
    expect(shield).toEqual({ additivePercent: 5, buffDecimal: .3,
      debuffDecimal: .25 });
    expect(specialTotals(own, "lancer", "attack", opponent, "A")).toEqual({
      additivePercent: 5, buffDecimal: .2, debuffDecimal: .25 });
    expect(specialTotals(opponent, "shield", "attack", own, "B")).toEqual({
      additivePercent: 0, buffDecimal: 0, debuffDecimal: .08 });
    const raw = deriveRawReportAttribute({ reportPercent: 140, ...shield });
    expect((100 + raw + 5) * 1.3 / 1.25 - 100).toBeCloseTo(140, 10);
    const mapped = mapReportSide(createDefaultValidationInput(),
      { ...report, left: own, right: opponent }, "left", "A", "prediction",
      false, opponent);
    expect(mapped.sideA.troops.shield.attack).toBeCloseTo(raw, 10);
    expect(sourceReportBonuses(mapped.sideA).shield.attack).toEqual({
      additive: 5, buff: 0, debuff: 25 });
    expect(mapped.sideA.historicalBonusMigration?.conflicts).toContainEqual({ attribute: "attack", field: "buff",
      values: { shield: 30, lancer: 20, marksman: 20 } });
  });
  it("blocks unknown special rows until they are explicitly resolved", () => {
    const report = withSpecial(normalizeRecognitionResult(sampleImage()));
    const unknown = { ...report.left!, unmatchedBonuses: [{
      rawText: "神秘攻击", normalizedText: "神秘攻击",
      nearestRegistryCandidates: [],
    }] };
    expect(() => mapReportSide(createDefaultValidationInput(),
      { ...report, left: unknown }, "left", "A", "prediction", false,
      undefined, true)).toThrow(/未归类/);
  });
  it("does not admit non-official rows into the additive group", () => {
    const report = withSpecial(normalizeRecognitionResult(sampleImage()));
    const own = { ...report.left!, specialBonuses: {
      ...report.left!.specialBonuses!, additive: [{
        label: "宠物攻击", attribute: "attack" as const, scope: "general" as const,
        amount: { value: 5, confidence: .99, box: line("", 20, 0).box },
      }] } };
    expect(() => specialTotals(own, "shield", "attack")).toThrow(/官职/);
  });
});
