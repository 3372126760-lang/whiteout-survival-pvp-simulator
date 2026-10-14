import { renderExpertSkillOptions, renderExpertSkillDescription } from "./expertSkillView";
import { TROOP_TYPES, type SideId, type TroopType } from "../pvp/types/combat";
import { getValidationThreeQueues } from "../pvp/validationUi/adapter";
import { iceFireSharedContext } from "../pvp/validationUi/iceFireContext";
import { iceFireQueueConversionAudit } from "../pvp/validationUi/iceFireAudit";
import { getAvailableTroopLevels } from "../pvp/progression/serverStage";
import { validationStageId } from "../pvp/validationUi/stageConfig";
import { getValidationCatalog } from "../pvp/validationUi/catalog";
import { isHeroAvailableAtStage } from "../pvp/progression/serverStage";
import { formatValidationHeroOption } from "../pvp/validationUi/presentation";
import { PET_DEFENSE_REDUCTION_LEVELS, PET_PENETRATION_REDUCTION_LEVELS, PET_LIFE_REDUCTION_LEVELS, STANDARD_PET_LEVELS } from "../pvp/externalBuffs/data";
import type { ValidationBattleInput, ValidationQueueAttributes } from "../pvp/validationUi/types";
import type { ThreeQueueCandidateEvaluation } from "../pvp/optimizer/threeQueueOptimizer";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const troops = { shield: "盾", lancer: "矛", marksman: "射" };
const stats = { attack: "攻击", defense: "防御", penetration: "穿透", life: "生命" };
const heroName = (id: string) => getValidationCatalog().leaderHeroes.find((hero) => hero.heroId === id)?.name ?? id;

export function renderIceFireAttributeDelta(report: ValidationQueueAttributes | undefined, expected: ValidationQueueAttributes): string {
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>属性</th><th>历史战报 %</th><th>预期属性 %</th><th>变化 pct</th></tr></thead><tbody>${TROOP_TYPES.flatMap((troop) => Object.entries(stats).map(([stat, name]) => {
    const key = stat as keyof typeof stats, before = report?.[troop][key], after = expected[troop][key];
    return `<tr><td>${troops[troop]}${name}</td><td>${before?.toFixed(2) ?? "—"}</td><td>${after.toFixed(2)}</td><td>${before === undefined ? "—" : (after - before).toFixed(2)}</td></tr>`;
  })).join("")}</tbody></table></div>`;
}
export function renderIceFirePermutationMetrics(row: ThreeQueueCandidateEvaluation, side: SideId): string {
  const metrics = row.permutationAudit;
  if (!metrics) return "";
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`, enemy = side === "A" ? "B" : "A";
  const order = (values: readonly number[]) => values.map((index) => `${enemy}${index + 1}`).join(" → ");
  return `<dl class="optimizer-card-details"><dt>当前敌方顺序胜率</dt><dd>${pct(metrics.currentOrderWinRate)}</dd><dt>${metrics.permutationResults.length}排列平均胜率</dt><dd>${pct(metrics.averagePermutationWinRate)}</dd><dt>最坏换位胜率</dt><dd>${pct(metrics.worstPermutationWinRate)}</dd><dt>最危险敌方顺序</dt><dd>${order(metrics.worstEnemyOrder)}</dd><dt>最佳敌方顺序</dt><dd>${order(metrics.bestEnemyOrder)}</dd></dl><p class="hint">各排列样本：${metrics.permutationResults.map((p) => `${order(p.order)}：${p.trials}场`).join("；")}</p>`;
}
export function renderIceFireCandidateConversion(row: ThreeQueueCandidateEvaluation): string {
  return row.convertedQueueAudit?.map((audit, index) => `<details><summary>Q${index + 1} 历史 → 推荐属性</summary><p>历史英雄：${escape(audit.reportHeroIds.map(heroName).join(" / ") || "不配置")}</p><p>预期英雄：${escape(audit.expectedHeroIds.map(heroName).join(" / ") || "不配置")}</p>${renderIceFireAttributeDelta(audit.reportAttributes, audit.expectedAttributesAfterHeroConversion)}<details><summary>转换来源审计</summary><pre>${escape(JSON.stringify(audit, null, 2))}</pre></details></details>`).join("") ?? "";
}
/** Side context is displayed once; every card edits a complete independent queue. */
export function renderIceFireSide(input: ValidationBattleInput, sideId: SideId, queueFooter?: (index: number) => string,
  developer = true, fold: (key: string, title: string, body: () => string) => string =
    (_key, title, body) => `<details><summary>${title}</summary>${body()}</details>`): string {
  const side = input[sideId === "A" ? "sideA" : "sideB"], shared = iceFireSharedContext(side);
  const queues = getValidationThreeQueues(side), stage = validationStageId(input), catalog = getValidationCatalog();
  const petFields = [
    ["attackLevel", "攻击", STANDARD_PET_LEVELS], ["defenseLevel", "防御", STANDARD_PET_LEVELS],
    ["penetrationLevel", "穿透", STANDARD_PET_LEVELS], ["lifeLevel", "生命", STANDARD_PET_LEVELS],
    ["enemyDefenseReductionLevel", "敌方防御减益", PET_DEFENSE_REDUCTION_LEVELS],
    ["enemyPenetrationReductionLevel", "敌方穿透减益", PET_PENETRATION_REDUCTION_LEVELS],
    ["enemyLifeReductionLevel", "敌方生命减益", PET_LIFE_REDUCTION_LEVELS],
  ] as const;
  const sharedForm = `<h3>三队共享宠物 / 专家</h3><div class="queue-levels">${petFields.map(([field, label, values]) => `<label>宠物${label}<select data-scope="ice-fire-shared" data-side="${sideId}" data-group="petContext" data-field="${field}">${values.map((value, level) => `<option value="${level}" ${shared.petContext[field] === level ? "selected" : ""}>Lv${level} · ${(value * 100).toFixed(1)}%</option>`).join("")}</select></label>`).join("")}<label>专家四技能<select data-scope="ice-fire-shared" data-side="${sideId}" data-group="expertContext" data-field="garethFourthSkillLevel">${renderExpertSkillOptions(shared.expertContext.garethFourthSkillLevel)}</select></label></div>${renderExpertSkillDescription(shared.expertContext.garethFourthSkillLevel, true)}<p class="hint">每个子战斗引用一次本侧共享上下文；换队时宠物和专家留在本侧。</p>${shared.migrationWarnings?.map((warning) => `<p class="field-error">${escape(warning)}</p>`).join("") ?? ""}`;
  const cards = queues.map((queue, index) => {
    const lineage = queue.reportHeroByTroop ?? queue.leaderHeroIds;
    const heroFields = (kind: "report" | "expected") => TROOP_TYPES.map((troop) => {
      const id = (kind === "report" ? lineage : queue.leaderHeroIds)[troop];
      const levels = kind === "report" ? queue.reportWeaponLevels : queue.weaponLevels;
      return `<label>${troops[troop]}英雄<select data-scope="${kind === "report" ? "queue-report-hero" : "queue-hero"}" data-side="${sideId}" data-queue-index="${index}" data-troop="${troop}"><option value="" ${!id ? "selected" : ""}>不配置</option>${catalog.leaderHeroes.filter((hero) => hero.troopType === troop && (kind === "report" || isHeroAvailableAtStage(hero, stage))).map((hero) => `<option value="${escape(hero.heroId)}" ${id === hero.heroId ? "selected" : ""}>${escape(formatValidationHeroOption(hero))}</option>`).join("")}</select></label><label>${troops[troop]}专武<select data-scope="${kind === "report" ? "queue-report-weapon" : "queue-weapon"}" data-side="${sideId}" data-queue-index="${index}" data-hero-id="${escape(id)}" ${id ? "" : "disabled"}>${Array.from({ length: 11 }, (_, level) => `<option value="${level}" ${level === (id ? levels?.[id] ?? 0 : 0) ? "selected" : ""}>Lv${level}</option>`).join("")}</select></label>`;
    }).join("");
    const report = queue.sourceReportAttributes ?? queue.attributes!;
    const attrs = TROOP_TYPES.flatMap((troop) => Object.entries(stats).map(([stat, name]) => `<label>${troops[troop]}${name}<input type="text" inputmode="decimal" data-scope="queue-attribute" data-side="${sideId}" data-queue-index="${index}" data-troop="${troop}" data-field="${stat}" value="${report[troop][stat as keyof typeof stats]}">%</label>`)).join("");
    let conversion = "";
    try { const audit = iceFireQueueConversionAudit(input, sideId, index); conversion = developer
      ? `<details><summary>本队属性来源调试（高级） · 预期属性及转换审计</summary>${renderIceFireAttributeDelta(audit.reportAttributes, audit.expectedAttributesAfterHeroConversion)}<pre>${escape(JSON.stringify(audit, null, 2))}</pre></details>`
      : fold(`player-queue-expected-${sideId}-${index}`, "查看预期战报属性", () => renderIceFireAttributeDelta(audit.reportAttributes, audit.expectedAttributesAfterHeroConversion)); }
    catch (error) { conversion = `<p class="field-error">${escape(error instanceof Error ? error.message : error)}</p>`; }
    const historical = `<h4>历史战报英雄 / 专武（固定来源）</h4><div class="queue-heroes">${heroFields("report")}</div><h4>本队历史战报属性</h4><div class="report-attributes">${attrs}</div><p class="hint">历史特殊加成按本队保存，预期英雄改变时重算预期属性。</p>`;
    return `<article class="queue-card"><h3>${sideId}${index + 1}</h3>${developer ? historical : fold(`player-queue-history-${sideId}-${index}`, "战报属性与历史英雄", () => historical)}<h4>预期英雄 / 专武</h4><div class="queue-heroes">${heroFields("expected")}</div><h4>兵种等级 / T12技能 / 比例</h4><div class="queue-levels">${TROOP_TYPES.map((troop: TroopType) => `<label>${troops[troop]}等级<select data-scope="queue-level" data-side="${sideId}" data-queue-index="${index}" data-troop="${troop}">${getAvailableTroopLevels(stage, troop).map((level) => `<option value="${level}" ${queue.troopLevels?.[troop] === level ? "selected" : ""}>${level}</option>`).join("")}</select></label><label>${troops[troop]}T12<select data-scope="queue-t12" data-side="${sideId}" data-queue-index="${index}" data-troop="${troop}">${Array.from({ length: 25 }, (_, level) => `<option value="${level}" ${level === (queue.t12Levels?.[troop] ?? side.troops[troop].t12Level ?? 0) ? "selected" : ""}>Lv${level}</option>`).join("")}</select></label><label>${troops[troop]}比例<input type="text" inputmode="decimal" data-scope="queue-ratio" data-side="${sideId}" data-queue-index="${index}" data-troop="${troop}" value="${queue.ratios[troop]}">%</label>`).join("")}</div>${queueFooter?.(index) ?? ""}${conversion}</article>`;
  }).join("");
  return `<section class="panel side-panel"><header class="panel-head"><h2>${sideId} 方冰火战歌三队</h2></header><div class="panel-body"><label>每队出征容量<input type="number" data-scope="deployment-capacity" data-side="${sideId}" value="${side.deploymentCapacity ?? TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0)}"></label>${developer ? sharedForm : fold(`player-queue-buffs-${sideId}`, "三队共用宠物与专家", () => sharedForm)}<div class="profile-actions">${[[0,1],[1,2],[0,2]].map(([first, second]) => `<button class="btn btn-small" data-action="swap-ice-fire-queues" data-side="${sideId}" data-first="${first}" data-second="${second}">${first! + 1}队 ↔ ${second! + 1}队</button>`).join("")}</div><div class="queue-grid">${cards}</div></div></section>`;
}
