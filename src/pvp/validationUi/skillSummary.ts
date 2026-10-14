import type { BattleTrace } from "../logging";
import type { SideId, TroopType } from "../types/combat";
import type { ValidationSkillSummaryEntry } from "./types";

interface MutableSummary {
  side: SideId;
  skillId: string;
  skillName: string;
  uiSummary: string;
  source: "troop" | "hero";
  probabilityCheckCount: number;
  procSuccessCount: number;
  actualActivationCount: number;
  extraDamageEventCount: number;
  criticalCount: number;
  dodgeCount: number;
  stunCount: number;
  skippedActionCount: number;
  activationBySourceTroop: Partial<Record<TroopType, number>>;
  activationByTargetTroop: Partial<Record<TroopType, number>>;
}

export function summarizeBattleSkills(
  trace: BattleTrace,
): readonly ValidationSkillSummaryEntry[] {
  const summaries = new Map<string, MutableSummary>();
  for (const round of trace.rounds) {
    for (const skill of round.troopSkills) {
      const summary = getSummary(
        summaries,
        skill.side,
        skill.skillId,
        skill.skillName,
        skill.uiSummary,
        "troop",
      );
      recordCheck(summary, skill.probability, skill.eligible, skill.triggered);
      if (skill.triggered) {
        const activations = skill.reportActivationCount ?? 1;
        summary.actualActivationCount += activations;
        increment(summary.activationBySourceTroop, skill.troop, activations);
      }
    }
    for (const skill of round.heroSkills) {
      const summary = getSummary(
        summaries,
        skill.side,
        skill.skillId,
        skill.skillName,
        skill.uiSummary,
        "hero",
      );
      recordCheck(summary, skill.probability, skill.eligible, skill.triggered);
      if (skill.triggered) {
        summary.actualActivationCount += 1;
        if (skill.sourceTroop !== undefined) {
          increment(summary.activationBySourceTroop, skill.sourceTroop);
        }
        const target = skill.appliedDebuffTargetTroop ?? skill.targetTroop;
        if (target !== undefined) increment(summary.activationByTargetTroop, target);
      }
      if (skill.criticalResult === true) summary.criticalCount += 1;
      if (skill.dodgeResult === true) summary.dodgeCount += 1;
      if (skill.stunTarget !== undefined && skill.triggered) summary.stunCount += 1;
      if (skill.skippedMainAttack === true) summary.skippedActionCount += 1;
    }
    for (const event of round.damageEvents) {
      if (event.sourceSkillId === undefined || event.damageSubtype !== "extraDamage") {
        continue;
      }
      const summary = summaries.get(`${event.sourceSide}:${event.sourceSkillId}`);
      if (summary === undefined) continue;
      summary.extraDamageEventCount += 1;
      increment(summary.activationByTargetTroop, event.targetTroop);
    }
  }
  return [...summaries.values()]
    .filter((summary) =>
      summary.actualActivationCount > 0 || summary.probabilityCheckCount > 0 ||
      summary.skippedActionCount > 0
    )
    .map((summary) => ({ ...summary }))
    .sort((left, right) =>
      left.side.localeCompare(right.side) || left.skillName.localeCompare(right.skillName)
    );
}

function getSummary(
  summaries: Map<string, MutableSummary>,
  side: SideId,
  skillId: string,
  skillName: string,
  uiSummary: string,
  source: "troop" | "hero",
): MutableSummary {
  const key = `${side}:${skillId}`;
  const current = summaries.get(key);
  if (current !== undefined) return current;
  const created: MutableSummary = {
    side,
    skillId,
    skillName,
    uiSummary,
    source,
    probabilityCheckCount: 0,
    procSuccessCount: 0,
    actualActivationCount: 0,
    extraDamageEventCount: 0,
    criticalCount: 0,
    dodgeCount: 0,
    stunCount: 0,
    skippedActionCount: 0,
    activationBySourceTroop: {},
    activationByTargetTroop: {},
  };
  summaries.set(key, created);
  return created;
}

function recordCheck(
  summary: MutableSummary,
  probability: number | null,
  eligible: boolean,
  triggered: boolean,
): void {
  if (probability !== null && eligible) {
    summary.probabilityCheckCount += 1;
    if (triggered) summary.procSuccessCount += 1;
  }
}

function increment(
  counts: Partial<Record<TroopType, number>>,
  troop: TroopType,
  amount = 1,
): void {
  counts[troop] = (counts[troop] ?? 0) + amount;
}
