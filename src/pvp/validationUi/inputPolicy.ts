import { TROOP_TYPES } from "../types/combat";
import type { ValidationBattleInput, ValidationQueueConfig, ValidationSideInput } from "./types";

export function maxT12SkillLevel(input: Pick<ValidationBattleInput, "scenarioType" | "battleContext">, side?: "A" | "B"): number {
  if (input.scenarioType === "CITY_DEFENSE") return side === "B" ? 24 : 3;
  return (input.scenarioType ?? (input.battleContext === "rally" ? "RALLY" : "SINGLE")) === "RALLY" ? 24 : 3;
}

/** UI/import/Worker boundary only; the troop-skill implementation is unchanged.
 * Removed current custom bonuses are accepted as legacy metadata and discarded.
 * Historical report conditions are available only to the explicit reverse tool. */
export function normalizeBattleInputPolicy(input: ValidationBattleInput): ValidationBattleInput {
  const max = maxT12SkillLevel(input);
  const level = (value: number | undefined, limit = max) => value !== undefined && Number.isSafeInteger(value) && value > limit ? limit : value;
  const context = <T extends ValidationSideInput | ValidationQueueConfig>(value: T): T => {
    const { targetBonusMode: _mode, targetBattleBonuses: _target, ...rest } = value;
    void [_mode, _target];
    return _mode !== undefined || _target !== undefined || value.reportAttributeBasis === "historicalReport"
      ? { ...rest, ...(value.reportAttributeBasis === "historicalReport" ? { reportAttributeBasis: "raw" as const } : {}) } as T : value;
  };
  const side = (original: ValidationSideInput, sideId: "A" | "B"): ValidationSideInput => {
    let value = context(original);
    const troops = Object.fromEntries(TROOP_TYPES.map((troop) => {
      const row = value.troops[troop], t12Level = level(row.t12Level, maxT12SkillLevel(input, sideId));
      return [troop, t12Level === row.t12Level ? row : { ...row, t12Level }];
    })) as ValidationSideInput["troops"];
    const threeQueues = value.threeQueues?.map((original) => {
      const queue = context(original), levels = queue.t12Levels;
      if (!levels || TROOP_TYPES.every((troop) => level(levels[troop]) === levels[troop])) return queue;
      return { ...queue, t12Levels: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, level(levels[troop])])) };
    }) as ValidationSideInput["threeQueues"];
    if (TROOP_TYPES.some((troop) => troops[troop] !== value.troops[troop]) ||
      threeQueues?.some((queue, i) => queue !== value.threeQueues?.[i])) value = { ...value, troops,
        ...(threeQueues ? { threeQueues } : {}) };
    return value;
  };
  const sideA = side(input.sideA, "A"), sideB = side(input.sideB, "B");
  const rallyAttacks = input.rallyAttacks?.map(value => side(value, "A"));
  const ralliesChanged = rallyAttacks?.some((value, i) => value !== input.rallyAttacks?.[i]) ?? false;
  const rallySingleAttack = input.rallySingleAttack && side(input.rallySingleAttack,"A");
  const earth = input.innerEarth;
  const innerEarth = earth && TROOP_TYPES.some((troop) => level(earth.ally.t12SkillLevels[troop]) !== earth.ally.t12SkillLevels[troop])
    ? { ...earth, ally: { ...earth.ally, t12SkillLevels: Object.fromEntries(TROOP_TYPES.map((troop) =>
      [troop, level(earth.ally.t12SkillLevels[troop])])) as typeof earth.ally.t12SkillLevels } } : earth;
  return sideA === input.sideA && sideB === input.sideB && innerEarth === earth && !ralliesChanged && rallySingleAttack === input.rallySingleAttack ? input : { ...input, sideA, sideB,
    ...(rallySingleAttack ? {rallySingleAttack} : {}),
    ...(ralliesChanged ? { rallyAttacks: rallyAttacks! } : {}),
    ...(innerEarth ? { innerEarth } : {}) };
}
