import { describe, expect, it } from "vitest";
import { BODY_EFFECT_CATEGORIES, bodySkillMatchesQuery, getBodySkillOptions, presentBodySkill } from "../../ui/bodySkillPresentation";
import { bodySkillOptionsView, renderBodySkillSelect, type BodySkillSelectState } from "../../ui/bodySkillSelectView";
import { getAvailableMemberSkills, resolveBodySkillConfigs } from "../validationUi";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { CanonicalBodyEffectRegistry } from "../bodyEffects/canonicalRegistry";

const SHUYUN = "hero-skill.shuyun.attack";
const BRADLEY = "hero-skill.buladeli.veterans-pride";
const state: BodySkillSelectState = { side: "A", index: 0, stage: "s11",
  selectedSkillId: SHUYUN, selectedLevel: 5, query: "" };

describe("effect-first body skill presentation", () => {
  it("preserves original identities for restored configurations but lists only the earliest representative", () => {
    const book = presentBodySkill(SHUYUN)!, bradley = presentBodySkill(BRADLEY)!;
    expect(book.displayLabel).toBe("书允（SR）｜全军攻击提升25%｜常驻生效");
    expect(bradley.displayLabel).toBe("布拉德利（S7）｜全军攻击提升25%｜常驻生效");
    expect(book.effectSummary).toBe(bradley.effectSummary);
    expect(book.skillId).not.toBe(bradley.skillId);
    expect(book.skillName).toBe("征伐的战鼓");
    expect(book.skillDescription).toBe("全军攻击力提升25%。");
    const options = getBodySkillOptions("s11");
    expect(options.some((entry) => entry.skillId === BRADLEY)).toBe(false);
    expect(options.some((entry) => entry.skillId === SHUYUN)).toBe(true);
  });

  it("uses actual level values, probability, targets and timing rather than max-level catalog labels", () => {
    expect(presentBodySkill(SHUYUN, 3)?.effectSummary).toBe("全军攻击提升15%");
    expect(presentBodySkill("hero-skill.s8.hengdelike.defense-reduction")?.effectSummary).toBe("敌方防御降低25%");
    expect(presentBodySkill("hero-skill.miya.doom-entanglement")?.effectSummary)
      .toBe("50%概率：目标受到伤害增加50%（次回合生效，持续1回合）");
    expect(presentBodySkill("hero-skill.wuming.wind-shelter")?.effectSummary)
      .toBe("盾兵受到普通攻击伤害降低25%；盾兵受到技能伤害降低30%");
    expect(presentBodySkill("hero-skill.weien.thunder-raid")?.effectSummary).toContain("每4回合触发（首次 R4）");
    expect(presentBodySkill("hero-skill.ruini.dream-mark")?.timingSummary).toContain("标记后1回合造成200%附加伤害");
  });

  it("keeps manual R/SR availability and server-stage limits; includes slot 1 only", () => {
    const available = getAvailableMemberSkills("s11").flatMap((entry) => entry.sourceSkillIds);
    const options = getBodySkillOptions("s11");
    const registry = new CanonicalBodyEffectRegistry(undefined, "s11");
    expect(options.map((entry) => entry.skillId).sort()).toEqual(registry.effects.map((e) => e.representative.id).sort());
    expect(available.every((id) => registry.forSkill(id))).toBe(true);
    expect(options.some((entry) => entry.rarity === "SR")).toBe(true);
    expect(getBodySkillOptions("s2_t10").some((entry) => entry.skillId === BRADLEY)).toBe(false);
    for (const option of getBodySkillOptions("s16")) {
      const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find((entry) => entry.id === option.skillId)!;
      expect(definition.positionRule.kind).toBe("expeditionSkillSlot");
      expect(definition.positionRule.expeditionSkillSlot).toBe(1);
      expect(definition.positionRule.allowedPositions).toContain("member");
      expect(option.effectSummary).not.toContain("undefined");
    }
    expect(presentBodySkill("hero-skill.patelike.attack")).toBeUndefined();
    expect(presentBodySkill("hero-weapon-skill.heluonimo.rally-attack")).toBeUndefined();
  });

  it("searches names, effects, percentages and exact rarity/season tokens", () => {
    const book = presentBodySkill(SHUYUN)!, bradley = presentBodySkill(BRADLEY)!;
    for (const query of ["攻击", "25%", "书允", "SR", "攻击 25% SR", "２５％"])
      expect(bodySkillMatchesQuery(book, query)).toBe(true);
    expect(bodySkillMatchesQuery(bradley, "s7 攻击")).toBe(true);
    expect(bodySkillMatchesQuery(bradley, "SR")).toBe(false);
    expect(bodySkillMatchesQuery(book, "S7")).toBe(false);
    expect(bodySkillMatchesQuery(book, "防御 25%")).toBe(false);
  });

  it("renders category groups, detailed identity/original text and current-level effect", () => {
    const html = renderBodySkillSelect({ ...state, selectedLevel: 3 });
    expect(html).toContain('<optgroup label="攻击类">');
    expect(html).toContain("书允（SR）｜全军攻击提升15%｜常驻生效");
    expect(html).toContain("远征一技能：征伐的战鼓 · Lv3");
    expect(html).toContain("技能说明：全军攻击力提升25%。");
    expect(html).not.toContain("布拉德利（S7）｜全军攻击提升25%｜常驻生效");
    expect(html).toContain('data-scope="member"');
    expect(html).toContain('data-scope="member-search"');
    expect(html).toContain(`value="${SHUYUN}" selected`);
    const categories = getBodySkillOptions("s11").map((option) => BODY_EFFECT_CATEGORIES.indexOf(option.category));
    expect(categories).toEqual([...categories].sort((a, b) => a - b));
  });

  it("never replaces a selected hero when search hides it or matches nothing", () => {
    const filtered = bodySkillOptionsView({ ...state, query: "S7" });
    expect(filtered.html).toContain('<optgroup label="当前选择（未匹配搜索）">');
    expect(filtered.html).toContain(`value="${SHUYUN}" selected`);
    const empty = bodySkillOptionsView({ ...state, query: "没有这样的技能" });
    expect(empty.status).toContain("无匹配项");
    expect(empty.status).toContain("当前选择保留");
    expect(empty.html.match(/ selected/g)).toHaveLength(1);
    const unset = bodySkillOptionsView({ ...state, selectedSkillId: "", query: "S7" });
    expect(unset.html).toContain('<option value="" selected>不配置</option>');
    expect(unset.html).not.toContain(`value="${BRADLEY}" selected`);
  });

  it("escapes user-entered search text and preserves duplicate body IDs/levels through saving", () => {
    expect(renderBodySkillSelect({ ...state, query: '"><img src=x onerror=1>' })).not.toContain('<img src=x');
    const base = createDefaultValidationInput(), ids = [SHUYUN, SHUYUN, BRADLEY, BRADLEY];
    const bodySkills = resolveBodySkillConfigs(ids, [], "s11").map((body, index) =>
      ({ ...body, skillLevel: index < 2 ? 3 : 5 }));
    const input = { ...base, serverStage: "s11" as const, scenarioType: "RALLY" as const, battleContext: "rally" as const,
      sideA: { ...base.sideA, selectedMemberSkillIds: ids, bodySkills } };
    const before = JSON.stringify(input);
    for (const [index, body] of bodySkills.entries()) renderBodySkillSelect({ ...state, index,
      selectedSkillId: body.skillId, selectedLevel: body.skillLevel, query: "防御" });
    expect(JSON.stringify(input)).toBe(before);
    const restored = restorePersistedConfig(JSON.parse(JSON.stringify(createPersistedEnvelope(input, 1000)))).input;
    expect(restored.sideA.selectedMemberSkillIds).toEqual(ids);
    expect(restored.sideA.bodySkills).toEqual(bodySkills);
    expect(JSON.stringify(restored)).not.toContain("member-search");
    expect(JSON.stringify(restored)).not.toContain("effectSummary");
  });
});
