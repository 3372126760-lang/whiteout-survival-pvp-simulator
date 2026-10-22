import { renderHeroPortrait, renderSkillArt } from "./heroArtwork";
import { presentBodySkill } from "./bodySkillPresentation";
import { isHeroAvailableAtStage } from "../pvp/progression";
import type { BodySkillSelectState } from "./bodySkillSelectView";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export interface BodySlotCardState extends BodySkillSelectState {
  /** Role belongs to the caller's scenario; the display never infers combat rules. */
  readonly roleLabel?: string;
  readonly developer?: boolean;
}

/** One slot owns its filter, selector, selection summary and full description.
 * Existing data-scope/data-side/data-index events are retained without storing UI metadata. */
export function renderBodySlotCardMarkup(state: BodySlotCardState, view: { readonly html: string; readonly status: string }): string {
  if (!Number.isSafeInteger(state.index) || state.index < 0 || state.index > 3) throw new RangeError("车身槽位必须为 1–4。");
  const restored = presentBodySkill(state.selectedSkillId, state.selectedLevel);
  const selected = restored && isHeroAvailableAtStage(restored.heroId, state.stage) ? restored : undefined;
  const prefix = `member-${state.side}-${state.index}`, slotNumber = state.index + 1;
  const title = `${state.roleLabel ?? `${state.side}方`} · 车身槽位${slotNumber}`;
  const category = selected ? selected.generation === null ? selected.rarity : `${selected.rarity} / S${selected.generation}` : "";
  const summary = selected ? `<div class="body-slot-current" data-body-current-summary>
      <span class="body-slot-section-label">当前选中</span>
      <strong class="hero-art-name">${renderHeroPortrait(selected.heroId)}${escapeHtml(selected.heroName)}（${escapeHtml(selected.generation === null ? selected.rarity : `S${selected.generation}`)}）</strong>
      <span>${escapeHtml(selected.effectSummary)}</span>
    </div>` : `<div class="body-slot-current body-slot-empty" data-body-current-summary><span class="body-slot-section-label">当前选中</span><span>不配置车身技能</span></div>`;
  const detail = selected ? `<section class="member-detail body-slot-description" aria-labelledby="${prefix}-detail-title" data-body-description data-side="${state.side}" data-index="${state.index}">
      <h5 id="${prefix}-detail-title">技能说明 · 槽位${slotNumber}</h5>
      <div class="member-detail-heading"><strong>${escapeHtml(selected.heroName)}</strong><span class="tag">${escapeHtml(category)}</span>${state.developer && selected.provisional ? '<span class="tag tag-amber">规则待验证</span>' : ""}</div>
      <div class="skill-art-name">${renderSkillArt(selected.skillId)}远征一技能：${escapeHtml(selected.skillName)} · Lv${selected.level}</div>
      <div class="member-current-effect">当前等级效果：${escapeHtml(selected.effectSummary)}</div>
      <div>触发：${escapeHtml(selected.timingSummary)}</div>
      <div>技能说明：${escapeHtml(selected.skillDescription)}</div>
    </section>` : `<section class="member-detail body-slot-description" aria-labelledby="${prefix}-detail-title" data-body-description data-side="${state.side}" data-index="${state.index}"><h5 id="${prefix}-detail-title">技能说明 · 槽位${slotNumber}</h5><p class="hint">选择英雄技能后，完整说明会显示在本槽位卡片内。</p></section>`;
  return `<section class="member-slot body-slot-card" data-member-slot data-body-slot-card data-side="${state.side}" data-index="${state.index}" aria-labelledby="${prefix}-title">
    <header class="body-slot-heading"><span class="body-slot-number" aria-hidden="true">${slotNumber}</span><h4 id="${prefix}-title">${escapeHtml(title)}</h4></header>
    <div class="body-slot-controls">
      <label for="${prefix}-search">筛选条件
        <input id="${prefix}-search" data-scope="member-search" data-side="${state.side}" data-index="${state.index}" type="search" value="${escapeHtml(state.query)}" placeholder="攻击 / 25% / 书允 / SR / S7" autocomplete="off" aria-describedby="${prefix}-status">
      </label>
      <label for="${prefix}-select">当前选择
        <select id="${prefix}-select" data-scope="member" data-side="${state.side}" data-index="${state.index}" aria-describedby="${prefix}-status ${prefix}-detail-title">${view.html}</select>
      </label>
      <small id="${prefix}-status" class="member-search-status" data-member-search-status role="status">${escapeHtml(view.status)}</small>
    </div>
    ${summary}${detail}
  </section>`;
}
