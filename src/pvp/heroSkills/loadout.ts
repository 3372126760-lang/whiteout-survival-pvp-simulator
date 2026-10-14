import {
  CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS,
} from "./definitions";
import { getExpeditionHeroData } from "./data";
import {
  getExclusiveWeaponSkillTier,
  validateExclusiveWeaponLevel,
} from "./data";
import {
  DEFAULT_HERO_SKILL_LEVEL,
  createHeroSkillRuntimeState,
} from "./runtime";
import type {
  HeroPosition,
  HeroPositionActivationPolicy,
  HeroSkillDefinition,
  HeroState,
} from "./types";

export const DEFAULT_HERO_POSITION_ACTIVATION_POLICY: HeroPositionActivationPolicy = {
  leaderSkillSlots: [1, 2, 3],
  memberSkillSlots: [1],
};

export interface HeroFormationInput {
  readonly heroId: string;
  readonly heroDefinitionId?: string;
  readonly runtimeInstanceId?: string;
  readonly position: HeroPosition;
  /** Omitted skills use the confirmed default expedition level 5. */
  readonly skillLevels?: Readonly<Record<string, number>>;
  /** Optional explicit member selection; it must be expedition combat skill 1. */
  readonly selectedMemberSkillId?: string;
  /** Lv0-Lv10; base stats and unlocked weapon skill tier are independent. */
  readonly weaponLevel?: number;
}

export function createConfirmedHeroState(
  input: HeroFormationInput,
  policy: HeroPositionActivationPolicy = DEFAULT_HERO_POSITION_ACTIVATION_POLICY,
): HeroState {
  if (input.heroDefinitionId !== undefined && input.heroDefinitionId !== input.heroId) {
    throw new Error("heroId and heroDefinitionId must identify the same definition.");
  }
  const catalogHero = getExpeditionHeroData(input.heroId);
  let normalizedInput = input;
  if (catalogHero !== undefined) {
    validateConfirmedExpeditionSelection(input, catalogHero.expeditionSkills);
    const selected = catalogHero.expeditionSkills.find(
      (skill) => skill.id === input.selectedMemberSkillId,
    );
    if (selected?.combatSkillDefinitionId !== undefined) {
      normalizedInput = {
        ...input,
        selectedMemberSkillId: selected.combatSkillDefinitionId,
      };
    }
  }
  return createHeroStateFromDefinitions(
    normalizedInput,
    CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS,
    policy,
    catalogHero !== undefined,
  );
}

export function createHeroStateFromDefinitions(
  input: HeroFormationInput,
  definitions: readonly HeroSkillDefinition[],
  policy: HeroPositionActivationPolicy = DEFAULT_HERO_POSITION_ACTIVATION_POLICY,
  allowEmpty = false,
): HeroState {
  if (!input.heroId) throw new Error("heroId cannot be empty.");
  const weaponLevel = input.position === "member" ? 0 : input.weaponLevel ?? 0;
  validateExclusiveWeaponLevel(weaponLevel);
  const weaponTier = getExclusiveWeaponSkillTier(weaponLevel);
  const heroDefinitions = definitions.filter(
    (definition) => definition.heroId === input.heroId,
  );
  if (heroDefinitions.length === 0 && !allowEmpty) {
    throw new Error(`No hero skill definitions found for ${input.heroId}.`);
  }
  const activeSlots = input.position === "leader"
    ? policy.leaderSkillSlots
    : policy.memberSkillSlots;
  const activeDefinitions = heroDefinitions.filter((definition) => {
    if (!definition.positionRule.allowedPositions.includes(input.position)) {
      return false;
    }
    if (definition.positionRule.kind === "exclusiveWeapon") {
      return input.position === "leader" && weaponTier > 0 &&
        definition.levelValues[weaponTier] !== undefined;
    }
    return activeSlots.includes(definition.positionRule.expeditionSkillSlot) &&
      (input.position !== "member" ||
        input.selectedMemberSkillId === undefined ||
        definition.id === input.selectedMemberSkillId);
  });
  const requestedSkillIds = Object.keys(input.skillLevels ?? {});
  for (const skillId of requestedSkillIds) {
    if (!heroDefinitions.some((definition) => definition.id === skillId)) {
      throw new Error(`Unknown skill ${skillId} for hero ${input.heroId}.`);
    }
  }
  return {
    heroId: input.heroId,
    heroDefinitionId: input.heroDefinitionId ?? input.heroId,
    ...(input.runtimeInstanceId === undefined ? {} : { runtimeInstanceId: input.runtimeInstanceId }),
    position: input.position,
    weaponLevel,
    skillStates: activeDefinitions.map((definition) => {
      const level = definition.positionRule.kind === "exclusiveWeapon"
        ? weaponTier
        : input.skillLevels?.[definition.id] ?? DEFAULT_HERO_SKILL_LEVEL;
      if (definition.levelValues[level] === undefined) {
        throw new Error(
          `Hero skill ${definition.id} has no confirmed level ${level}.`,
        );
      }
      return createHeroSkillRuntimeState(definition.id, level);
    }),
  };
}

export function createConfirmedHeroFormation(
  inputs: readonly HeroFormationInput[],
  policy: HeroPositionActivationPolicy = DEFAULT_HERO_POSITION_ACTIVATION_POLICY,
): readonly HeroState[] {
  const ids = new Set<string>();
  let leaderCount = 0;
  const leaderTroops = new Set<string>();
  let memberSkillCount = 0;
  return inputs.map((input) => {
    if (input.position === "leader" && ids.has(input.heroId)) {
      throw new Error(`Duplicate hero in formation: ${input.heroId}.`);
    }
    if (input.position === "leader") ids.add(input.heroId);
    if (input.position === "leader") {
      leaderCount += 1;
      const troopType = getExpeditionHeroData(input.heroId)?.stats.troopType;
      if (troopType !== undefined && leaderTroops.has(troopType)) {
        throw new Error(`A battle side can have at most one ${troopType} leader hero.`);
      }
      if (troopType !== undefined) leaderTroops.add(troopType);
    }
    if (leaderCount > 3) {
      throw new Error("A battle side can have at most three leader heroes (one per troop type).");
    }
    const state = createConfirmedHeroState(input, policy);
    if (input.position === "member") {
      memberSkillCount += state.skillStates.filter((runtime) =>
        CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS.find(
          (definition) => definition.id === runtime.skillId,
        )?.positionRule.kind === "expeditionSkillSlot"
      ).length;
      if (memberSkillCount > 4) {
        throw new Error("A battle side can select at most four member combat skills.");
      }
    }
    return state;
  });
}

function validateConfirmedExpeditionSelection(
  input: HeroFormationInput,
  skills: readonly {
    readonly expeditionSkillSlot: 1 | 2 | 3;
    readonly combatRelevant: boolean;
    readonly combatSkillDefinitionId?: string;
    readonly id: string;
  }[],
): void {
  if (input.position === "leader") {
    if (input.selectedMemberSkillId !== undefined) {
      throw new Error("selectedMemberSkillId is only valid for member heroes.");
    }
    return;
  }
  const first = skills.find((skill) => skill.expeditionSkillSlot === 1);
  if (first === undefined || !first.combatRelevant) {
    throw new Error(
      `Hero ${input.heroId} has no PVP-selectable expedition skill 1.`,
    );
  }
  if (input.selectedMemberSkillId === undefined) {
    throw new Error(
      `Member ${input.heroId} requires an explicitly selected expedition combat skill.`,
    );
  }
  if (
    input.selectedMemberSkillId !== first.combatSkillDefinitionId &&
    input.selectedMemberSkillId !== first.id
  ) {
    throw new Error(
      `Member ${input.heroId} can only select its combat-relevant expedition skill 1.`,
    );
  }
}
