import { normalizeRecognitionResult } from "./fixtures/historicalReportRecognition";
import { describe, expect, it } from "vitest";
import { detectPageType, deriveReportAttribute, mapReportSide, matchSpecialBonusLabel,
  mergeBattleReports,
  parsePercent, resolveDisplayedBaseComposition,
  type OcrImage, type OcrLine } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

function line(text: string, x: number, y: number, scale = 1,
  confidence = .98): OcrLine {
  return { text, confidence, box: [[x * scale, y * scale],
    [(x + 150) * scale, y * scale], [(x + 150) * scale, (y + 24) * scale],
    [x * scale, (y + 24) * scale]] };
}
function image(lines: readonly OcrLine[], scale = 1,
  enhancedLines?: readonly OcrLine[]): OcrImage {
  return { imageId: `img-${scale}`, width: 1000 * scale, height: 900 * scale,
    lines, ...(enhancedLines === undefined ? {} : { enhancedLines }) };
}
function centralAttributes(scale = 1, crop = 0): OcrImage {
  const rows: OcrLine[] = [line("属性加成", 400, 5, scale)];
  const troops = ["盾兵", "矛兵", "射手"];
  const attrs = ["攻击力", "防御力", "穿透", "生命值"];
  for (let index = 0; index < 12; index += 1) {
    const y = 35 + index * 42 - crop;
    if (y < 0) continue;
    rows.push(line("+1680.7%", 140, y, scale),
      line(`${troops[Math.floor(index / 4)]}${attrs[index % 4]}`, 415, y, scale),
      line("+1917.1%", 720, y, scale));
  }
  return image(rows, scale);
}

describe("BattleReportImporter anchor parsing", () => {
  it.each([1, 1.7, 2.4])("reads central-label left/right attributes at %sx scale", (scale) => {
    const report = normalizeRecognitionResult(centralAttributes(scale));
    expect(report.pageType).toBe("attributes");
    expect(report.left?.attributes.shield?.attack?.value).toBe(1680.7);
    expect(report.right?.attributes.shield?.attack?.value).toBe(1917.1);
    expect(report.left?.attributes.marksman?.life?.value).toBe(1680.7);
    expect(report.right?.attributes.marksman?.life?.value).toBe(1917.1);
    expect(report.warnings).toEqual([]);
  });
  it("keeps a vertically cropped page partial and warns for missing attributes", () => {
    const report = normalizeRecognitionResult(centralAttributes(1, 150));
    expect(report.left?.attributes.shield?.attack).toBeUndefined();
    expect(report.left?.attributes.marksman?.life?.value).toBe(1680.7);
    expect(report.warnings).toContain("missing left.shield.attack");
  });
  it("reads a right-only central column and maps it to either model side", () => {
    const base = centralAttributes();
    const rightOnly = normalizeRecognitionResult({ ...base, lines: base.lines.filter((row) =>
      row.text !== "+1680.7%") });
    expect(rightOnly.left).toBeUndefined();
    expect(rightOnly.right?.attributes.shield?.attack?.value).toBe(1917.1);
    const starting = createDefaultValidationInput();
    expect(mapReportSide(starting, rightOnly, "right", "A", "finalReport")
      .sideA.troops.shield.attack).toBe(1917.1);
    expect(mapReportSide(starting, rightOnly, "right", "B", "finalReport")
      .sideB.troops.shield.attack).toBe(1917.1);
  });
  it("reads a left-only central column", () => {
    const base = centralAttributes();
    const leftOnly = normalizeRecognitionResult({ ...base, lines: base.lines.filter((row) =>
      row.text !== "+1917.1%") });
    expect(leftOnly.left?.attributes.shield?.attack?.value).toBe(1680.7);
    expect(leftOnly.right).toBeUndefined();
  });
  it("flags disagreement between original and enhanced OCR passes", () => {
    const base = centralAttributes();
    const enhanced = base.lines.map((row) => row.text === "+1680.7%" &&
      row.box[0][1] === 35 ? { ...row, text: "+16807%" } : row);
    const report = normalizeRecognitionResult({ ...base, enhancedLines: enhanced });
    expect(report.left?.attributes.shield?.attack?.needsConfirmation).toBe(true);
    expect(report.left?.attributes.shield?.attack?.alternatives).toContain(16807);
    expect(() => mapReportSide(createDefaultValidationInput(), report, "left", "A",
      "finalReport")).toThrow(/人工确认/);
  });
  it("uses nearby wrapped values with low structural confidence", () => {
    const report = normalizeRecognitionResult(image([
      line("属性加成", 400, 5), line("盾兵攻击力", 400, 50),
      line("+123.4%", 150, 79),
    ]));
    expect(report.left?.attributes.shield?.attack?.value).toBe(123.4);
    expect(report.left?.attributes.shield?.attack?.structuralConfidence).toBe(.7);
    expect(report.left?.attributes.shield?.attack?.needsConfirmation).toBe(true);
  });
  it("classifies and splits special bonuses from a central label", () => {
    const report = normalizeRecognitionResult(image([
      line("特殊加成说明", 400, 10),
      line("+0.00%", 140, 50), line("官职赋予部队穿透", 400, 50),
      line("+10.00%", 720, 50),
      line("+5%", 140, 90), line("部队攻击力增益", 400, 90),
      line("+15%", 720, 90),
      line("+8%", 140, 130), line("罪人防御力降低", 400, 130),
      line("+12%", 720, 130),
    ]));
    expect(report.pageType).toBe("specialBonuses");
    expect(report.left?.specialBonuses?.additive[0]?.amount.value).toBe(0);
    expect(report.left?.specialBonuses?.additive[0]?.amount.needsConfirmation).toBe(false);
    expect(report.right?.specialBonuses?.additive[0]?.amount.value).toBe(10);
    expect(report.left?.specialBonuses?.buffs[0]?.amount.value).toBe(5);
    expect(report.right?.specialBonuses?.debuffs[0]?.amount.value).toBe(12);
  });
  it("splits one OCR line containing both special values", () => {
    const report = normalizeRecognitionResult(image([
      line("特殊加成说明", 400, 10),
      line("+0.00% 官职赋予部队穿透 +10.00%", 350, 50),
    ]));
    expect(report.left?.specialBonuses?.additive[0]?.amount.value).toBe(0);
    expect(report.right?.specialBonuses?.additive[0]?.amount.value).toBe(10);
    expect(report.right?.specialBonuses?.additive[0]?.amount.needsConfirmation).toBe(false);
  });
  it("normalizes a displayed negative enemy debuff to a positive magnitude", () => {
    const report = normalizeRecognitionResult(image([
      line("特殊加成说明", 400, 10),
      line("敌方所有部队攻击力 -20%", 20, 50),
    ]));
    expect(report.left?.specialBonuses?.debuffs[0]?.amount.value).toBe(20);
    expect(report.left?.specialBonuses?.debuffs[0]?.effectTarget).toBe("enemy");
  });
  it("normalizes a missing 力 and diagnoses genuinely unknown special rows", () => {
    const report = normalizeRecognitionResult(image([
      line("特殊加成说明", 400, 10),
      line("城镇被攻击时守城部队攻击 +0.00%", 20, 50),
      line("神秘攻击力 +9%", 20, 90),
    ]));
    expect(report.left?.specialBonuses?.buffs[0]?.canonicalLabel)
      .toBe("城镇被攻击时守城部队攻击力");
    expect(report.left?.specialBonuses?.buffs[0]?.amount.needsConfirmation).toBe(false);
    expect(report.left?.unmatchedBonuses?.[0]).toMatchObject({
      rawText: "神秘攻击力 +9%", normalizedText: "神秘攻击", amount: { value: 9 },
    });
    expect(report.left?.unmatchedBonuses?.[0]?.nearestRegistryCandidates.length)
      .toBeGreaterThan(0);
  });
  it("deduplicates scroll overlap and blocks conflicting bonus values", () => {
    const one = normalizeRecognitionResult(image([line("特殊加成说明", 20, 5),
      line("宠物攻击力 +5%", 20, 40)]));
    const duplicate = normalizeRecognitionResult(image([line("特殊加成说明", 20, 5),
      line("宠物攻击力 +5%", 20, 40)]));
    const changed = normalizeRecognitionResult(image([line("特殊加成说明", 20, 5),
      line("宠物攻击力 +15%", 20, 40)]));
    const merged = mergeBattleReports([one, duplicate, changed]);
    expect(merged.left?.specialBonuses?.buffs).toHaveLength(1);
    expect(merged.left?.specialBonuses?.buffs[0]?.conflict).toBe(true);
    expect(merged.left?.specialBonuses?.buffs[0]?.conflictValues).toEqual([5, 15]);
    expect(merged.warnings.some((warning) => warning.includes("冲突"))).toBe(true);
    const withAttributes = mergeBattleReports([
      normalizeRecognitionResult(centralAttributes()), one, changed]);
    expect(() => mapReportSide({ ...createDefaultValidationInput(),
      attributeInputMode: "prediction" }, withAttributes, "left", "A", "prediction",
    false, undefined, true))
      .toThrow(/数值冲突/);
    expect(mapReportSide(createDefaultValidationInput(), withAttributes,
      "left", "A", "finalReport").sideA.troops.shield.attack).toBe(1680.7);
  });
  it("uses exact normalized aliases before fuzzy OCR matching", () => {
    expect(matchSpecialBonusLabel("官职赋予部队穿透")?.rule.category).toBe("additive");
    expect(matchSpecialBonusLabel("部队攻击力增益")?.rule.category).toBe("buff");
    expect(matchSpecialBonusLabel("罪人防御力降低")?.rule.category).toBe("debuff");
    const fuzzy = matchSpecialBonusLabel("官職賜予部队穿透");
    expect(fuzzy?.rule.category).toBe("additive");
    expect(fuzzy?.matchType).toBe("alias");
    expect(fuzzy?.confidence).toBe(1);
    expect(matchSpecialBonusLabel("神秘战斗属性")).toBeUndefined();
    expect(matchSpecialBonusLabel("奇怪部队攻击力")).toBeUndefined();
    expect(matchSpecialBonusLabel("部队攻击力未知效果")?.confidence).toBeLessThan(.85);
    expect(matchSpecialBonusLabel("敌方防御力减益（宠物技能）")?.rule)
      .toMatchObject({ category: "debuff", stat: "defense", effectTarget: "enemy" });
    expect(matchSpecialBonusLabel("敌方所有部队攻击力")?.rule)
      .toMatchObject({ category: "debuff", stat: "attack", effectTarget: "enemy" });
    expect(matchSpecialBonusLabel("攻击力增益（宠物技能）")?.rule)
      .toMatchObject({ category: "buff", stat: "attack", effectTarget: "self" });
    expect(matchSpecialBonusLabel("城镇被攻击时守城部队生命值")?.rule)
      .toMatchObject({ scope: "garrison", stat: "life" });
  });
  it("auto-confirms all four official labels and the expert penetration alias", () => {
    for (const label of ["官职赋予部队攻击力", "官职赋予部队防御力",
      "官职赋予部队穿透力", "官职赋予部队生命值"]) {
      expect(matchSpecialBonusLabel(label)).toMatchObject({
        confidence: 1, matchType: "exact", rule: { category: "additive" },
      });
    }
    const report = normalizeRecognitionResult(image([
      line("特殊加成说明", 400, 10),
      line("官职赋予部队攻击力 +0.00%", 20, 50),
      line("官职赋予部队防御力 +0.00%", 20, 90),
      line("官职赋予部队穿透力 +0.00%", 20, 130),
      line("官职赋予部队生命值 +0.00%", 20, 170),
    ]));
    expect(report.left?.specialBonuses?.additive).toHaveLength(4);
    expect(report.left?.specialBonuses?.additive.every((row) =>
      row.amount.value === 0 && row.matchType === "exact" &&
      row.amount.needsConfirmation === false)).toBe(true);
    const both = normalizeRecognitionResult(image([
      line("特殊加成说明", 400, 10),
      ...["攻击力", "防御力", "穿透力"].flatMap((stat, index) => [
        line("+0.00%", 140, 50 + 40 * index),
        line(`官职赋予部队${stat}`, 400, 50 + 40 * index),
        line("+5.00%", 720, 50 + 40 * index),
      ]),
    ]));
    expect(both.right?.specialBonuses?.additive).toHaveLength(3);
    expect(both.right?.specialBonuses?.additive.every((row) =>
      row.amount.value === 5 && row.matchType === "exact" &&
      row.amount.needsConfirmation === false)).toBe(true);
    expect(matchSpecialBonusLabel("敌方穿透力减益（专家技能）"))
      .toMatchObject({ confidence: 1, matchType: "alias", rule: {
        category: "debuff", stat: "penetration", effectTarget: "enemy",
        troopScope: "all",
      } });
  });
  it("finds six unlabeled troop cards from a repeated level row", () => {
    const lines: OcrLine[] = [];
    for (let index = 0; index < 6; index += 1) {
      const x = 20 + index * 160;
      lines.push(line(index === 0 ? "11.0级" : index === 2 ? "11.9级" :
        "10.3级", x, 100));
      lines.push(line(`${741805 + index * 1000}`, x, 145));
      lines.push(line("火晶7", x, 65));
      lines.push(line("3级", x, 190));
    }
    const parsed = normalizeRecognitionResult(image(lines));
    expect(parsed.left?.troopSetup.shield?.displayedTroopLevel?.value).toBe(11);
    expect(parsed.left?.troopSetup.marksman?.displayedTroopLevel?.value).toBe(11.9);
    expect(parsed.right?.troopSetup.shield?.count?.value).toBe(744805);
    expect(parsed.right?.troopSetup.marksman).not.toHaveProperty("t12SkillLevel");
    expect(parsed.left?.troopSetup.shield?.displayedFireCrystalLevel?.value).toBe(7);
    expect(parsed.left?.troopSetup.shield?.level?.value).toBe("T11-FC7");
  });
  it.each([[11.1, .9, .1], [11.5, .5, .5], [11.9, .1, .9], [11, 1, 0]])(
    "resolves displayed base level %s without creating virtual game levels",
    (level, lower, upper) => {
      const parts = resolveDisplayedBaseComposition(level, 93_666);
      expect(parts[0]?.ratio).toBeCloseTo(lower, 10);
      if (upper === 0) expect(parts).toHaveLength(1);
      else expect(parts[1]?.ratio).toBeCloseTo(upper, 10);
      expect(parts.reduce((sum, part) => sum + (part.count ?? 0), 0)).toBe(93_666);
    });
  it.each(["11.1", "11.5", "11.9", "11.0"])(
    "parses displayed troop level %s from an OCR card", (displayed) => {
      const report = normalizeRecognitionResult(image([
        line(`盾兵兵种等级 ${displayed}`, 20, 30),
        line("盾兵数量 93,666", 20, 75),
      ]));
      const setup = report.left?.troopSetup.shield;
      expect(setup?.displayedTroopLevel?.value).toBe(Number(displayed));
      expect(setup?.resolvedBaseComposition?.reduce((sum, part) =>
        sum + (part.count ?? 0), 0)).toBe(93_666);
      expect(setup?.level).toBeUndefined();
    });
  it("restores integer fire crystal display as an approximation and validates concrete level", () => {
    const report = normalizeRecognitionResult(image([
      line("兵种信息", 20, 10), line("盾兵兵种等级 11.9", 20, 50),
      line("盾兵火晶显示等级 8", 20, 90), line("盾兵数量 93,666", 20, 130),
      line("矛兵兵种等级 T11-FC2", 20, 170),
    ]));
    const shield = report.left?.troopSetup.shield;
    expect(shield?.displayedTroopLevel?.value).toBe(11.9);
    expect(shield?.resolvedBaseComposition?.map((part) => part.level)).toEqual([11, 12]);
    expect(shield?.displayedFireCrystalLevel?.value).toBe(8);
    expect(shield?.level?.value).toBe("T11-FC8");
    expect(shield?.displayedFireCrystalLevel?.needsConfirmation).toBe(false);
    expect(report.left?.troopSetup.lancer?.level?.needsConfirmation).toBe(true);
    expect(() => mapReportSide(createDefaultValidationInput(), report, "left", "A",
      "finalReport")).toThrow(/置信度较低|未识别/);
  });
  it("uses repeated card order when small troop captions are unreadable", () => {
    const report = normalizeRecognitionResult(image([
      line("兵种等级 10.1", 80, 30), line("兵种等级 11.5", 400, 30),
      line("兵种等级 11.9", 720, 30),
      line("数量 1000", 80, 75), line("数量 2000", 400, 75),
      line("数量 3000", 720, 75),
    ]));
    expect(report.left?.troopSetup.shield?.count?.value).toBe(1000);
    expect(report.left?.troopSetup.lancer?.count?.value).toBe(2000);
    expect(report.left?.troopSetup.marksman?.count?.value).toBe(3000);
    expect(report.left?.troopSetup.shield?.count?.needsConfirmation).toBe(true);
  });
  it("accepts real plain T10 and flags nonexistent plain T11", () => {
    const report = normalizeRecognitionResult(image([
      line("盾兵等级 T10", 20, 30), line("矛兵等级 T11", 20, 75),
    ]));
    expect(report.left?.troopSetup.shield?.level?.value).toBe("T10");
    expect(report.left?.troopSetup.shield?.level?.needsConfirmation).toBe(false);
    expect(report.left?.troopSetup.lancer?.level?.value).toBe("T11");
    expect(report.left?.troopSetup.lancer?.level?.needsConfirmation).toBe(true);
  });
  it("accepts signed percentages and preserves the full inverse derivation", () => {
    expect(parsePercent("+1680.7%")).toBe(1680.7);
    expect(parsePercent("-5.0% ")).toBe(-5);
    expect(parsePercent("19171%")?.toString()).toBe("19171");
    expect(deriveReportAttribute(140, 10, 20, 5)).toEqual({ reportValue: 140,
      additive: 10, buff: 20, debuff: 5, rawValue: 100 });
  });
  it("detects troop and unknown pages without a manual page-type selector", () => {
    expect(detectPageType(image([line("盾兵兵种等级 11.9", 20, 30)]))).toBe("troops");
    expect(detectPageType(image([line("胜利", 20, 30)]))).toBe("unknown");
  });
});
