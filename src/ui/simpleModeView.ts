import { troopIcon } from "./gameArtwork";
import { renderHeroPortrait, renderHeroExpeditionArt } from "./heroArtwork";
import type { ValidationBattleInput, ValidationSideInput } from "../pvp/validationUi/types";
import { renderBatchSkillDamageStatistics } from "./skillStatisticsView";
import { APP_VERSION } from "../version";
import type { BatchSimulationResult, BatchMetricDistribution } from "../pvp/validationUi/batchSimulation";
import type { ThreeQueueBatchResult } from "../pvp/validationUi/threeQueueBatch";
import type { RallyTroopRatios } from "../pvp/validationUi/rallyDeployment";
import { TROOP_TYPES, type SideId, type TroopType } from "../pvp/types/combat";
import { SERVER_STAGES, getAvailableTroopLevels, isHeroAvailableAtStage } from "../pvp/progression/serverStage";
import { validationStageId } from "../pvp/validationUi/stageConfig";
import { getValidationCatalog } from "../pvp/validationUi/catalog";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../pvp/heroSkills/definitions/simpleHeroes";
import { battleSceneLabel } from "../pvp/scenario/scenePolicy";
import { canEditSimpleTroops, playerConfidence, simpleTroopRatios, simpleTroopTotal, validSimpleRatios, type EditorMode } from "./simpleMode";

export const DISPLAY_MODEL_VERSION = APP_VERSION;
const e = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const n = (value: number, decimals = 0): string => value.toLocaleString("zh-CN", { maximumFractionDigits: decimals });
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const troopNames = { shield: "盾兵", lancer: "矛兵", marksman: "射手" };
const troopIcons = { shield: troopIcon("shield"), lancer: troopIcon("lancer"), marksman: troopIcon("marksman") };

export function renderModeHeader(mode: EditorMode): string {
  return `<header class="mode-header"><div class="app-brand"><span class="brand-mark" aria-hidden="true">W</span><div><p class="eyebrow">${mode === "advanced" ? "WHITEOUT · ADVANCED" : "WHITEOUT · BATTLE LAB"}</p><h1>无尽冬日 PVP 战斗模拟器</h1><p class="subtitle">基于实际战报验证的非官方战斗模型 · Beta</p></div></div><div class="mode-header-right"><div class="mode-switch" role="group" aria-label="界面模式">${(["simple", "advanced"] as const).map((value) => `<button type="button" data-action="editor-mode" data-mode="${value}" aria-pressed="${mode === value}">${value === "simple" ? "普通模式" : "高级模式"}</button>`).join("")}</div><span class="model-version"><i></i> Model v${DISPLAY_MODEL_VERSION}</span></div></header>`;
}

export interface SimpleViewOptions {
  readonly input: ValidationBattleInput;
  readonly count: number;
  readonly running: boolean;
  readonly progress: number;
  readonly blocked: boolean;
  readonly result: BatchSimulationResult | ThreeQueueBatchResult | null;
  readonly troopModes: Record<SideId, "count" | "ratio">;
  readonly ratioDrafts: Record<SideId, RallyTroopRatios | null>;
  readonly detailsOpen: boolean;
  readonly developer?: boolean;
  readonly renderConfiguration?: (() => string) | undefined;
  readonly renderComparisons?: (() => string) | undefined;
  readonly renderAttributes: (side: SideId, value: ValidationSideInput) => string;
  readonly renderBuffs: (side: SideId, value: ValidationSideInput) => string;
  readonly renderMoreBuffs: (side: SideId, value: ValidationSideInput) => string;
  readonly renderFold: (key: string, summary: string, body: () => string) => string;
}

export function renderSimpleMode(options: SimpleViewOptions): string {
  const { input, result, running, progress, count } = options;
  const invalidRatio = (["A", "B"] as const).some((side) => options.troopModes[side] === "ratio" &&
    options.ratioDrafts[side] !== null && !validSimpleRatios(options.ratioDrafts[side]));
  const blocked = options.blocked || invalidRatio;
  return `<div class="simple-intro"><div><span class="simple-kicker">阵容对比，一目了然</span><h2>下一场交锋，谁更胜一筹？</h2><p>选好英雄、填入兵力，用多场模拟看看阵容的表现。</p></div><div class="simple-intro-actions"><span class="scene-pill">${e(battleSceneLabel(input))}</span><button class="btn btn-small" data-action="simple-share" ${invalidRatio ? "disabled" : ""}>↗ 分享阵容</button></div></div>
    <div class="simple-section-heading"><h2><span>01</span> 配置双方阵容</h2><p>A / B 使用相同的战斗规则</p></div>
    <fieldset class="simple-editor" ${running ? "disabled" : ""}><label class="simple-stage simple-global-stage">服务器阶段<select data-scope="server-stage">${SERVER_STAGES.map((stage) => `<option value="${stage.id}" ${stage.id === validationStageId(input) ? "selected" : ""}>${stage.label} · 最高 S${stage.maxHeroGeneration}</option>`).join("")}</select></label>${options.renderConfiguration ? options.renderConfiguration() : `<div class="simple-side-grid">${renderSimpleSide("A", input.sideA, options)}${renderSimpleSide("B", input.sideB, options)}</div>${options.renderComparisons?.() ?? ""}` }</fieldset>
    <section class="simple-run-card" aria-label="模拟设置"><div><h2><span class="step-number">02</span> 开始模拟</h2><p>多场独立战斗，观察胜率与兵力分布。</p></div><div class="simple-run-settings"><label>模拟次数<select data-scope="batch-count" ${running ? "disabled" : ""}>${[...new Set([100, 1000, 10000, count])].sort((a, b) => a - b).map((value) => `<option value="${value}" ${count === value ? "selected" : ""}>${n(value)} 场</option>`).join("")}</select></label><label class="simple-random"><input data-scope="simple-random" type="checkbox" ${input.simulationMode === "random" ? "checked" : ""} ${running ? "disabled" : ""}> 随机模拟</label><button class="btn btn-primary simple-cta" data-action="run-batch" ${running || blocked ? "disabled" : ""}>${running ? `模拟中 ${n(progress)} / ${n(count)}` : "开始模拟"}<span aria-hidden="true"> →</span></button></div>${running ? `<div class="simple-progress" role="status" aria-live="polite"><progress max="${count}" value="${progress}"></progress><span data-simple-progress>已完成 ${n(progress)} / ${n(count)} 场</span></div>` : ""}${blocked ? '<p class="simple-run-error" role="alert">请先检查配兵比例或完成高级配置中的待确认项目。</p>' : ""}</section>
    ${renderSimpleResults(result)}
    <footer class="simple-footer"><span>WHITEOUT BATTLE LAB <b>·</b> 非官方玩家工具</span><span>模拟结果供阵容比较参考，请结合实际战报判断。</span></footer>
    ${options.detailsOpen && result !== null ? renderSimpleDetails(result) : ""}`;
}

function renderSimpleSide(side: SideId, value: ValidationSideInput, options: SimpleViewOptions): string {
  const { input } = options, editable = canEditSimpleTroops(input, side);
  const complexScene = input.scenarioType !== undefined && !["SINGLE", "RALLY"].includes(input.scenarioType);
  return `<article class="simple-side side-${side.toLowerCase()}"><div class="simple-side-head"><h3><span>${side}</span> ${side === "A" ? "我方阵容" : "对比阵容"}</h3><span class="side-label">${side === "A" ? "AMBER" : "ICE"}</span></div><div class="simple-side-body">
    ${complexScene ? '<div class="simple-preserved">当前多队阵容已保留。<button class="simple-text-button" data-action="editor-mode" data-mode="advanced">在高级模式编辑队伍 →</button></div>' : `<div class="simple-heroes">${TROOP_TYPES.map((troop) => renderSimpleHero(side, value, troop, input, options.developer)).join("")}</div>`}
    ${options.renderComparisons ? "" : `<div class="simple-troop-heading"><h4>兵力配置</h4>${editable ? `<div class="simple-mini-switch" role="group" aria-label="${side}方兵量输入方式">${(["count", "ratio"] as const).map((mode) => `<button type="button" data-action="simple-troop-mode" data-side="${side}" data-value="${mode}" aria-pressed="${options.troopModes[side] === mode}">${mode === "count" ? "数量" : "比例"}</button>`).join("")}</div>` : ""}</div>
    ${editable ? renderSimpleTroops(side, value, options) : `<p class="simple-preserved">沿用高级模式的配兵与容量设置。<button class="simple-text-button" data-action="editor-mode" data-mode="advanced">查看配兵 →</button></p>`}
    ${complexScene ? "" : options.renderFold(`simple-attributes-${side}`, '<span>填写战报属性</span><small>攻击 / 防御 / 穿透 / 生命</small>', () => `<p class="hint">${input.attributeInputMode === "prediction" ? "当前为基础面板预测输入，沿用高级模式的历史阵容和加成设置。" : "填写最终战报百分数，已含英雄、专武与外部增益，不会重复叠加。"}</p>${options.renderAttributes(side, value)}<button class="btn btn-small" data-action="simple-copy-attributes" data-side="${side}">复制到另一方</button>`)}
    `}
    ${complexScene ? "" : options.renderFold(`simple-buffs-${side}`, '<span>增益与 Buff</span><small>城镇 / 宠物 / 专家 / 专武</small>', () => `<label>属性口径<select data-scope="player-attribute-source"><option value="report" ${input.attributeInputMode !== "prediction" ? "selected" : ""}>最终战报 · 已含增益</option><option value="base" ${input.attributeInputMode === "prediction" ? "selected" : ""}>基础面板 · 另行配置增益</option></select></label><p class="hint">${input.attributeInputMode === "prediction" ? "选择增益后自动用于当前战斗；历史战报的加成可在更多设置中调整。" : "增益可以编辑并保存。最终战报已含属性增益，当前模拟不再叠加；使用基础面板时按这些设置计算。"}</p>${options.renderBuffs(side, value)}${options.renderFold(`simple-more-buffs-${side}`, '<span>更多Buff设置</span><small>英雄专武 / 车身英雄 / 历史加成</small>', () => options.renderMoreBuffs(side, value))}`)}
  </div></article>`;
}

export function renderSimpleHero(side: SideId, value: ValidationSideInput, troop: TroopType, input: ValidationBattleInput, developer = false): string {
  const catalog = getValidationCatalog(), selectedId = value.leaderHeroIds?.[troop] ??
    (catalog.leaderHeroes.find((hero) => hero.heroId === value.leaderHeroId)?.troopType === troop ? value.leaderHeroId : null);
  const selected = catalog.leaderHeroes.find((hero) => hero.heroId === selectedId);
  const confidence = playerConfidence(CONFIRMED_HERO_SKILL_DEFINITIONS.filter((skill) => skill.heroId === selectedId).map((skill) => skill.metadata.ruleStatus));
  return `<div class="simple-hero"><div class="hero-avatar avatar-${troop}" aria-hidden="true">${selected ? renderHeroPortrait(selectedId) || e(selected.name.slice(0, 1)) : troopIcons[troop]}<small>${troopIcons[troop]}</small></div><label><span>${troopNames[troop]}英雄${selected?.generation ? `<b>S${selected.generation}</b>` : ""}</span><select data-scope="leader" data-side="${side}" data-troop="${troop}" aria-label="${side}方${troopNames[troop]}英雄"><option value="">未选择英雄</option>${catalog.leaderHeroes.filter((hero) => hero.troopType === troop && isHeroAvailableAtStage(hero, validationStageId(input))).map((hero) => `<option value="${e(hero.heroId)}" ${selectedId === hero.heroId ? "selected" : ""}>${e(hero.name)}${hero.generation ? ` · S${hero.generation}` : ""}</option>`).join("")}</select></label>${selected ? renderHeroExpeditionArt(selectedId!) : ""}${selected && developer ? `<details class="simple-confidence"><summary aria-label="${e(confidence.description)}" title="${e(confidence.description)}">${confidence.warning ? "⚠" : "✓"}</summary><p><strong>${confidence.label}</strong><br>${e(confidence.description)}<br>${[...new Set(CONFIRMED_HERO_SKILL_DEFINITIONS.filter((skill) => skill.heroId === selectedId).map((skill) => skill.metadata.ruleStatus))].map(e).join(" / ")}</p></details>` : ""}</div>`;
}

function renderSimpleTroops(side: SideId, value: ValidationSideInput, options: SimpleViewOptions): string {
  const mode = options.troopModes[side], total = simpleTroopTotal(options.input, side);
  const ratios = options.ratioDrafts[side] ?? simpleTroopRatios(options.input, side), valid = validSimpleRatios(ratios);
  return `<label class="simple-total"><span>总兵力</span><input data-scope="simple-total" data-side="${side}" type="number" inputmode="numeric" min="0" step="1" value="${total}"><span>人</span></label>
    ${mode === "ratio" ? `<div class="simple-presets" role="group" aria-label="${side}方配兵预设">${["50/0/50", "49/1/50", "60/10/30"].map((preset) => `<button data-action="simple-preset" data-side="${side}" data-value="${preset}" aria-pressed="${TROOP_TYPES.map((troop) => ratios[troop]).join("/") === preset}">${preset.split("/").join(" / ")}</button>`).join("")}<span>自定义</span></div>` : ""}
    <div class="simple-troop-inputs">${TROOP_TYPES.map((troop) => `<div><label><span>${troopIcons[troop]} ${troopNames[troop]}</span><div class="simple-input-unit"><input data-scope="${mode === "ratio" ? "simple-ratio" : "simple-count"}" data-side="${side}" data-troop="${troop}" type="number" inputmode="${mode === "ratio" ? "decimal" : "numeric"}" min="0" ${mode === "ratio" ? 'max="100" step="0.01"' : 'step="1"'} value="${mode === "ratio" ? ratios[troop] : value.troops[troop].count}">${mode === "ratio" ? "<em>%</em>" : ""}</div></label><select data-scope="troop" data-side="${side}" data-troop="${troop}" data-field="troopLevel" aria-label="${side}方${troopNames[troop]}等级">${getAvailableTroopLevels(validationStageId(options.input), troop).map((level) => `<option value="${level}" ${value.troops[troop].troopLevel === level ? "selected" : ""}>${level}</option>`).join("")}</select></div>`).join("")}</div>
    ${mode === "ratio" ? `<p class="simple-ratio-status ${valid ? "" : "field-error"}" role="status">${valid ? "✓" : "⚠"} 比例合计 ${n(TROOP_TYPES.reduce((sum, troop) => sum + ratios[troop], 0), 2)}%${valid ? "" : " · 请调整至 100%"}</p>` : ""}`;
}

export function simpleDifferences(value: BatchSimulationResult): string[] {
  const differences: string[] = [];
  const archers = value.expectedRemaining.A.marksman - value.expectedRemaining.B.marksman;
  differences.push(archers === 0 ? "双方射手平均剩余数量相同" : `${archers > 0 ? "A" : "B"}方射手平均多剩余 ${n(Math.abs(archers), 1)} 人`);
  const damage = value.averageDamage.A - value.averageDamage.B;
  const lowerDamage = Math.min(value.averageDamage.A, value.averageDamage.B);
  differences.push(damage === 0 ? "双方平均总伤害相同" : `${damage > 0 ? "A" : "B"}方平均总伤害${lowerDamage > 0 ? `高 ${pct(Math.abs(damage) / lowerDamage)}` : `多 ${n(Math.abs(damage))}（另一方为 0）`}`);
  const remaining = value.expectedRemaining.A.total - value.expectedRemaining.B.total;
  differences.push(remaining === 0 ? "双方平均剩余总兵力相同" : `${remaining > 0 ? "A" : "B"}方平均剩余总兵力多 ${n(Math.abs(remaining), 1)} 人`);
  const troopGap = TROOP_TYPES.map((troop) => ({ troop, delta: value.expectedRemaining.A[troop] - value.expectedRemaining.B[troop] }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]!;
  if (troopGap.delta !== 0) differences.push(`剩余兵力差距最大的是${troopNames[troopGap.troop]}，${troopGap.delta > 0 ? "A" : "B"}方平均多剩余 ${n(Math.abs(troopGap.delta), 1)} 人`);
  const paired = value.skillStatistics.filter((skill) => skill.side === "A").flatMap((a) => {
    const b = value.skillStatistics.find((skill) => skill.side === "B" && skill.skillId === a.skillId);
    return b ? [{ a, b, delta: (a.actualActivationCount - b.actualActivationCount) / value.simulationCount }] : [];
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (paired[0] && paired[0].delta !== 0) {
    const { a, delta } = paired[0];
    differences.push(`${e(a.skillName)}：${delta > 0 ? "A" : "B"}方平均每场多触发 ${n(Math.abs(delta), 2)} 次`);
  }
  return differences;
}

export function renderSimpleResults(value: SimpleViewOptions["result"]): string {
  if (value === null) return '<section class="simple-results simple-empty"><span aria-hidden="true">◫</span><div><h2>模拟结果将在这里呈现</h2><p>完成阵容后点击「开始模拟」，比较双方胜率与剩余兵力。</p></div></section>';
  if ("attackerWins" in value) return `<section class="simple-results"><div class="simple-result-heading"><h2><span class="step-number">03</span> 模拟结果</h2><span>${n(value.simulationCount)} 场三队战斗</span></div><div class="simple-win-grid">${winCard("A", value.attackerWinRate)}${winCard("B", value.defenderWinRate)}${winCard("未决", value.failedTrials / value.simulationCount)}</div><p class="hint">平均生还兵力 A ${n(value.avgAttackerSurvivors)} / B ${n(value.avgDefenderSurvivors)}。三队详细统计可在高级模式查看。</p><button class="btn" data-action="editor-mode" data-mode="advanced">在高级模式中查看 →</button></section>`;
  return `<section class="simple-results" id="simple-results"><div class="simple-result-heading"><h2><span class="step-number">03</span> 模拟结果 <span class="simple-complete">✓ 已完成</span></h2><span data-simple-result-count>${n(value.simulationCount)} 场模拟</span></div><div class="simple-win-grid">${winCard("A", value.winRates.A)}${winCard("B", value.winRates.B)}${winCard("平局", value.outcomes.draw / value.simulationCount)}</div><div class="simple-win-bar" aria-label="胜率分布"><i class="win-a" style="width:${value.winRates.A * 100}%"></i><i class="win-b" style="width:${value.winRates.B * 100}%"></i><i class="win-draw" style="width:${value.outcomes.draw / value.simulationCount * 100}%"></i><i class="win-timeout" style="width:${value.outcomes.timeout / value.simulationCount * 100}%"></i></div><div class="simple-result-meta"><span>平均战斗回合 <strong>${n(value.averageRounds, 1)}</strong></span><span>达到最大回合数 <strong>${pct(value.outcomes.timeout / value.simulationCount)}</strong></span></div>
    <div class="simple-survivor-grid">${(["A", "B"] as const).map((side) => `<article class="survivor-card survivor-${side.toLowerCase()}"><div><h3>${side}方平均剩余总兵力</h3><strong>${n(value.expectedRemaining[side].total, 1)} <small>人</small></strong></div><div class="survivor-troops">${TROOP_TYPES.map((troop) => `<span>${troopNames[troop]}<b>${n(value.expectedRemaining[side][troop], 1)}</b></span>`).join("")}</div><p>平均总伤害 <strong>${n(value.averageDamage[side])}</strong></p></article>`).join("")}</div><p class="simple-damage-note">伤害沿用模型口径：结算前取整伤害，包含溢出。</p>
    <div class="simple-differences"><h3>主要差异 <small>来自本次模拟统计</small></h3><ul>${simpleDifferences(value).map((item) => `<li>${item}</li>`).join("")}</ul><p>当前批量统计未记录盾兵退出回合与技能覆盖时长，暂不推断。</p></div><div class="simple-result-actions"><button class="btn" data-action="simple-details">查看详细结果 ↗</button><button class="simple-text-button" data-action="editor-mode" data-mode="advanced">在高级模式中查看 →</button></div></section>`;
}

function winCard(side: string, rate: number): string {
  return `<article class="simple-win-card win-${side.toLowerCase()}"><span>${side === "A" || side === "B" ? `${side}方胜率` : `${side}率`}</span><strong>${pct(rate)}</strong></article>`;
}

function metricRow(label: string, value: BatchMetricDistribution): string {
  return `<tr><th scope="row">${label}</th><td>${n(value.mean, 1)}</td><td>${n(value.p05)} – ${n(value.p95)}</td><td>${n(value.p50)}</td><td>${n(value.min)} – ${n(value.max)}</td></tr>`;
}

export function renderSimpleDetailsOnly(value: SimpleViewOptions["result"]): string {
  return value === null ? "" : renderSimpleDetails(value);
}

function renderSimpleDetails(value: NonNullable<SimpleViewOptions["result"]>): string {
  if ("attackerWins" in value) return "";
  return `<div class="simple-drawer-backdrop" data-action="simple-close-details"></div><section class="simple-drawer" role="dialog" aria-modal="true" aria-labelledby="simple-detail-title" tabindex="-1"><header><div><p class="eyebrow">BATTLE INSIGHTS</p><h2 id="simple-detail-title">详细模拟结果</h2></div><button class="btn" data-action="simple-close-details" aria-label="关闭详细结果">✕</button></header><div class="simple-drawer-body"><p class="hint">${n(value.simulationCount)} 场模拟 · 90%模拟区间为本批次 P5–P95，不代表均值的置信区间。</p><h3>剩余兵数分布与回合分布</h3><div class="simple-table-scroll"><table><thead><tr><th>统计项</th><th>均值</th><th>90%模拟区间</th><th>中位数</th><th>最小 – 最大</th></tr></thead><tbody>${metricRow("战斗回合", value.distributions.roundCount)}${(["A", "B"] as const).map((side) => [metricRow(`${side}方剩余总兵力`, value.distributions.sides[side].remaining.total), ...TROOP_TYPES.map((troop) => metricRow(`${side}方剩余${troopNames[troop]}`, value.distributions.sides[side].remaining[troop]))].join("")).join("")}</tbody></table></div><h3>输出与兵力退出</h3><p class="hint">当前未提供独立承伤汇总，使用正式统计中的退出兵数。</p><div class="simple-table-scroll"><table><thead><tr><th>阵营</th><th>平均总伤害</th><th>平均退出兵数</th><th>退出兵数 90%区间</th></tr></thead><tbody>${(["A", "B"] as const).map((side) => `<tr><th>${side}方</th><td>${n(value.averageDamage[side])}</td><td>${n(value.expectedExitedTotal[side], 1)}</td><td>${n(value.distributions.sides[side].exited.total.p05)} – ${n(value.distributions.sides[side].exited.total.p95)}</td></tr>`).join("")}</tbody></table></div><h3>概率技能判定与触发</h3><div class="simple-table-scroll"><table><thead><tr><th>阵营</th><th>技能</th><th>平均触发 / 场</th><th>概率判定成功率</th></tr></thead><tbody>${value.skillStatistics.length ? value.skillStatistics.map((skill) => `<tr><td>${skill.side}方</td><th>${e(skill.skillName)}</th><td>${n(skill.actualActivationCount / value.simulationCount, 2)}</td><td>${skill.actualTriggerRate === null ? "—" : pct(skill.actualTriggerRate)}</td></tr>`).join("") : '<tr><td colspan="4">本次没有概率技能统计。</td></tr>'}</tbody></table></div><h3>技能退出与击败归因</h3>${renderBatchSkillDamageStatistics(value)}</div><footer><button class="btn btn-primary" data-action="editor-mode" data-mode="advanced">在高级模式中查看 →</button></footer></section>`;
}
