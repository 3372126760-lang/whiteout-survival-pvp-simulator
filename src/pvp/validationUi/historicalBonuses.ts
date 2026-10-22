import { TROOP_TYPES } from "../types";
import { deriveRawReportAttribute } from "../battleReportRecognition/mapping";
import type { HistoricalBonusMigration, ValidationHistoricalBonuses, ValidationReportBonusMatrix, ValidationSideInput, ValidationQueueAttributes } from "./types";
export const HISTORICAL_STATS = ["attack", "defense", "penetration", "life"] as const;
const fields = ["additive", "buff", "debuff"] as const;
export interface HistoricalBonusSource {
  readonly sourceReportBonuses?: ValidationSideInput["sourceReportBonuses"];
  readonly importedReportModifiers?: ValidationSideInput["importedReportModifiers"];
}
export function zeroHistoricalBonuses(): ValidationHistoricalBonuses {
  return Object.fromEntries(HISTORICAL_STATS.map((s) => [s, { additive: 0, buff: 0, debuff: 0 }])) as ValidationHistoricalBonuses;
}
export function expandHistoricalBonuses(value: ValidationHistoricalBonuses | ValidationReportBonusMatrix): ValidationReportBonusMatrix {
  if ("shield" in value) return value;
  return Object.fromEntries(TROOP_TYPES.map((t) => [t, structuredClone(value)])) as ValidationReportBonusMatrix;
}
export function collapseHistoricalBonuses(value: ValidationHistoricalBonuses | ValidationReportBonusMatrix) {
  if (!("shield" in value)) return { bonuses: value, conflicts: [] as HistoricalBonusMigration["conflicts"] };
  const conflicts: HistoricalBonusMigration["conflicts"][number][] = [];
  const bonuses = Object.fromEntries(HISTORICAL_STATS.map((attribute) => [attribute, Object.fromEntries(fields.map((field) => {
    const values = Object.fromEntries(TROOP_TYPES.map((t) => [t, value[t][attribute][field]])) as Record<typeof TROOP_TYPES[number], number>;
    const equal = values.shield === values.lancer && values.lancer === values.marksman;
    if (!equal) conflicts.push({ attribute, field, values });
    return [field, equal ? values.shield : 0];
  }))])) as ValidationHistoricalBonuses;
  return { bonuses, conflicts };
}
export function historicalReportBonuses(side: HistoricalBonusSource): ValidationHistoricalBonuses {
  return collapseHistoricalBonuses(side.sourceReportBonuses ?? side.importedReportModifiers ?? zeroHistoricalBonuses()).bonuses;
}
/** Persist exact individually reversed attributes if legacy troop-specific history
 * conflicts. No arbitrary troop wins the conflict, and no history enters current Buffs. */
function normalizeContext(raw: Record<string, unknown>): Record<string, unknown> {
  const source = raw.sourceReportBonuses ?? raw.importedReportModifiers;
  if (!source || typeof source !== "object") return raw;
  const legacy = source as ValidationReportBonusMatrix | ValidationHistoricalBonuses;
  if (!("shield" in legacy) && raw.importedReportModifiers === undefined) return raw;
  const { bonuses, conflicts } = collapseHistoricalBonuses(legacy);
  const { importedReportModifiers: _alias, ...rest } = raw; void _alias;
  if (!conflicts.length) return { ...rest, sourceReportBonuses: bonuses };
  const original = "shield" in legacy ? legacy : expandHistoricalBonuses(legacy);
  const attributes = (raw.attributes ?? raw.troops) as ValidationQueueAttributes | undefined;
  const reverse = raw.reportAttributeBasis === "historicalReport" && attributes;
  const converted = !reverse ? undefined : Object.fromEntries(TROOP_TYPES.map((t) => [t, {
    ...attributes[t], ...Object.fromEntries(HISTORICAL_STATS.map((stat) => {
      const b = original[t][stat]; return [stat, deriveRawReportAttribute({ reportPercent: attributes[t][stat], additivePercent: b.additive,
        buffDecimal: b.buff / 100, debuffDecimal: b.debuff / 100 })];
    })),
  }])) as ValidationQueueAttributes;
  return { ...rest, sourceReportBonuses: bonuses,
    historicalBonusMigration: { strategy: "preserveRawAttributes", conflicts },
    ...(converted ? { [raw.attributes ? "attributes" : "troops"]: converted,
      sourceReportAttributes: raw.sourceReportAttributes ?? Object.fromEntries(TROOP_TYPES.map((t) => [t, Object.fromEntries(HISTORICAL_STATS.map((s) => [s, attributes![t][s]]))])),
      reportAttributeBasis: "raw", ...(raw.reportLineage ? { reportLineage: { ...raw.reportLineage as object, attributeSnapshot: converted } } : {}) } : {}),
  };
}
/** Migration boundary shared by file import, share import and persistence. */
export function normalizeHistoricalTree<T>(value: T): T {
  if (Array.isArray(value)) { const rows = value.map(normalizeHistoricalTree); return rows.every((row, i) => row === value[i]) ? value : rows as T; }
  if (!value || typeof value !== "object") return value;
  const original = value as Record<string, unknown>;
  const { targetBonusMode: _mode, targetBattleBonuses: _current, ...withoutCurrent } = original;
  void [_mode, _current];
  let node = normalizeContext(_mode === undefined && _current === undefined ? original : withoutCurrent);
  if (node.bonuses && node.reportAttributes) {
    const migrated = normalizeContext({ sourceReportBonuses: node.bonuses, reportAttributeBasis: "raw" });
    if (migrated.sourceReportBonuses !== node.bonuses || migrated.historicalBonusMigration)
      node = { ...node, bonuses: migrated.sourceReportBonuses,
        ...(migrated.historicalBonusMigration ? { historicalBonusMigration: migrated.historicalBonusMigration } : {}) };
  }
  let changed = node !== value;
  const entries = Object.entries(node).map(([key, entry]) => { const normalized = normalizeHistoricalTree(entry); changed ||= normalized !== entry; return [key, normalized]; });
  return changed ? Object.fromEntries(entries) as T : value;
}
