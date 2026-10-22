import { beforeAll, describe, expect, it } from "vitest";
import { runValidationBattle } from "../pvp/validationUi/adapter";
import { runBatchSimulation } from "../pvp/validationUi/batchSimulation";
import { ligeiaDamagePoolInput, LIGEIA_TWO, LIGEIA_THREE } from "../pvp/tests/fixtures/skillDamagePool";
import { renderBatchSkillDamageStatistics, renderSingleSkillDamageStatistics, skillStatisticsExport } from "./skillStatisticsView";
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
  expect(html).toMatch(/退出战斗人数<\/th><th>(平均)?击败（估算）<\/th>/);
  expect(html).toContain("不是游戏真实技能击败");
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
    expect(html).toContain("123.25");
    expect(html).toContain("击败标为未确认");
    expect(html).toContain("旧记录，来源未校验");
  });
  it("marks an unconfirmed conversion as unknown while retaining the original exit contribution", () => {
    const statistics = structuredClone(single.skillDamageStatistics!);
    statistics.bySide.A[LIGEIA_THREE]!.defeatedEstimate = null;
    const html = renderSingleSkillDamageStatistics({ ...single, skillDamageStatistics: statistics });
    const name = skillStatisticsExport(single).rows.find((r) => r.skillId === LIGEIA_THREE)!.name;
    const row = html.split("</tr>").find((row) => row.includes(name))!;
    expect(row).toContain("未确认");
    expect(row).toContain("比例估算");
    expect(row).not.toContain("旧记录");
  });
});
