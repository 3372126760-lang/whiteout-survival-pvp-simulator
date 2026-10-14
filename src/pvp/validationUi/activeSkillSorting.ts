import type { ValidationActiveSkillOption } from "./types";

const TROOP_ORDER = { shield: 0, lancer: 1, marksman: 2 } as const;

/** Stable UI order shared by probability overrides and disabled-skill controls. */
export function sortActiveSkillsForUi(
  skills: readonly ValidationActiveSkillOption[],
): readonly ValidationActiveSkillOption[] {
  return [...skills].sort((left, right) =>
    sideRank(left.side) - sideRank(right.side) ||
    sourceBucket(left) - sourceBucket(right) ||
    (left.expeditionSkillSlot ?? 99) - (right.expeditionSkillSlot ?? 99) ||
    left.definitionOrder - right.definitionOrder ||
    left.id.localeCompare(right.id)
  );
}

function sideRank(side: "A" | "B"): number {
  return side === "A" ? 0 : 1;
}

function sourceBucket(skill: ValidationActiveSkillOption): number {
  if (skill.source === "troop" && skill.category !== "T12") {
    return TROOP_ORDER[skill.troopType];
  }
  if (
    skill.source === "hero" &&
    skill.category !== "exclusiveWeapon" &&
    skill.position === "leader"
  ) {
    return 3 + TROOP_ORDER[skill.troopType];
  }
  if (
    skill.source === "hero" &&
    skill.category !== "exclusiveWeapon" &&
    skill.position === "member"
  ) {
    return 6;
  }
  if (skill.source === "troop" && skill.category === "T12") {
    return 7 + TROOP_ORDER[skill.troopType];
  }
  return 10;
}
