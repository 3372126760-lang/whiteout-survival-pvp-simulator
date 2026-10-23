import type { TargetCasualtyResolution } from "../casualty/resolvePendingDamage";
import type { PostBattleCasualtyResult } from "../postBattle/casualtyResolver";
import { otherSide, SIDE_IDS, TROOP_TYPES, type SideId, type TroopType } from "../types/combat";
import type { DamageEvent } from "../types/damage";

/** Reporting only. Never replays damage, consumes RNG, or mutates battle data. */
export interface DamageContribution {
  eventCount: number;
  rawDamage: number;
  roundedDamage: number;
  hpDamage: number;
  shieldAbsorbed: number;
  overflowDiscarded: number;
  exited: number;
  exactExited: number;
  estimatedExited: number;
  exitedByTargetTroop: Record<TroopType, number>;
  estimated: boolean;
}
type BySide<T> = Record<SideId, T>;
type Issues = Record<"missingSource" | "invalidComponents" | "partialComponents" | "combinedSettlement", number>;
export interface DamageAttribution {
  collected: boolean;
  bySide: BySide<Record<string, DamageContribution>>;
  normalAttack: BySide<DamageContribution>;
  unattributed: BySide<DamageContribution>;
  /** Exact settled outgoing totals, including normal and unknown sources. */
  totals: BySide<DamageContribution>;
  issues: Issues;
}
export interface SkillDamageEstimate extends DamageContribution {
  /** Fractional model attribution, NOT confirmed in-game skill defeats. */
  defeatedEstimate: number | null;
}
export interface SkillDamageStatistics {
  collected: boolean;
  bySide: BySide<Record<string, SkillDamageEstimate>>;
  normalAttack: BySide<SkillDamageEstimate>;
  unattributed: BySide<SkillDamageEstimate>;
  totals: BySide<DamageContribution>;
  actualDefeatedByTargetSide: BySide<number | null>;
  casualtyModeByTargetSide: BySide<string | null>;
  issues: Issues;
}
interface SourceShare {
  kind: "skill" | "normalAttack" | "unattributed";
  skillId?: string;
  weight: number;
  rawWeight: number;
  estimated: boolean;
}
const zeroTroops = (): Record<TroopType, number> => ({ shield: 0, lancer: 0, marksman: 0 });
export const emptyDamageContribution = (): DamageContribution => ({ eventCount: 0, rawDamage: 0,
  roundedDamage: 0, hpDamage: 0, shieldAbsorbed: 0, overflowDiscarded: 0,
  exited: 0, exactExited: 0, estimatedExited: 0, exitedByTargetTroop: zeroTroops(), estimated: false });
export function emptyDamageAttribution(collected = true): DamageAttribution {
  return { collected, bySide: { A: {}, B: {} },
    normalAttack: { A: emptyDamageContribution(), B: emptyDamageContribution() },
    unattributed: { A: emptyDamageContribution(), B: emptyDamageContribution() },
    totals: { A: emptyDamageContribution(), B: emptyDamageContribution() },
    issues: { missingSource: 0, invalidComponents: 0, partialComponents: 0, combinedSettlement: 0 } };
}
const validSkill = (id: string | undefined): id is string => !!id?.trim() && id !== "unknown";
const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** The pool is authoritative. Never fall back to its first/top-level skill ID. */
function sourceShares(event: DamageEvent, issues: Issues): SourceShare[] {
  const unknown = (reason: "missingSource" | "invalidComponents"): SourceShare[] => {
    issues[reason]++;
    return [{ kind: "unattributed", weight: 1, rawWeight: 1, estimated: true }];
  };
  if (event.skillPoolComponents !== undefined) {
    const components = event.skillPoolComponents;
    if (!components.length) return unknown("missingSource");
    const sum = components.reduce((n, c) => n + c.baseDamage, 0);
    const tolerance = Math.max(1, event.baseDamage) * 1e-9;
    if (!nonnegative(event.baseDamage) || components.some((c) => !nonnegative(c.baseDamage)) ||
      !Number.isFinite(sum) || sum > event.baseDamage + tolerance) return unknown("invalidComponents");
    const denominator = Math.max(sum, event.baseDamage);
    const shares = components.map((component): SourceShare => {
      const known = validSkill(component.sourceSkillId);
      if (!known) issues.missingSource++;
      const weight = denominator === 0 ? 0 : component.baseDamage / denominator;
      return { kind: known ? "skill" : "unattributed", ...(known ? { skillId: component.sourceSkillId } : {}),
        weight, rawWeight: weight, estimated: true };
    });
    if (sum < event.baseDamage) {
      if (sum < event.baseDamage - tolerance) issues.partialComponents++;
      shares.push({ kind: "unattributed", weight: 1 - sum / denominator, rawWeight: 1 - sum / denominator, estimated: true });
    }
    return shares;
  }
  if (event.internalSegments?.length) {
    const segments = event.internalSegments;
    const sum = segments.reduce((n, s) => n + s.roundedDamage, 0);
    const raw = segments.reduce((n, s) => n + s.rawDamage, 0);
    if (segments.some((s) => !nonnegative(s.roundedDamage) || !nonnegative(s.rawDamage)) ||
      sum > event.roundedDamage || raw > event.rawDamage + Math.max(1, event.rawDamage) * 1e-9) return unknown("invalidComponents");
    return [{ kind: "normalAttack", weight: event.roundedDamage === 0 ? 0 : (event.roundedDamage - sum) / event.roundedDamage,
      rawWeight: event.rawDamage === 0 ? 0 : Math.max(0, event.rawDamage - raw) / event.rawDamage, estimated: true },
    ...segments.map((segment): SourceShare => {
      const known = validSkill(segment.sourceSkillId);
      if (!known) issues.missingSource++;
      return { kind: known ? "skill" : "unattributed", ...(known ? { skillId: segment.sourceSkillId } : {}),
        weight: event.roundedDamage === 0 ? 0 : segment.roundedDamage / event.roundedDamage,
        rawWeight: event.rawDamage === 0 ? 0 : segment.rawDamage / event.rawDamage, estimated: true };
    })];
  }
  if (validSkill(event.sourceSkillId)) return [{ kind: "skill", skillId: event.sourceSkillId,
    weight: 1, rawWeight: 1, estimated: false }];
  if (event.damageType === "normalAttack") return [{ kind: "normalAttack", weight: 1, rawWeight: 1, estimated: false }];
  return unknown("missingSource");
}

/** All independent contributing skills, including non-leading pooled members. */
export function damageEventSkillIds(event: DamageEvent): readonly string[] {
  return [...new Set(sourceShares(event, emptyDamageAttribution().issues)
    .flatMap((share) => share.skillId === undefined ? [] : [share.skillId]))];
}

/** Per-skill pre-HP damage, using the same pool/segment shares as aggregate statistics. */
export function damageEventSkillRoundedDamage(event: DamageEvent, skillId: string): number {
  return sourceShares(event, emptyDamageAttribution().issues)
    .filter(share => share.skillId === skillId)
    .reduce((sum, share) => sum + event.roundedDamage * share.weight, 0);
}

export function attributeResolvedDamage(events: readonly DamageEvent[], settlements: readonly TargetCasualtyResolution[]): DamageAttribution {
  const report = emptyDamageAttribution();
  const shares = new Map<string, readonly SourceShare[]>();
  const destination = (side: SideId, share: SourceShare) => share.kind === "skill"
    ? report.bySide[side][share.skillId!] ??= emptyDamageContribution() : report[share.kind][side];
  for (const event of events) {
    const parts = sourceShares(event, report.issues);
    shares.set(event.id, parts);
    const counted = new Set<DamageContribution>();
    for (const part of parts) {
      const row = destination(event.sourceSide, part);
      if (!counted.has(row)) { row.eventCount++; counted.add(row); }
      row.rawDamage += event.rawDamage * part.rawWeight;
      row.roundedDamage += event.roundedDamage * part.weight;
      row.estimated ||= part.estimated;
    }
    report.totals[event.sourceSide].eventCount++;
    report.totals[event.sourceSide].rawDamage += event.rawDamage;
    report.totals[event.sourceSide].roundedDamage += event.roundedDamage;
  }
  for (const settlement of settlements) {
    const sourceEvents = settlement.sourceEvents;
    const combined = sourceEvents.length !== 1;
    if (combined) report.issues.combinedSettlement++;
    const total = sourceEvents.reduce((n, event) => n + event.roundedDamage, 0);
    const shield = settlement.temporaryShieldApplications.reduce((n, s) => n + s.absorbedDamage, 0);
    const hp = settlement.absorbedDamage - shield;
    for (const event of sourceEvents) {
      const eventWeight = combined ? (total === 0 ? 0 : event.roundedDamage / total) : 1;
      const add = (row: DamageContribution, weight: number, estimated: boolean) => {
        row.hpDamage += hp * weight;
        row.shieldAbsorbed += shield * weight;
        row.overflowDiscarded += settlement.discardedOverflowDamage * weight;
        const exited = settlement.casualties * weight;
        row.exited += exited;
        row.exitedByTargetTroop[settlement.targetTroop] += exited;
        if (estimated) row.estimatedExited += exited;
        else row.exactExited += exited;
        row.estimated ||= estimated;
      };
      const parts = shares.get(event.id) ?? sourceShares(event, report.issues);
      for (const part of parts) add(destination(event.sourceSide, part), eventWeight * part.weight, combined || part.estimated);
      add(report.totals[event.sourceSide], eventWeight, combined);
    }
  }
  return report;
}

const additiveFields = ["eventCount", "rawDamage", "roundedDamage", "hpDamage", "shieldAbsorbed", "overflowDiscarded",
  "exited", "exactExited", "estimatedExited"] as const;
function addContribution(target: DamageContribution, source: DamageContribution): void {
  for (const field of additiveFields) target[field] += source[field];
  for (const troop of TROOP_TYPES) target.exitedByTargetTroop[troop] += source.exitedByTargetTroop[troop];
  target.estimated ||= source.estimated;
}
export function mergeDamageAttribution(target: DamageAttribution, source: DamageAttribution): void {
  for (const side of SIDE_IDS) {
    for (const [id, row] of Object.entries(source.bySide[side])) addContribution(target.bySide[side][id] ??= emptyDamageContribution(), row);
    for (const bucket of ["normalAttack", "unattributed", "totals"] as const) addContribution(target[bucket][side], source[bucket][side]);
  }
  for (const key of Object.keys(target.issues) as (keyof Issues)[]) target.issues[key] += source.issues[key];
}

/** Preserve the legacy field's explicit Renee exclusion. Complete source data lives in bySide. */
export function legacySkillCasualties(report: Pick<DamageAttribution, "bySide">): BySide<Record<string, number>> {
  const side = (id: SideId) => Object.fromEntries(Object.entries(report.bySide[id])
    .filter(([skillId]) => skillId !== "hero-skill.ruini.dream-mark")
    .map(([skillId, row]) => [skillId, row.exited]));
  return { A: side("A"), B: side("B") };
}

/** Convert using the target's actual, already integer-allocated post-battle rows.
 * No per-skill rounding; NORMAL/FURNACE percentages are NOT duplicated here. */
export function projectSkillDefeats(report: DamageAttribution,
  postBattle: Partial<Record<SideId, PostBattleCasualtyResult>>): SkillDamageStatistics {
  const known = (side: SideId) => postBattle[side]?.mode === "NORMAL" || postBattle[side]?.mode === "FURNACE";
  const project = (side: SideId, row: DamageContribution): SkillDamageEstimate => {
    const target = otherSide(side), casualties = postBattle[target];
    const defeatedEstimate = !known(target) || casualties === undefined || !report.collected ? null :
      TROOP_TYPES.reduce((n, troop) => n + (casualties.byTroop[troop].exited === 0 ? 0 :
        row.exitedByTargetTroop[troop] * casualties.byTroop[troop].defeated / casualties.byTroop[troop].exited), 0);
    return { ...row, exitedByTargetTroop: { ...row.exitedByTargetTroop }, defeatedEstimate };
  };
  return { collected: report.collected,
    bySide: { A: Object.fromEntries(Object.entries(report.bySide.A).map(([id, row]) => [id, project("A", row)])),
      B: Object.fromEntries(Object.entries(report.bySide.B).map(([id, row]) => [id, project("B", row)])) },
    normalAttack: { A: project("A", report.normalAttack.A), B: project("B", report.normalAttack.B) },
    unattributed: { A: project("A", report.unattributed.A), B: project("B", report.unattributed.B) },
    totals: { A: { ...report.totals.A, exitedByTargetTroop: { ...report.totals.A.exitedByTargetTroop } },
      B: { ...report.totals.B, exitedByTargetTroop: { ...report.totals.B.exitedByTargetTroop } } },
    actualDefeatedByTargetSide: { A: known("A") ? postBattle.A!.total.defeated : null, B: known("B") ? postBattle.B!.total.defeated : null },
    casualtyModeByTargetSide: { A: known("A") ? postBattle.A!.mode : null, B: known("B") ? postBattle.B!.mode : null },
    issues: { ...report.issues } };
}

/** Streaming batch aggregate: convert EACH trial before averaging. */
export function mergeSkillDamageStatistics(target: SkillDamageStatistics, source: SkillDamageStatistics): void {
  const add = (a: SkillDamageEstimate, b: SkillDamageEstimate) => {
    addContribution(a, b);
    a.defeatedEstimate = a.defeatedEstimate === null || b.defeatedEstimate === null ? null : a.defeatedEstimate + b.defeatedEstimate;
  };
  for (const side of SIDE_IDS) {
    for (const [id, row] of Object.entries(source.bySide[side])) {
      const existing = target.bySide[side][id] ??= { ...emptyDamageContribution(), defeatedEstimate: 0 };
      add(existing, row);
    }
    add(target.normalAttack[side], source.normalAttack[side]);
    add(target.unattributed[side], source.unattributed[side]);
    addContribution(target.totals[side], source.totals[side]);
    const a = target.actualDefeatedByTargetSide[side], b = source.actualDefeatedByTargetSide[side];
    target.actualDefeatedByTargetSide[side] = a === null || b === null ? null : a + b;
  }
  for (const key of Object.keys(target.issues) as (keyof Issues)[]) target.issues[key] += source.issues[key];
}
export function averageSkillDamageStatistics(total: SkillDamageStatistics, trials: number): SkillDamageStatistics {
  const scale = <T extends DamageContribution>(row: T): T => {
    const result = { ...row, exitedByTargetTroop: { ...row.exitedByTargetTroop } };
    for (const key of additiveFields) result[key] /= trials;
    for (const troop of TROOP_TYPES) result.exitedByTargetTroop[troop] /= trials;
    return result;
  };
  const estimate = (row: SkillDamageEstimate): SkillDamageEstimate => ({ ...scale(row),
    defeatedEstimate: row.defeatedEstimate === null ? null : row.defeatedEstimate / trials });
  return { ...total, bySide: { A: Object.fromEntries(Object.entries(total.bySide.A).map(([id, row]) => [id, estimate(row)])),
    B: Object.fromEntries(Object.entries(total.bySide.B).map(([id, row]) => [id, estimate(row)])) },
    normalAttack: { A: estimate(total.normalAttack.A), B: estimate(total.normalAttack.B) },
    unattributed: { A: estimate(total.unattributed.A), B: estimate(total.unattributed.B) },
    totals: { A: scale(total.totals.A), B: scale(total.totals.B) },
    actualDefeatedByTargetSide: { A: total.actualDefeatedByTargetSide.A === null ? null : total.actualDefeatedByTargetSide.A / trials,
      B: total.actualDefeatedByTargetSide.B === null ? null : total.actualDefeatedByTargetSide.B / trials } };
}

export function reportedSkillActivations(entry: { readonly triggered: boolean; readonly reportActivationCount?: number }): number {
  return entry.triggered ? entry.reportActivationCount ?? 1 : 0;
}
