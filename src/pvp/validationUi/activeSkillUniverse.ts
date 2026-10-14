import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS } from "../troopSkills";
import { isBattleContextAllowedForSide, SIDE_IDS, TROOP_TYPES } from "../types/combat";
import { sideFromState, type BattleState } from "../types/battle";
import { getValidationCatalog } from "./catalog";
import type { ValidationActiveSkillOption } from "./types";

/** Only skills represented by this battle input are exposed to debug controls. */
export function getActiveSkillUniverse(
  state: BattleState,
): readonly ValidationActiveSkillOption[] {
  const catalog = getValidationCatalog();
  const catalogById = new Map(catalog.skills.map((skill) => [skill.id, skill]));
  const heroDefinitionById = new Map(
    CONFIRMED_HERO_SKILL_DEFINITIONS.map((definition) => [definition.id, definition]),
  );
  const troopDefinitionById = new Map(
    CONFIRMED_TROOP_SKILL_DEFINITIONS.map((definition) => [definition.id, definition]),
  );
  const output: ValidationActiveSkillOption[] = [];
  const seen = new Set<string>();
  for (const sideId of SIDE_IDS) {
    const side = sideFromState(state, sideId);
    for (const troop of TROOP_TYPES) {
      if (side.troops[troop].aliveCount === 0) continue;
      for (const runtime of side.troops[troop].skillStates) {
        const definition = troopDefinitionById.get(runtime.skillId);
        add(
          runtime.skillId,
          sideId,
          [troop],
          null,
          definition?.levelValues[runtime.level]?.probability ??
            definition?.probability ?? null,
        );
      }
    }
    const aliveTroops = TROOP_TYPES.filter(
      (troop) => side.troops[troop].aliveCount > 0,
    );
    for (const hero of side.heroStates) {
      for (const runtime of hero.skillStates) {
        const definition = heroDefinitionById.get(runtime.skillId);
        if (
          definition === undefined ||
          !isBattleContextAllowedForSide(
            definition.battleContexts,
            state.battleContext,
            sideId,
          )
        ) continue;
        const option = catalogById.get(runtime.skillId);
        add(
          runtime.skillId,
          sideId,
          option?.perTroop ? aliveTroops : [],
          hero.position,
          definition.levelValues[runtime.level]?.probability ??
            definition.probability ?? null,
        );
      }
    }
  }
  return output;

  function add(
    skillId: string,
    side: "A" | "B",
    applicableTroops: readonly (typeof TROOP_TYPES)[number][],
    position: "leader" | "member" | null,
    probability: number | null,
  ): void {
    const key = `${side}:${skillId}`;
    if (seen.has(key)) return;
    const option = catalogById.get(skillId);
    if (option === undefined) return;
    seen.add(key);
    output.push({ ...option, probability, side, applicableTroops, position });
  }
}
