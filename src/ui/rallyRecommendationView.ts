import { getValidationCatalog } from "../pvp/validationUi";
import { TROOP_TYPES } from "../pvp/types";
import type { RallyCandidate } from "../pvp/optimizer/types";
import { recallSourceLabel, renderJointCandidateDiagnostics } from "./jointCandidateView";
const catalog = getValidationCatalog();
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function compressedRallyBodyNames(ids: readonly string[]): string {
  const names = ids.map((id) => {
    const entry = catalog.memberSkills.find((s) => s.sourceSkillIds.includes(id));
    const heroId = entry?.sourceHeroIds[entry.sourceSkillIds.indexOf(id)];
    return catalog.leaderHeroes.find((h) => h.heroId === heroId)?.name ?? "未识别英雄";
  });
  const counts = new Map<string, number>(); for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(" / ") || "无车身";
}
export function rallyRecommendationDetails(candidate: RallyCandidate, fallbackTiers: readonly string[], developer = false): string {
  const head = TROOP_TYPES.map((t) => {
    const id = candidate.leaderHeroIds[t], name = catalog.leaderHeroes.find((h) => h.heroId === id)?.name ?? "未配置";
    return id ? `${name} · 专武 Lv${candidate.headWeaponLevels?.[id] ?? 0}` : name;
  }).join(" / ");
  return `来源：${escape(recallSourceLabel(candidate.recalledBy))}<br>车头：${escape(head)}<br>车身：${escape(compressedRallyBodyNames(candidate.memberSkillIds))}<br>兵阶（盾 / 矛 / 射）：${escape(TROOP_TYPES.map((t, i) => candidate.troopLevels?.[t] ?? fallbackTiers[i] ?? "未配置").join(" / "))}<br>配比（盾 / 矛 / 射）：${TROOP_TYPES.map((t) => `${candidate.ratios[t]}%`).join(" / ")}${developer ? renderJointCandidateDiagnostics(candidate) : ""}`;
}
