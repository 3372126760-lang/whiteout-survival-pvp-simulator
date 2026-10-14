import { CONFIRMED_TROOP_SKILL_DEFINITIONS } from "../troopSkills";
import type { TroopSkillRuntimeState } from "../troopSkills";
import type { ValidationHeroOption } from "./types";

export interface ValidationTroopSkillDisplay {
  readonly name: string;
  readonly levelLabel: string | null;
  readonly internalRuntimeLevel: number;
  readonly versionLabel: string;
}

/** Ordinary UI level labels are game-facing, not internal runtime variants. */
export function getValidationTroopSkillDisplay(
  runtime: TroopSkillRuntimeState,
): ValidationTroopSkillDisplay {
  const definition = CONFIRMED_TROOP_SKILL_DEFINITIONS.find(
    (candidate) => candidate.id === runtime.skillId,
  );
  const versionLabel =
    definition?.levelValues[runtime.level]?.versionLabel ?? `L${runtime.level}`;
  const tags = definition?.metadata.tags ?? [];
  let levelLabel: string | null = null;
  if (tags.includes("T12")) {
    levelLabel = `等级 ${runtime.level}`;
  } else if (tags.includes("fireCrystal")) {
    levelLabel = `Lv${runtime.level}`;
  }
  return {
    name: definition?.name ?? "已启用技能",
    levelLabel,
    internalRuntimeLevel: runtime.level,
    versionLabel,
  };
}

export function formatValidationHeroOption(hero: ValidationHeroOption): string {
  if (hero.rarity === "SSR" && hero.generation !== null) {
    if (hero.name.endsWith("（待定）")) {
      return `${hero.name.slice(0, -4)}（S${hero.generation}，待定）`;
    }
    return `${hero.name}（S${hero.generation}）`;
  }
  return `${hero.name}（${hero.rarity}）`;
}

/** Crystal's report counts effect-use segments; other skills keep existing counts. */
export function getBattleReportSkillTriggerCount(skill: {
  readonly skillId: string;
  readonly actualActivationCount: number;
  readonly procSuccessCount: number;
}): number {
  return skill.skillId === "shield-crystal-shield"
    ? skill.actualActivationCount : skill.procSuccessCount;
}
