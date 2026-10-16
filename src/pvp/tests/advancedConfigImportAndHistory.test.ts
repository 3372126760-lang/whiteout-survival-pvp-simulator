import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { parseConfigurationImport } from "../../ui/configImport";
import { encodeSimpleShare } from "../../ui/simpleShare";
import { renderAdvancedLineupActions } from "../../ui/advancedModeView";
import { renderHistoricalBonusTable } from "../../ui/historicalBonusView";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { zeroHistoricalBonuses, normalizeHistoricalTree, historicalReportBonuses } from "../validationUi/historicalBonuses";
import { sourceReportBonuses, rawReportSide, targetBattleBonuses, zeroReportBonuses } from "../validationUi/reportBonusContexts";
import { createValidationPreviewState, resolveBodySkillConfigs, compileValidationBattle } from "../validationUi";
import { TROOP_TYPES } from "../types";
import { deriveRawReportAttribute } from "../battleReportRecognition/mapping";
import type { ValidationHistoricalBonuses, ValidationSideInput } from "../validationUi/types";
import { readFileSync } from "node:fs";
const base = createDefaultValidationInput(), head = { shield: "hero.s11.eleonora", lancer: "hero.s3.miya", marksman: "hero.s11.rufus" };
const body = ["hero-skill.wuming.wind-shelter", "hero-skill.wuming.wind-shelter", "hero-skill.nuola.multi-troop-combat", "hero-skill.nuola.multi-troop-combat"];
const history: ValidationHistoricalBonuses = { ...zeroHistoricalBonuses(), attack: { additive: 0, buff: 30, debuff: 0 } };
const rich = { ...base, scenarioType: "RALLY" as const, battleContext: "rally" as const, attributeInputMode: "prediction" as const,
  sideA: { ...base.sideA, leaderHeroIds: head, bodySkills: resolveBodySkillConfigs(body, [], "s11"), selectedMemberSkillIds: body,
    simulationWeaponLevels: Object.fromEntries(Object.values(head).map((id) => [id, 7])), sourceReportBonuses: history,
    reportAttributeBasis: "historicalReport" as const, targetBonusMode: "custom" as const, targetBattleBonuses: zeroReportBonuses(),
    troops: Object.fromEntries(TROOP_TYPES.map((t, i) => [t, { ...base.sideA.troops[t], troopLevel: "T12-FC10", t12Level: i + 10, attack: 250 + i * 100 }])) as ValidationSideInput["troops"],
    rallyDeployment: { totalTroops: 36000, ratios: { shield: 49, lancer: 2, marksman: 49 } } } };
const canonical = (input: typeof base) => createPersistedEnvelope(input, 1000, undefined, 0).data.input;
describe("unified advanced configuration import", () => {
  it("places import between save and share, then optimizer, with transfer actions on their own row", () => {
    const html = renderAdvancedLineupActions(false, false); expect(html.indexOf("保存阵容")).toBeLessThan(html.indexOf("导入配置"));
    expect(html.indexOf("导入配置")).toBeLessThan(html.indexOf("分享阵容")); expect(html.indexOf("分享阵容")).toBeLessThan(html.indexOf("配队优化"));
    expect(html).toContain('class="lineup-secondary"');
  });
  it("retains all six actions in the mobile action menu", () => {
    const html = renderAdvancedLineupActions(true, false); for (const action of ["save-profile", "import-config", "simple-share", "open-optimizer", "copy-a-to-b", "swap-sides"]) expect(html).toContain(`data-action="${action}"`);
  });
  it("imports a full Pages share URL through the existing decoder", () => {
    const decoded = parseConfigurationImport(`https://3372126760-lang.github.io/whiteout-survival-pvp-simulator/?mode=advanced#s=${encodeSimpleShare(rich, 1000)}`);
    expect(canonical(decoded.input)).toEqual(canonical(rich));
  });
  it("imports an exported JSON envelope without a second Advanced data model", () => expect(canonical(parseConfigurationImport(JSON.stringify(createPersistedEnvelope(rich, 1000))).input)).toEqual(canonical(rich)));
  it("imports a bare canonical BattleConfig JSON through the same codec", () => expect(canonical(parseConfigurationImport(JSON.stringify(rich)).input)).toEqual(canonical(rich)));
  it("uses the JSON parser for configuration file contents including BOM", () => expect(canonical(parseConfigurationImport("\uFEFF" + JSON.stringify(createPersistedEnvelope(rich, 1000))).input)).toEqual(canonical(rich)));
  it("restores Head/Body/Weapon/Ratio/Tiers/Attributes/Buff/T12 and scenario", () => {
    const next = parseConfigurationImport(JSON.stringify(createPersistedEnvelope(rich, 1000))).input;
    expect(next.scenarioType).toBe("RALLY"); expect(next.serverStage).toBe("s11"); expect(next.sideA.leaderHeroIds).toEqual(head);
    expect(next.sideA.bodySkills).toEqual(rich.sideA.bodySkills); expect(next.sideA.rallyDeployment).toEqual(rich.sideA.rallyDeployment);
    expect(next.sideA.simulationWeaponLevels).toEqual(rich.sideA.simulationWeaponLevels); expect(next.sideA.troops).toEqual(rich.sideA.troops);
    expect(next.sideA.externalBuffs).toEqual(rich.sideA.externalBuffs); expect(next.sideA.sourceReportBonuses).toEqual(history);
  });
  it.each(["", "{}", "{oops", "https://example.com/?mode=advanced", "https://example.com/#s=broken"])("rejects malformed input %j", (value) => expect(() => parseConfigurationImport(value)).toThrow());
});
describe("four-attribute historical bonus structure", () => {
  it("renders exactly attack/defense/penetration/life rows and twelve scalar inputs", () => {
    const html = renderHistoricalBonusTable("A", rich.sideA); expect((html.match(/<tr>/g) ?? []).length).toBe(5);
    expect((html.match(/<input /g) ?? []).length).toBe(12); for (const name of ["攻击", "防御", "穿透", "生命"]) expect(html).toContain(`scope="row">${name}`);
    expect(html).not.toMatch(/盾兵攻击|矛兵攻击|射手攻击|data-troop=/);
  });
  it.each(TROOP_TYPES)("applies shared historical attack +30%% to %s attack independently", (troop) => {
    const raw = rawReportSide(rich.sideA); expect(raw.troops[troop].attack).toBeCloseTo((100 + rich.sideA.troops[troop].attack) / 1.3 - 100, 10);
  });
  it("retains three distinct final attributes and their independently reversed values", () => {
    const raw = rawReportSide(rich.sideA); expect(new Set(TROOP_TYPES.map((t) => raw.troops[t].attack)).size).toBe(3);
  });
  it("never introduces source bonuses into the current battle by default", () => {
    const { targetBonusMode: _mode, ...own } = rich.sideA; void _mode;
    const current = targetBattleBonuses(own, base.sideB); expect(current.shield.attack.buff).toBe(0);
  });
  it("does not mutate B when changing A history", () => {
    const before = JSON.stringify(base.sideB), migrated = normalizeHistoricalTree(rich);
    expect(migrated.sideB).toBe(rich.sideB); expect(JSON.stringify(base.sideB)).toBe(before);
    expect(targetBattleBonuses(base.sideB, rich.sideA)).toEqual(targetBattleBonuses(base.sideB, base.sideA));
  });
  it("migrates an equal 12-cell matrix into four attributes on save and share", () => {
    const legacy = zeroReportBonuses(); const input = { ...base, sideA: { ...base.sideA, sourceReportBonuses: legacy, importedReportModifiers: legacy } };
    const persisted = createPersistedEnvelope(input, 1000).data.input.sideA;
    expect(Object.keys(persisted.sourceReportBonuses!)).toEqual(["attack", "defense", "penetration", "life"]); expect(persisted.importedReportModifiers).toBeUndefined();
    expect(restorePersistedConfig(createPersistedEnvelope(input, 1000)).input.sideA.sourceReportBonuses).toEqual(zeroHistoricalBonuses());
  });
  it("migrates a genuinely old JSON with a 12-cell source matrix", () => {
    const initial = createPersistedEnvelope(base, 1000), envelope = { ...initial, data: { ...initial.data, input: { ...initial.data.input,
      sideA: { ...initial.data.input.sideA, sourceReportBonuses: zeroReportBonuses() } } } };
    const restored = restorePersistedConfig(envelope); expect(restored.migrated).toBe(true); expect(restored.input.sideA.sourceReportBonuses).toEqual(zeroHistoricalBonuses());
  });
  it("preserves every old individually reversed raw value when troops disagree", () => {
    const old = zeroReportBonuses(), matrix = { ...old, shield: { ...old.shield, attack: { additive: 5, buff: 10, debuff: 0 } },
      lancer: { ...old.lancer, attack: { additive: 5, buff: 30, debuff: 0 } }, marksman: { ...old.marksman, attack: { additive: 5, buff: 50, debuff: 0 } } };
    const input = { ...rich, sideA: { ...rich.sideA, sourceReportBonuses: matrix } }, normalized = normalizeHistoricalTree(input);
    expect(normalized.sideA.reportAttributeBasis).toBe("raw"); expect(normalized.sideA.historicalBonusMigration?.conflicts).toHaveLength(1);
    for (const troop of TROOP_TYPES) expect(normalized.sideA.troops[troop].attack).toBeCloseTo(deriveRawReportAttribute({ reportPercent: input.sideA.troops[troop].attack,
      additivePercent: 5, buffDecimal: matrix[troop].attack.buff / 100, debuffDecimal: 0 }), 10);
    expect(historicalReportBonuses(normalized.sideA).attack.buff).toBe(0);
  });
  it("preserves conflicts across another save/load instead of silently choosing a troop", () => {
    const old = zeroReportBonuses(), matrix = { ...old, lancer: { ...old.lancer, attack: { additive: 0, buff: 30, debuff: 0 } } };
    const restored = restorePersistedConfig(createPersistedEnvelope({ ...rich, sideA: { ...rich.sideA, sourceReportBonuses: matrix } }, 1000)).input;
    expect(restored.sideA.historicalBonusMigration?.strategy).toBe("preserveRawAttributes");
    expect(sourceReportBonuses(restored.sideA).shield.attack.buff).toBe(0);
  });
  it("preserves existing formal results for the equal legacy and new four-attribute history", () => {
    const old = { ...rich, sideA: { ...rich.sideA, sourceReportBonuses: sourceReportBonuses(rich.sideA) } };
    const before = compileValidationBattle(old), after = compileValidationBattle(normalizeHistoricalTree(old));
    for (const seed of [19, 271, 12345]) expect(after.runFastTrial(seed)).toEqual(before.runFastTrial(seed));
  });
  it("builds the same preview from the migrated context", () => expect(createValidationPreviewState(normalizeHistoricalTree(rich))).toEqual(createValidationPreviewState(rich)));
  it("uses one-column controls within auto-fitting Advanced troop cards", () => {
    const css = readFileSync(new URL("../../ui/advancedMode.css", import.meta.url), "utf8");
    expect(css).toContain(".advanced-troop-cards .troop-fields { grid-template-columns: minmax(0, 1fr)"); expect(css).toContain("@container advanced-side (max-width: 540px)");
  });
});
