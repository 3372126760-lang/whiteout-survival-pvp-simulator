import { expertSkillLevels, GARETH_FOURTH_SKILL_ID, resolveExpertSkillEffect } from "../pvp/externalBuffs/expertSkills";

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderExpertSkillOptions(selectedLevel: number): string {
  const levels = [...expertSkillLevels(GARETH_FOURTH_SKILL_ID)];
  // An unconfigured selected level must remain visible instead of showing Lv0.
  if (!levels.includes(selectedLevel)) levels.push(selectedLevel);
  return levels.map((level) => `<option value="${escape(level)}" ${level === selectedLevel ? "selected" : ""}>${escape(resolveExpertSkillEffect(GARETH_FOURTH_SKILL_ID, level).displayText)}</option>`).join("");
}

export function renderExpertSkillDescription(level: number, shared = false): string {
  const resolved = resolveExpertSkillEffect(GARETH_FOURTH_SKILL_ID, level);
  return `<p class="${resolved.effectResolved ? "hint" : "field-error"}" data-expert-skill-effect-resolved="${resolved.effectResolved}">当前效果：${escape(resolved.effectText)}</p><p class="hint">作用范围：${shared ? "本侧三队共享，对敌方全军生效，单场只应用一次。" : "对敌方全军生效。"}</p>`;
}
