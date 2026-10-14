import { TROOP_TYPES, type SideId } from "../types/combat";
import { iceFireExternalConfig, isIceFireInput } from "./iceFireContext";
import { zeroReportBonuses } from "./reportBonusContexts";
import type { ValidationBattleInput, ValidationQueueConfig, ValidationSideInput } from "./types";

/** Build a normal Single input side; the existing Single reverse/forward pipeline owns the math. */
export function queueConversionSide(input: ValidationBattleInput, sideId: SideId, queue: ValidationQueueConfig): ValidationSideInput {
  const side = input[sideId === "A" ? "sideA" : "sideB"];
  const { importedReportModifiers: _im, sourceReportBonuses: _sb, sourceReportAttributes: _sa,
    reportAttributeBasis: _basis, targetBonusMode: _mode, targetBattleBonuses: _target, ...shared } = side;
  void [_im, _sb, _sa, _basis, _mode, _target];
  const ice = isIceFireInput(input);
  return { ...shared, leaderHeroIds: queue.leaderHeroIds, leaderHeroId: null, reportHeroIds: [],
    ...Object.fromEntries(["importedReportModifiers", "sourceReportBonuses", "sourceReportAttributes", "reportAttributeBasis", "targetBonusMode", "targetBattleBonuses", "externalBuffs"].flatMap((key) => {
      const value = queue[key as keyof ValidationQueueConfig]; return value === undefined ? [] : [[key, value]];
    })),
    reportHeroByTroop: queue.reportHeroByTroop ?? queue.leaderHeroIds,
    reportWeaponLevels: queue.reportWeaponLevels ?? {}, simulationWeaponLevels: queue.weaponLevels ?? {},
    selectedMemberSkillIds: [], bodySkills: [], leaderSkillLevels: queue.heroSkillLevels ?? side.leaderSkillLevels ?? {},
    ...(ice ? { externalBuffs: iceFireExternalConfig(side), targetBonusMode: "custom" as const,
      targetBattleBonuses: zeroReportBonuses() } : {}),
    marchCapacityBonus: 0, petMarchCapacityLevel: 0,
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, { ...side.troops[troop], ...queue.attributes![troop],
      troopLevel: queue.troopLevels?.[troop] ?? side.troops[troop].troopLevel,
      t12Level: queue.t12Levels?.[troop] ?? side.troops[troop].t12Level ?? 0,
      ...(queue.troopLevelCompositions?.[troop] ? { levelMode: "mixed", levelComposition: queue.troopLevelCompositions[troop] }
        : { levelMode: "single", levelComposition: undefined }),
    }])) as ValidationSideInput["troops"] };
}
