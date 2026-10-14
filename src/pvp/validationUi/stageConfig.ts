import { TROOP_TYPES, type TroopType } from "../types/combat";
import { clampTroopLevelToStage, getServerStage,
  isHeroAvailableAtStage, isTroopLevelAvailableAtStage,
  type ServerStageId } from "../progression";
import { getAvailableMemberSkills } from "./catalog";
import { validateBodySkillConfigs } from "./bodySkillConfig";
import type { ValidationBattleInput, ValidationSideInput,
  ValidationTroopInput, ValidationQueueConfig } from "./types";

/** Legacy inputs without a stage retain their previous unrestricted S16 behavior. */
export function validationStageId(input: ValidationBattleInput): ServerStageId {
  const id = input.serverStage ?? "s16";
  getServerStage(id);
  return id;
}

/** Called before any scenario is handed to BattleEngine, including workers. */
export function assertValidationInputStage(input: ValidationBattleInput): void {
  const stage = validationStageId(input);
  const availableMemberIds = new Set(getAvailableMemberSkills(stage)
    .flatMap((option) => option.sourceSkillIds));
  const hero = (id: string | null | undefined, label: string): void => {
    if (id && !isHeroAvailableAtStage(id, stage)) {
      throw new RangeError(`${label} ${id} exceeds server stage ${stage}.`);
    }
  };
  for (const [sideId, side] of [["A", input.sideA], ["B", input.sideB]] as const) {
    for (const troop of TROOP_TYPES) {
      const troopInput = side.troops[troop];
      for (const level of [troopInput.troopLevel,
        ...(troopInput.levelComposition?.map((entry) => entry.level) ?? []),
        ...(side.highestTroopLevels === undefined ? [] : [side.highestTroopLevels[troop]])]) {
        if (!isTroopLevelAvailableAtStage(level, stage)) {
          throw new RangeError(`${sideId}.${troop} level ${level} exceeds server stage ${stage}.`);
        }
      }
      hero(side.reportHeroByTroop?.[troop], `${sideId} report hero`);
      hero(side.leaderHeroIds?.[troop], `${sideId} leader`);
      side.threeQueues?.forEach((queue, index) => {
        hero(queue.leaderHeroIds[troop], `${sideId}${index + 1} leader`);
        const queueLevel = queue.troopLevels?.[troop];
        for (const part of queue.troopLevelCompositions?.[troop] ?? []) {
          if (!isTroopLevelAvailableAtStage(part.level, stage))
            throw new RangeError(`${sideId}${index + 1}.${troop} level ${part.level} exceeds server stage ${stage}.`);
        }
        if (queueLevel !== undefined && !isTroopLevelAvailableAtStage(queueLevel, stage)) {
          throw new RangeError(`${sideId}${index + 1}.${troop} level ${queueLevel} exceeds server stage ${stage}.`);
        }
      });
    }
    for (const level of side.availableTroopLevels ?? []) {
      if (!isTroopLevelAvailableAtStage(level, stage)) {
        throw new RangeError(`${sideId} unlocked level ${level} exceeds server stage ${stage}.`);
      }
    }
    for (const id of side.reportHeroIds) hero(id, `${sideId} report hero`);
    hero(side.leaderHeroId, `${sideId} leader`);
    for (const id of Object.keys(side.reportWeaponLevels ?? {})) hero(id, `${sideId} report weapon`);
    for (const id of Object.keys(side.simulationWeaponLevels ?? {})) hero(id, `${sideId} simulation weapon`);
    for (const id of side.selectedMemberSkillIds) {
      if (!availableMemberIds.has(id)) {
        throw new RangeError(`${sideId} member skill ${id} exceeds server stage ${stage}.`);
      }
    }
    if (side.bodySkills !== undefined) {
      const leaders = side.leaderHeroIds === undefined
        ? (side.leaderHeroId === null ? [] : [side.leaderHeroId])
        : Object.values(side.leaderHeroIds).filter((id): id is string => !!id);
      validateBodySkillConfigs(side.bodySkills, leaders, stage);
    }
  }
}

export interface SanitizedStageConfig {
  readonly input: ValidationBattleInput;
  readonly changed: boolean;
}

/** Removes unavailable heroes and clamps troop levels when stage is lowered. */
export function sanitizeConfigForStage(input: ValidationBattleInput,
  stage: ServerStageId): SanitizedStageConfig {
  getServerStage(stage);
  const availableMemberIds = new Set(getAvailableMemberSkills(stage)
    .flatMap((option) => option.sourceSkillIds));
  const keepHero = (id: string | null | undefined): string | null =>
    id && isHeroAvailableAtStage(id, stage) ? id : null;
  const cleanHeroMap = (ids: Readonly<Partial<Record<TroopType, string | null>>> | undefined) =>
    ids === undefined ? undefined : Object.fromEntries(Object.entries(ids).map(
      ([troop, id]) => [troop, keepHero(id)])) as Partial<Record<TroopType, string | null>>;
  const cleanWeaponMap = (levels: Readonly<Record<string, number>> | undefined) =>
    levels === undefined ? undefined : Object.fromEntries(Object.entries(levels)
      .filter(([id]) => isHeroAvailableAtStage(id, stage)));
  const cleanTroop = (value: ValidationTroopInput): ValidationTroopInput => {
    const composition = value.levelComposition;
    if (composition === undefined) return { ...value,
      troopLevel: clampTroopLevelToStage(value.troopLevel, stage) };
    const merged = new Map<string, number>();
    for (const entry of composition) {
      const level = clampTroopLevelToStage(entry.level, stage);
      merged.set(level, (merged.get(level) ?? 0) + entry.aliveCount);
    }
    return { ...value,
      troopLevel: clampTroopLevelToStage(value.troopLevel, stage),
      levelComposition: [...merged].map(([level, aliveCount]) => ({ level, aliveCount })) };
  };
  const cleanSide = (side: ValidationSideInput): ValidationSideInput => ({
    ...side,
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      cleanTroop(side.troops[troop])])) as Record<TroopType, ValidationTroopInput>,
    ...(side.availableTroopLevels === undefined ? {} : { availableTroopLevels: [
      ...new Set(side.availableTroopLevels.map((level) =>
        clampTroopLevelToStage(level, stage))),
    ] }),
    ...(side.highestTroopLevels === undefined ? {} : { highestTroopLevels:
      Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
        clampTroopLevelToStage(side.highestTroopLevels![troop], stage)])) as
          Record<TroopType, string> }),
    reportHeroIds: side.reportHeroIds.filter((id) => isHeroAvailableAtStage(id, stage)),
    ...(side.reportHeroByTroop === undefined ? {} : {
      reportHeroByTroop: cleanHeroMap(side.reportHeroByTroop)! }),
    ...(side.leaderHeroId === undefined ? {} : {
      leaderHeroId: keepHero(side.leaderHeroId) }),
    ...(side.leaderHeroIds === undefined ? {} : {
      leaderHeroIds: cleanHeroMap(side.leaderHeroIds)! }),
    selectedMemberSkillIds: (side.bodySkills === undefined
      ? side.selectedMemberSkillIds : side.bodySkills.map((body) => body.skillId))
      .filter((id) => availableMemberIds.has(id)),
    ...(side.bodySkills === undefined ? {} : { bodySkills: side.bodySkills.filter((body) =>
      availableMemberIds.has(body.skillId) &&
      isHeroAvailableAtStage(body.heroId, stage)) }),
    ...(side.threeQueues === undefined ? {} : { threeQueues: side.threeQueues.map(
      (queue): ValidationQueueConfig => ({ ...queue,
        leaderHeroIds: cleanHeroMap(queue.leaderHeroIds) ?? {},
        ...(queue.troopLevels === undefined ? {} : { troopLevels:
          Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
            clampTroopLevelToStage(queue.troopLevels![troop], stage)])) as
              Record<TroopType, string> }),
        ...(queue.troopLevelCompositions === undefined ? {} : {
          troopLevelCompositions: Object.fromEntries(TROOP_TYPES.flatMap((troop) => {
            const parts = queue.troopLevelCompositions?.[troop];
            if (parts === undefined) return [];
            const merged = new Map<string, number>();
            for (const part of parts) {
              const level = clampTroopLevelToStage(part.level, stage);
              merged.set(level, (merged.get(level) ?? 0) + part.aliveCount);
            }
            return [[troop, [...merged].map(([level, aliveCount]) => ({ level, aliveCount }))]];
          })) }),
      })) as
          unknown as NonNullable<ValidationSideInput["threeQueues"]> }),
    ...(side.reportWeaponLevels === undefined ? {} : {
      reportWeaponLevels: cleanWeaponMap(side.reportWeaponLevels)! }),
    ...(side.simulationWeaponLevels === undefined ? {} : {
      simulationWeaponLevels: cleanWeaponMap(side.simulationWeaponLevels)! }),
  });
  const sideA = cleanSide(input.sideA);
  const sideB = cleanSide(input.sideB);
  return { input: { ...input, serverStage: stage, sideA, sideB },
    changed: JSON.stringify(sideA) !== JSON.stringify(input.sideA) ||
      JSON.stringify(sideB) !== JSON.stringify(input.sideB) };
}
