import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { renderInnerEarthForm, updateInnerEarthField } from "../../ui/innerEarthView";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { createDefaultInnerEarthConfig, materializeInnerEarthInput, normalizeInnerEarthInput } from "../innerEarth";
import { ATTRIBUTE_SCHEMA_FIELDS, ATTRIBUTE_STATS, compactAttributeInput, expandAttributeInput,
  innerEarthAttributeSchema } from "../validationUi/attributeSchema";
import { applyRecognizedAttributes, attributeImportSchema, attributePreviewGroups,
  confirmAttributeGroup } from "../battleReportRecognition/attributeImport";
import { normalizeRecognitionResult } from "../battleReportRecognition/recognize";
import type { OcrImage } from "../battleReportRecognition/types";
import { TROOP_TYPES } from "../types";

const SCHEMA = "PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9";
const compact = {
  shieldAttack: 382.9, shieldDefense: 389.6, shieldPenetrationLife: 122,
  lancerAttack: 284.1, lancerDefense: 290.7, lancerPenetrationLife: 122,
  marksmanAttack: 755.8, marksmanDefense: 762.5, marksmanPenetrationLife: 122,
};
const expected = {
  shield: { attack: 382.9, defense: 389.6, penetration: 122, life: 122 },
  lancer: { attack: 284.1, defense: 290.7, penetration: 122, life: 122 },
  marksman: { attack: 755.8, defense: 762.5, penetration: 122, life: 122 },
};
function fixture() {
  const base = createDefaultValidationInput();
  return normalizeInnerEarthInput(base, { ...createDefaultInnerEarthConfig(base, "EQUIPMENT_FORGE"),
    ally: { ...createDefaultInnerEarthConfig(base, "EQUIPMENT_FORGE").ally, reportStats: structuredClone(expected) } });
}
function image(named = true, values = expected): OcrImage {
  const names = { shield: "盾兵", lancer: "矛兵", marksman: "射手" };
  const labels = { attack: "攻击力", defense: "防御力", penetration: "穿透力", life: "生命值" };
  return { imageId: "forge-nine", width: 800, height: 1000,
    lines: TROOP_TYPES.flatMap((troop, i) => ATTRIBUTE_STATS.map((stat, j) => {
      const y = 40 + (i * 4 + j) * 32;
      return { text: `${named ? names[troop] : ""}${labels[stat]} ${values[troop][stat]}%`, confidence: .99,
        box: [[20, y], [230, y], [230, y + 18], [20, y + 18]] };
    })) };
}
function parsed(named = true, values = expected) {
  return normalizeRecognitionResult(image(named, values), SCHEMA).left!;
}

describe("Equipment Forge ally: separate attack/defense and per-troop paired penetration/life", () => {
  it("expands the confirmed nine values into the exact twelve formal attributes", () => {
    expect(innerEarthAttributeSchema("EQUIPMENT_FORGE", "ally")).toBe(SCHEMA);
    expect(ATTRIBUTE_SCHEMA_FIELDS[SCHEMA]).toEqual(Object.keys(compact));
    expect(expandAttributeInput(SCHEMA, compact)).toEqual(expected);
    expect(compactAttributeInput(SCHEMA, expected)).toEqual(compact);
  });
  it("does not infer cross-troop sharing from equal penetration/life in one report", () => {
    const full = expandAttributeInput(SCHEMA, { ...compact,
      shieldPenetrationLife: 122, lancerPenetrationLife: 133, marksmanPenetrationLife: 144 });
    expect(TROOP_TYPES.map((troop) => [full[troop].penetration, full[troop].life])).toEqual([
      [122, 122], [133, 133], [144, 144],
    ]);
    expect(full.shield).not.toBe(full.lancer);
  });
  it("renders nine independently editable ally fields and the existing two enemy fields", () => {
    const html = renderInnerEarthForm(fixture());
    const fields = [...html.matchAll(/<input[^>]+data-field="compact-attribute"[^>]+>/g)].map((m) => m[0]);
    const ally = fields.filter((field) => field.includes('data-side="ally"'));
    expect(ally).toHaveLength(9);
    expect(fields.filter((field) => field.includes('data-side="enemy"'))).toHaveLength(2);
    for (const [key, value] of Object.entries(compact))
      expect(ally.some((field) => field.includes(`data-stat="${key}"`) && field.includes(`value="${value}"`))).toBe(true);
  });
  it.each(TROOP_TYPES)("editing %s defense preserves its attack and all other troop values", (troop) => {
    const before = fixture();
    const changed = updateInnerEarthField(before, { field: "compact-attribute", side: "ally", stat: `${troop}Defense` }, "400.01");
    expect(changed.innerEarth!.ally.reportStats).toEqual({ ...expected, [troop]: { ...expected[troop], defense: 400.01 } });
    expect(before.innerEarth!.ally.reportStats).toEqual(expected);
  });
  it("editing one penetration/life pair leaves other troops and independent attack/defense unchanged", () => {
    const changed = updateInnerEarthField(fixture(), { field: "compact-attribute", side: "ally", stat: "lancerPenetrationLife" }, "133.01");
    expect(changed.innerEarth!.ally.reportStats).toEqual({ ...expected, lancer: { ...expected.lancer, penetration: 133.01, life: 133.01 } });
  });
  it("preserves independent defense through normalization, persistence and formal battle adaptation", () => {
    const input = fixture();
    const restored = restorePersistedConfig(JSON.parse(JSON.stringify(createPersistedEnvelope(input, 1000)))).input;
    expect(restored.innerEarth!.ally.reportStats).toEqual(expected);
    const formal = materializeInnerEarthInput(restored);
    for (const troop of TROOP_TYPES) for (const stat of ATTRIBUTE_STATS)
      expect(formal.sideA.troops[troop][stat]).toBe(expected[troop][stat]);
  });
  it("still loads older equal attack/defense full-twelve configs without inventing missing differences", () => {
    const input = fixture();
    const old = { ...input, innerEarth: { ...input.innerEarth!, ally: { ...input.innerEarth!.ally,
      reportStats: { ...expected, shield: { ...expected.shield, defense: expected.shield.attack } } } } };
    const restored = restorePersistedConfig(JSON.parse(JSON.stringify(createPersistedEnvelope(old, 1000)))).input;
    expect(restored.innerEarth!.ally.reportStats.shield).toEqual({ ...expected.shield, defense: 382.9 });
  });
  it.each([true, false])("OCR has expectedFieldCount=9 without attack-defense conflicts (named anchors=%s)", (named) => {
    const report = parsed(named), groups = attributePreviewGroups(report, attributeImportSchema(fixture(), "A"));
    expect(groups).toHaveLength(9);
    expect(groups.map((group) => group.item?.value)).toEqual(Object.values(compact));
    expect(groups.every((group) => !group.conflict && !group.needsConfirmation)).toBe(true);
    expect(applyRecognizedAttributes(fixture(), report, "A").innerEarth!.ally.reportStats).toEqual(expected);
    expect(report.attributes.shield!.attack!.box).toEqual(image(named).lines[0]!.box);
  });
  it("accepts different per-troop penetration/life pairs in OCR", () => {
    const values = { ...expected, lancer: { ...expected.lancer, penetration: 133, life: 133 },
      marksman: { ...expected.marksman, penetration: 144, life: 144 } };
    const report = parsed(true, values);
    expect(attributePreviewGroups(report, SCHEMA).every((group) => !group.conflict && !group.needsConfirmation)).toBe(true);
    expect(applyRecognizedAttributes(fixture(), report, "A").innerEarth!.ally.reportStats).toEqual(values);
  });
  it("only flags inconsistent penetration/life within the same troop", () => {
    const report = parsed(true, { ...expected, shield: { ...expected.shield, life: 123 } });
    const pending = attributePreviewGroups(report, SCHEMA).filter((group) => group.needsConfirmation);
    expect(pending.map((group) => group.key)).toEqual(["shieldPenetrationLife"]);
    expect(pending[0]!.conflict).toBe(true);
    expect(() => applyRecognizedAttributes(fixture(), report, "A")).toThrow(/确认/);
    const reviewed = confirmAttributeGroup(report, SCHEMA, "shieldPenetrationLife", 122);
    expect(applyRecognizedAttributes(fixture(), reviewed, "A").innerEarth!.ally.reportStats).toEqual(expected);
  });
  it("manual defense confirmation never changes attack", () => {
    const reviewed = confirmAttributeGroup(parsed(), SCHEMA, "shieldDefense", 390);
    expect(applyRecognizedAttributes(fixture(), reviewed, "A").innerEarth!.ally.reportStats)
      .toEqual({ ...expected, shield: { ...expected.shield, defense: 390 } });
  });
  it("missing defense cannot be filled from attack and blocks apply until reviewed", () => {
    const source = image();
    const report = normalizeRecognitionResult({ ...source, lines: source.lines.filter((_, index) => index !== 1) }, SCHEMA).left!;
    expect(attributePreviewGroups(report, SCHEMA).filter((group) => group.needsConfirmation).map((group) => group.key)).toEqual(["shieldDefense"]);
    expect(() => applyRecognizedAttributes(fixture(), report, "A")).toThrow(/确认/);
    const reviewed = confirmAttributeGroup(report, SCHEMA, "shieldDefense", 389.6);
    expect(applyRecognizedAttributes(fixture(), reviewed, "A").innerEarth!.ally.reportStats).toEqual(expected);
  });
  it("does not guess troop names from incomplete unnamed tables", () => {
    const source = image(false);
    const report = normalizeRecognitionResult({ ...source, lines: source.lines.slice(1) }, SCHEMA).left;
    expect(attributePreviewGroups(report, SCHEMA)).toHaveLength(9);
    expect(attributePreviewGroups(report, SCHEMA).every((group) => group.needsConfirmation)).toBe(true);
  });
  it("low-confidence defense requires confirmation independently of attack", () => {
    const source = image();
    const report = normalizeRecognitionResult({ ...source, lines: source.lines.map((line, index) => index === 1 ? { ...line, confidence: .4 } : line) }, SCHEMA).left!;
    expect(attributePreviewGroups(report, SCHEMA).filter((group) => group.needsConfirmation).map((group) => group.key)).toEqual(["shieldDefense"]);
    expect(() => applyRecognizedAttributes(fixture(), report, "A")).toThrow(/确认/);
  });
  it("keeps OCR preview isolated and commits all twelve values together", () => {
    const base = fixture();
    const input = updateInnerEarthField(base, { field: "compact-attribute", side: "ally", stat: "shieldAttack" }, "240");
    const before = structuredClone(input), report = parsed();
    expect(input).toEqual(before);
    const applied = applyRecognizedAttributes(input, report, "A");
    expect(applied.innerEarth!.ally.reportStats).toEqual(expected);
    expect(input).toEqual(before);
    expect(applied.innerEarth!.enemy).toEqual(before.innerEarth!.enemy);
    expect(applied.innerEarth!.ally.counts).toEqual(before.innerEarth!.ally.counts);
    expect(applied.innerEarth!.ally.troopTiers).toEqual(before.innerEarth!.ally.troopTiers);
  });
  it("retains the existing Forge enemy shared schema and Gem Mine six-field schema", () => {
    expect(innerEarthAttributeSchema("EQUIPMENT_FORGE", "enemy")).toBe("ALL_TROOPS_PAIRED_2");
    expect(innerEarthAttributeSchema("GEM_MINE", "ally")).toBe("PER_TROOP_PAIRED_6");
    const enemy = confirmAttributeGroup(confirmAttributeGroup(parsed(), "ALL_TROOPS_PAIRED_2", "sharedAttackDefense", 220),
      "ALL_TROOPS_PAIRED_2", "sharedPenetrationLife", 330);
    expect(attributePreviewGroups(enemy, "ALL_TROOPS_PAIRED_2")).toHaveLength(2);
    const applied = applyRecognizedAttributes(fixture(), enemy, "B");
    TROOP_TYPES.forEach((troop) => expect(applied.innerEarth!.enemy.shared.expectedReportStats[troop])
      .toEqual({ attack: 220, defense: 220, penetration: 330, life: 330 }));
    expect(applied.innerEarth!.ally.reportStats).toEqual(expected);
  });
});
