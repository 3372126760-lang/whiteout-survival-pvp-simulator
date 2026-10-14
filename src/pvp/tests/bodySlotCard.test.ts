import { describe, expect, it } from "vitest";
import { renderBodySlotCard } from "../../ui/bodySkillSelectView";
import { getBodySkillOptions, presentBodySkill } from "../../ui/bodySkillPresentation";
import type { BodySlotCardState } from "../../ui/bodySlotCard";
const SHUYUN = "hero-skill.shuyun.attack", WUMING = "hero-skill.wuming.wind-shelter";
const state: BodySlotCardState = { side: "A", index: 0, stage: "s11", selectedSkillId: SHUYUN, selectedLevel: 5, query: "" };

describe("independent manual rally body slot cards", () => {
  it("contains filter, selector, summary and description inside one clearly titled card", () => {
    const html = renderBodySlotCard(state);
    expect(html).toContain('class="member-slot body-slot-card"');
    expect(html).toContain("A方 · 车身槽位1");
    expect(html).toContain("筛选条件"); expect(html).toContain("当前选择"); expect(html).toContain("当前选中");
    expect(html).toContain("技能说明 · 槽位1");
    expect(html.indexOf("data-body-description")).toBeGreaterThan(html.indexOf('data-scope="member"'));
    expect(html.lastIndexOf("</section>")).toBeGreaterThan(html.indexOf("技能说明：全军攻击力提升25%。"));
    expect(html).not.toContain("筛选车身技能"); expect(html).not.toContain("车身技能 1");
    expect(html).toContain('for="member-A-0-search"'); expect(html).toContain('for="member-A-0-select"');
  });
  it("binds slot3 to its selected skill and level without showing slot4's description", () => {
    const html = renderBodySlotCard({ ...state, index: 2, selectedSkillId: WUMING, selectedLevel: 5 });
    const detail = html.slice(html.indexOf('data-body-description'));
    expect(html).toContain("A方 · 车身槽位3"); expect(html).toContain('id="member-A-2-select"');
    expect(detail).toContain("无名"); expect(detail).toContain("SSR / S6"); expect(detail).toContain("Lv5");
    expect(detail).toContain("盾兵受到普通攻击伤害降低25%");
    expect(detail).toContain("盾兵受到技能伤害降低30%");
    expect(detail).not.toContain("征伐的战鼓"); expect(detail).not.toContain("槽位4");
    expect(html).toContain('data-side="A" data-index="2"');
  });
  it("keeps changing slot4 from altering slot3's independently rendered content", () => {
    const third = { ...state, index: 2, selectedSkillId: WUMING };
    const before = renderBodySlotCard(third);
    const fourth = renderBodySlotCard({ ...state, index: 3, selectedSkillId: "hero-skill.jiexi.penetration" });
    expect(fourth).toContain("A方 · 车身槽位4"); expect(fourth).toContain('id="member-A-3-detail-title"');
    expect(renderBodySlotCard(third)).toBe(before);
  });
  it("distinguishes both sides and accepts caller-supplied rally role titles", () => {
    const a = renderBodySlotCard({ ...state, roleLabel: "集结进攻方" });
    const b = renderBodySlotCard({ ...state, side: "B", index: 3, roleLabel: "集结防守方" });
    expect(a).toContain("集结进攻方 · 车身槽位1"); expect(b).toContain("集结防守方 · 车身槽位4");
    expect(b).toContain('data-scope="member" data-side="B" data-index="3"');
    expect(b).toContain('id="member-B-3-select"'); expect(b).not.toContain('id="member-A-3-select"');
    expect(renderBodySlotCard({ ...state, side: "B" })).toContain("B方 · 车身槽位1");
  });
  it("renders four different identities and repeated heroes as four separate cards", () => {
    const ids = [SHUYUN, WUMING, "hero-skill.jiexi.penetration", "hero-skill.patelike.life"];
    for (const selected of [ids, [SHUYUN, SHUYUN, ids[2]!, ids[3]!]]) {
      const html = selected.map((selectedSkillId, index) => renderBodySlotCard({ ...state, index, selectedSkillId })).join("");
      expect(html.match(/data-body-slot-card/g)).toHaveLength(4);
      expect(html.match(/data-body-description/g)).toHaveLength(4);
      for (let index = 0; index < 4; index++) expect(html).toContain(`id="member-A-${index}-detail-title"`);
    }
  });
  it("displays R/SR categories without fake S generations while retaining all search metadata", () => {
    const sr = presentBodySkill(SHUYUN)!;
    expect(sr.generation).toBeNull(); expect(sr.displayLabel).toContain("书允（SR）");
    expect(sr.displayLabel).not.toMatch(/书允（S\d/);
    for (const option of getBodySkillOptions("s11").filter((row) => row.rarity === "R" || row.rarity === "SR")) {
      expect(option.generation).toBeNull(); expect(option.identityLabel).not.toMatch(/^S\d/);
    }
    const detail = renderBodySlotCard(state).slice(renderBodySlotCard(state).indexOf('data-body-description'));
    expect(detail).toContain('<span class="tag">SR</span>'); expect(detail).not.toContain("SR / S");
  });
  it("preserves selected identity during filtering, escapes text, and renders an explicit empty card", () => {
    const html = renderBodySlotCard({ ...state, query: '"><img src=x onerror=1>', roleLabel: "<进攻>" });
    expect(html).not.toContain("<img"); expect(html).toContain("&lt;进攻&gt;");
    expect(html).toContain(`value="${SHUYUN}" selected`);
    const empty = renderBodySlotCard({ ...state, index: 3, selectedSkillId: "" });
    expect(empty).toContain("不配置车身技能"); expect(empty).toContain("技能说明 · 槽位4");
  });
});
