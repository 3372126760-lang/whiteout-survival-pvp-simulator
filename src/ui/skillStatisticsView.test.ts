import { beforeAll, describe, expect, it } from "vitest";
import { runValidationBattle } from "../pvp/validationUi/adapter";
import { runBatchSimulation } from "../pvp/validationUi/batchSimulation";
import { ligeiaDamagePoolInput, LIGEIA_TWO, LIGEIA_THREE } from "../pvp/tests/fixtures/skillDamagePool";
import { renderBatchSkillDamageStatistics, renderSingleSkillDamageStatistics, skillStatisticsExport, skillTriggerRecords, compactSkillTriggerRecords } from "./skillStatisticsView";
import { renderAdvancedBatchDrawer, renderAdvancedStatistics, renderPlayerSingleDrawer } from "./advancedModeView";
import { renderSimpleDetailsOnly } from "./simpleModeView";

let single: ReturnType<typeof runValidationBattle>;
let batch: ReturnType<typeof runBatchSimulation>;
beforeAll(() => {
  const input = ligeiaDamagePoolInput(true);
  single = runValidationBattle(input);
  batch = runBatchSimulation(input, 2);
});

function assertColumns(html: string) {
  expect(html).toContain("技能名称</th>");
  expect(html).toContain("触发次数</th>");
  expect(html).toContain("退出战斗人数</th>");
  expect(html).not.toContain("击败（估算）</th>");
  expect(html).toContain("不再换算战后击败或受伤分类");
  for (const id of [LIGEIA_TWO, LIGEIA_THREE]) {
    expect(html).toContain(skillStatisticsExport(single).rows.find((r) => r.skillId === id)!.name);
    expect(html).not.toContain(id);
  }
}

describe("shared skill exit/defeat statistics views and export", () => {
  it("keeps exits immediately before estimated defeats in single details", () => {
    assertColumns(renderSingleSkillDamageStatistics(single));
    assertColumns(renderPlayerSingleDrawer(single));
  });
  it("uses the same columns and actual deterministic skills in every batch statistics entry", () => {
    for (const html of [renderBatchSkillDamageStatistics(batch), renderAdvancedStatistics(batch),
      renderAdvancedBatchDrawer(batch), renderSimpleDetailsOnly(batch)]) assertColumns(html);
    const row = skillStatisticsExport(batch).rows.find((r) => r.skillId === LIGEIA_THREE)!;
    expect(row.activations).toBe(1);
    expect(row.contribution!.exited).toBeGreaterThan(0);
  });
  it("exports unrounded contributions and actual totals without rerunning or mutating battle data", () => {
    const before = JSON.stringify(single);
    const exported = JSON.parse(JSON.stringify(skillStatisticsExport(single)));
    expect(exported.statistics).toEqual(single.skillDamageStatistics);
    expect(exported.rows.find((r: { skillId: string }) => r.skillId === LIGEIA_THREE).contribution)
      .toEqual(single.skillDamageStatistics!.bySide.A[LIGEIA_THREE]);
    expect(exported.firstSeed).toBe(single.input.randomSeed);
    expect(JSON.stringify(single)).toBe(before);
    expect(skillStatisticsExport(batch).simulationCount).toBe(2);
  });
  it("preserves old exits while refusing to invent defeats for records without source metadata", () => {
    const { skillDamageStatistics: _stats, skillActivationCounts: _activations, ...legacy } = batch;
    void _stats; void _activations;
    legacy.meanSkillCasualties = { A: { [LIGEIA_THREE]: 123.25 }, B: {} };
    const html = renderBatchSkillDamageStatistics(legacy);
    expect(html).toContain("123");
    expect(html).toContain("旧结果未采集完整技能归因");
    expect(html).toContain("旧记录，来源未校验");
  });
  it("marks an unconfirmed conversion as unknown while retaining the original exit contribution", () => {
    const statistics = structuredClone(single.skillDamageStatistics!);
    statistics.bySide.A[LIGEIA_THREE]!.defeatedEstimate = null;
    const html = renderSingleSkillDamageStatistics({ ...single, skillDamageStatistics: statistics });
    const name = skillStatisticsExport(single).rows.find((r) => r.skillId === LIGEIA_THREE)!.name;
    const row = html.split("</tr>").find((row) => row.includes(name))!;
    expect(row).toContain(Math.round(statistics.bySide.A[LIGEIA_THREE]!.exited).toLocaleString("zh-CN"));
    expect(html).toContain("单一事件结算");
    expect(row).not.toContain("旧记录");
  });
});

it("separates A/B and orders troop and body sections without dropping statistics",()=>{
 const html=renderSingleSkillDamageStatistics(single);
 expect(html.indexOf('aria-label="A方技能统计"')).toBeLessThan(html.indexOf('aria-label="B方技能统计"'));
 const a=html.split('aria-label="B方技能统计"')[0]!;
 const labels=["盾兵 · 英雄技能","盾兵 · 兵种技能","矛兵 · 英雄技能","矛兵 · 兵种技能","射手 · 英雄技能","射手 · 兵种技能","车身技能"];
 labels.slice(1).forEach((label,index)=>expect(a.indexOf(labels[index]!)).toBeLessThan(a.indexOf(label)));
 for(const row of skillStatisticsExport(single).rows.filter(r=>!r.skillId.startsWith("hero-weapon-skill."))) expect(html).toContain(row.name);
});

it("folds diagnostics and shows real single-battle trigger rounds, with no invented batch records",()=>{
 const before=JSON.stringify(single);
 const html=renderSingleSkillDamageStatistics(single);
 expect(html).not.toContain("HP伤害贡献</th>");
 expect(html).not.toContain("退出归因</th>");
 expect(html).toContain('<details class="skill-row-details">');
 expect(html).toContain('<details class="skill-trigger-details">');
 expect(html).not.toContain('<details class="skill-trigger-details" open');
 const records=skillTriggerRecords(single,"A",LIGEIA_THREE);
 const actual=single.trace.rounds.flatMap(round=>round.heroSkills.filter(s=>s.side==="A" && s.skillId===LIGEIA_THREE && s.triggered));
 expect(records.map(r=>r.round)).toEqual(actual.map(r=>r.round));
 expect(records.map(r=>r.description)).toEqual(actual.map(r=>r.uiSummary));
 expect(records.length).toBeGreaterThan(0);
 for(const record of records) expect(html).toContain(`第 ${record.round} 回合`);
 expect(renderBatchSkillDamageStatistics(batch)).toContain("未保存每场回合记录");
 expect(JSON.stringify(single)).toBe(before);
});

it("places compact round records below each skill across the full table width", () => {
 const html = renderSingleSkillDamageStatistics(single);
 expect(html).toContain('<tr class="skill-detail-row"><td colspan="3"');
 expect(html).not.toContain("展开详情</th>");
 expect(html).not.toContain("技能说明：");
 expect(html).not.toContain("发动兵种：");
 const records = compactSkillTriggerRecords(single, "A", LIGEIA_THREE);
 expect(new Set(records.map(record => record.round)).size).toBe(records.length);
 expect(records.length).toBeGreaterThan(0);
 for (const record of records) {
   const raw = skillTriggerRecords(single, "A", LIGEIA_THREE).filter(r => r.round === record.round);
   const events = new Map(raw.flatMap(r => r.damageEvents.map(e => [e.id, e.damage] as const)));
   expect(record.damage).toBe([...events.values()].reduce((sum, value) => sum + value, 0));
 }
});

it("reports Rufus independent events with exact integer exits", () => {
 const base = ligeiaDamagePoolInput(true);
 const input = { ...base, sideA: { ...base.sideA, leaderHeroIds: { marksman: "hero.s11.rufus" } } };
 const result = runValidationBattle(input);
 const id = "hero-skill.rufus.armor-breaking-strike";
 const events = result.trace.rounds.flatMap(r => r.damageEvents).filter(e => e.sourceSide === "A" && e.sourceSkillId === id);
 expect(events.length).toBeGreaterThan(0);
 expect(events.every(e => e.skillPoolComponents === undefined)).toBe(true);
 const contribution = result.skillDamageStatistics!.bySide.A[id]!;
 expect(contribution.estimated).toBe(false);
 expect(Number.isInteger(contribution.exited)).toBe(true);
 expect(compactSkillTriggerRecords(result,"A",id).reduce((s,r)=>s+r.damage,0)).toBeCloseTo(contribution.roundedDamage,3);
});

it("shows integer totals and per-round estimated defeats split by enemy troop, preserving export precision", () => {
 const before = JSON.stringify(single);
 const records = compactSkillTriggerRecords(single, "A", LIGEIA_THREE);
 const total = records.flatMap(r => r.exits).reduce((sum, r) => sum + (r.count ?? 0), 0);
 expect(total).toBeCloseTo(single.skillDamageStatistics!.bySide.A[LIGEIA_THREE]!.exited, 6);
 const html = renderSingleSkillDamageStatistics(single);
 expect(html).toContain("敌方盾兵");
 expect(html).toContain("skill-round-table");
 expect(html).toContain("<th>退出战斗</th><th>对应兵种</th>");
 expect(html).not.toMatch(/<strong>击败 /);
 expect(html).not.toMatch(/<strong>伤害 /);
 expect(JSON.stringify(single)).toBe(before);
});

it("hides weapon buff rows without changing the underlying statistics and exports", () => {
 const base = ligeiaDamagePoolInput(true);
 const input = { ...base, scenarioType: "RALLY" as const, attributeInputMode: "prediction" as const, sideA: { ...base.sideA,
  leaderHeroIds: { marksman: "hero.s11.rufus" }, simulationWeaponLevels: { "hero.s11.rufus": 10 } } };
 const result = runValidationBattle(input);
 const before = JSON.stringify(result);
 const weapons = skillStatisticsExport(result).rows.filter(row=>row.skillId.startsWith("hero-weapon-skill."));
 expect(weapons.length).toBeGreaterThan(0);
 const html = renderSingleSkillDamageStatistics(result);
 for(const row of weapons) expect(html).not.toContain(row.name);
 expect(JSON.stringify(result)).toBe(before);
});
it("retains zero-exit direct events instead of blank cells", () => {
 const records=compactSkillTriggerRecords(single,"A",LIGEIA_THREE);
 expect(records.every(r=>r.emptyReason.length > 0)).toBe(true);
 const html=renderSingleSkillDamageStatistics(single);
 expect(html).not.toContain("<td></td><td></td>");
});

it("shows zero when the normal attack already eliminated the locked target", () => {
 const base=ligeiaDamagePoolInput(false);
 const result=runValidationBattle({...base,
  sideA:{...base.sideA,leaderHeroIds:{marksman:"hero.s11.rufus"}},
  sideB:{...base.sideB,troops:{...base.sideB.troops,shield:{...base.sideB.troops.shield,count:1}}}});
 const records=compactSkillTriggerRecords(result,"A","hero-skill.rufus.armor-breaking-strike");
 expect(records.length).toBeGreaterThan(0);
 expect(records[0]!.damage).toBeGreaterThan(0);
 expect(records[0]!.exits).toEqual([]);
 expect(records[0]!.emptyReason).toBe("目标已先行退出");
 expect(renderSingleSkillDamageStatistics(result)).toContain('title="目标已先行退出">0</td><td>敌方盾兵');
});
