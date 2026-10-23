import type { TroopType } from "../pvp/types/combat";
const ids = { shield: 1, lancer: 2, marksman: 3 };
const names = { shield: "盾兵", lancer: "矛兵", marksman: "射手" };
const asset = (name: string) => `${import.meta.env.BASE_URL}assets/game-ui/${name}.png`;
export function troopIcon(type: TroopType): string {
 return `<img class="game-troop-icon" src="${asset(`soldier_icon_type_00${ids[type]}`)}" alt="" aria-hidden="true">`;
}
export function troopPortrait(type: TroopType, level: string): string {
 const tier = Number(/(?:^T|LAB_T)(\d+)/.exec(level)?.[1]);
 if (tier === 11 && type === "lancer") return `<span class="game-troop-portrait t11-lancer-report-portrait" role="img" aria-label="矛兵 T11 士兵头像" style="background-image:url('${import.meta.env.BASE_URL}assets/game-ui/t11-lancer-clean-reference.jpg')"></span>`;
 if (tier === 12) return `<span class="game-troop-portrait t12-report-portrait t12-report-${type}" role="img" aria-label="${names[type]} T12 士兵头像" style="background-image:url('${import.meta.env.BASE_URL}assets/game-ui/t12-report-reference.jpg')"></span>`;
 if (!Number.isInteger(tier) || tier < 1 || tier > 11) return troopIcon(type);
 return `<img class="game-troop-portrait" src="${asset(`item_icon_${ids[type]}${String(tier).padStart(2,"0")}00`)}" alt="${names[type]} T${tier}">`;
}
export function crystalBadge(level: string): string {
 const fc = Number(/FC(\d+)/.exec(level)?.[1]);
 return (Number.isInteger(fc) && fc >= 1 && fc <= 10) ? `<img class="game-crystal-badge" data-fc="${fc}" src="${asset(`fc-${fc}`)}" alt="火晶${fc}级">` : "";
}

export function t12SkillIcon(type: TroopType): string { return `<img class="game-t12-skill" src="${asset(`t12-${type}-skill`)}" alt="${names[type]} T12 技能">`; }

/** Visual tier palette; does not affect troop rules. */
export function troopFrame(level: string): string {
 const tier = Number(/(?:^T|LAB_T)(\d+)/.exec(level)?.[1] ?? 10);
 return tier >= 11 ? "red" : tier >= 9 ? "gold" : tier >= 7 ? "purple" : tier >= 5 ? "blue" : tier >= 3 ? "green" : "gray";
}
