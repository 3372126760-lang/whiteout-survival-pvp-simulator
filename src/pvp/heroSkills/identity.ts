import type { SideId } from "../types/combat";
import type { HeroState } from "./types";

/** heroId remains a legacy definition alias; it is never the member state key. */
export function heroDefinitionId(hero: Pick<HeroState, "heroId" | "heroDefinitionId">): string {
  if (hero.heroDefinitionId !== undefined && hero.heroDefinitionId !== hero.heroId) {
    throw new Error("heroId and heroDefinitionId must identify the same definition.");
  }
  return hero.heroDefinitionId ?? hero.heroId;
}

export function heroRuntimeId(hero: Pick<HeroState, "heroId" | "runtimeInstanceId">): string {
  return hero.runtimeInstanceId ?? hero.heroId;
}

export function bodyRuntimeId(side: SideId, slot: number): string {
  return `${side}-body-${slot}`;
}

export function initializeHeroIdentities(heroes: readonly HeroState[], side: SideId): readonly HeroState[] {
  let bodySlot = 0;
  return heroes.map((hero) => {
    const definitionId = heroDefinitionId(hero);
    const defaultRuntimeId = hero.position === "member"
      ? bodyRuntimeId(side, bodySlot++) : definitionId;
    const runtimeInstanceId = hero.runtimeInstanceId ?? defaultRuntimeId;
    return { ...hero, heroId: definitionId, heroDefinitionId: definitionId,
      runtimeInstanceId, skillStates: hero.skillStates.map((runtime) => ({ ...runtime,
        ownerRuntimeInstanceId: runtimeInstanceId })) };
  });
}
