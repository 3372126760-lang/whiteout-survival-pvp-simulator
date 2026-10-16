import { BODY_EFFECT_CATEGORIES, bodySkillMatchesQuery, getBodySkillOptions, presentBodySkill,
  type BodySkillPresentation } from "./bodySkillPresentation";
import type { ServerStageId } from "../pvp/progression";
import type { SideId } from "../pvp/types";
import { renderBodySlotCardMarkup, type BodySlotCardState } from "./bodySlotCard";
import { CanonicalBodyEffectRegistry } from "../pvp/bodyEffects/canonicalRegistry";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export interface BodySkillSelectState {
  readonly side: SideId;
  readonly index: number;
  readonly stage: ServerStageId;
  readonly selectedSkillId: string;
  readonly selectedLevel: number;
  readonly query: string;
}

export function bodySkillOptionsView(state: BodySkillSelectState): { html: string; status: string } {
  const canonical = new CanonicalBodyEffectRegistry(undefined, state.stage).forSkill(state.selectedSkillId)?.representative.id;
  const options = getBodySkillOptions(state.stage).map((option) => {
    if (option.skillId !== canonical) return option;
    const actual = presentBodySkill(state.selectedSkillId, state.selectedLevel)!;
    return { ...actual, heroName: option.heroName,
      displayLabel: `${option.heroName}（${option.generation === null ? option.rarity : `S${option.generation}`}）｜${actual.effectSummary}｜${actual.timingSummary}` };
  });
  const matches = options.filter((option) => bodySkillMatchesQuery(option, state.query));
  const renderOption = (option: BodySkillPresentation) => `<option value="${escapeHtml(option.skillId)}" ${option.skillId === state.selectedSkillId ? "selected" : ""} title="${escapeHtml(`${option.skillName} · Lv${option.level}：${option.effectSummary}；${option.timingSummary}；${option.skillDescription}`)}">${escapeHtml(option.displayLabel)}</option>`;
  const selected = options.find((option) => option.skillId === state.selectedSkillId);
  const hiddenSelection = selected && !matches.includes(selected)
    ? `<optgroup label="当前选择（未匹配搜索）">${renderOption(selected)}</optgroup>` : "";
  const groups = BODY_EFFECT_CATEGORIES.map((category) => {
    const rows = matches.filter((option) => option.category === category);
    return rows.length ? `<optgroup label="${escapeHtml(category)}">${rows.map(renderOption).join("")}</optgroup>` : "";
  }).join("");
  return { html: `<option value="" ${state.selectedSkillId ? "" : "selected"}>不配置</option>${hiddenSelection}${groups}`,
    status: `${matches.length} / ${options.length} 项${matches.length ? "" : " · 无匹配项，请调整关键词"}${hiddenSelection ? " · 当前选择保留" : ""}` };
}

export function renderBodySlotCard(state: BodySlotCardState): string {
  return renderBodySlotCardMarkup(state, bodySkillOptionsView(state));
}

/** Compatibility entry point: the existing selector now renders as one complete slot card. */
export const renderBodySkillSelect = renderBodySlotCard;
