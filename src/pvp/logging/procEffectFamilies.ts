import type { HeroSkillTraceEntry } from "../heroSkills/types";
import type { SideId, TroopType } from "../types/combat";

export interface ProcEffectFamilyTrace {
  readonly procEffectFamilyId: string;
  readonly side: SideId;
  readonly sourceTroop?: TroopType;
  readonly targetTroop?: TroopType;
  readonly parentEventId?: string;
  readonly familySources: readonly {
    readonly runtimeInstanceId: string;
    readonly heroDefinitionId: string;
    readonly skillId: string;
    readonly procProbability: number;
    readonly procRoll: number | null;
    readonly procResult: boolean;
  }[];
  readonly familyProcResult: boolean;
  readonly familyCombinedProbability: number;
  readonly generatedEffectValue: number;
}

/** Audit only: group independent rolls within ONE main attack, never across
 * different troops/actions or rounds. It does not draw RNG or modify effects. */
export function traceProcEffectFamilies(entries: readonly HeroSkillTraceEntry[]): ProcEffectFamilyTrace[] {
  const groups = new Map<string, HeroSkillTraceEntry[]>();
  for (const entry of entries) {
    if (!entry.procEffectFamilyId || !entry.eligible) continue;
    const key = JSON.stringify([entry.round, entry.side, entry.sourceTroop,
      entry.targetTroop, entry.parentEventId, entry.procEffectFamilyId, entry.familyEffectValue]);
    const group = groups.get(key) ?? [];
    group.push(entry); groups.set(key, group);
  }
  return [...groups.values()].map((entries) => {
    const first = entries[0]!, success = entries.some((entry) => entry.procResult);
    return {
      procEffectFamilyId: first.procEffectFamilyId!, side: first.side,
      ...(first.sourceTroop === undefined ? {} : { sourceTroop: first.sourceTroop }),
      ...(first.targetTroop === undefined ? {} : { targetTroop: first.targetTroop }),
      ...(first.parentEventId === undefined ? {} : { parentEventId: first.parentEventId }),
      familySources: entries.map((entry) => ({
        runtimeInstanceId: entry.runtimeInstanceId ?? entry.heroId,
        heroDefinitionId: entry.heroDefinitionId ?? entry.heroId,
        skillId: entry.skillId, procProbability: entry.probability ?? 1,
        procRoll: entry.procRoll, procResult: entry.procResult,
      })),
      familyProcResult: success,
      familyCombinedProbability: 1 - entries.reduce((product, entry) => product * (1 - (entry.probability ?? 1)), 1),
      generatedEffectValue: success ? first.familyEffectValue ?? 0 : 0,
    };
  });
}
