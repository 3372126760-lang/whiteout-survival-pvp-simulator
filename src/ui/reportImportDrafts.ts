import { mergeBattleReports } from "../pvp/battleReportRecognition/reportData";
import type { ParsedBattleReport, ParsedBattleReportSide, ReportSourceSide,
  SpecialBonusCompleteness } from "../pvp/battleReportRecognition/types";
import type { SideId } from "../pvp/types/combat";

export type ReportImportDrafts = Record<SideId, ParsedBattleReport | null>;

export interface ReportRecognitionContext {
  selectedSourceSide: ReportSourceSide;
  reportContext: ParsedBattleReport | null;
  specialBonusCompleteness: SpecialBonusCompleteness;
}
export type ReportRecognitionState = Record<SideId, ReportRecognitionContext>;

export function createReportRecognitionState(): ReportRecognitionState {
  const blank = (source: ReportSourceSide): ReportRecognitionContext =>
    ({ selectedSourceSide: source, reportContext: null, specialBonusCompleteness: "incomplete" });
  return { A: blank("left"), B: blank("right") };
}

export function mergeRecognitionImage(current: ReportRecognitionState, owner: SideId,
  report: ParsedBattleReport, replaceContext = false): ReportRecognitionState {
  const drafts = { A: current.A.reportContext, B: current.B.reportContext };
  if (replaceContext) drafts[owner] = null;
  const merged = mergeOwnedReportImage(drafts, owner, report);
  return { ...current, [owner]: { ...current[owner], reportContext: merged[owner],
    specialBonusCompleteness: "incomplete" } };
}

export function clearRecognitionContext(current: ReportRecognitionState,
  owner: SideId): ReportRecognitionState {
  return { ...current, [owner]: { ...current[owner], reportContext: null,
    specialBonusCompleteness: "incomplete" } };
}

export function pendingRecognitionSides(drafts: ReportImportDrafts,
  applied: Readonly<Record<SideId, boolean>>,
  mode: "prediction" | "finalReport"): SideId[] {
  if (mode !== "prediction") return [];
  return (["A", "B"] as const).filter((side) =>
    drafts[side] !== null && !applied[side]);
}

function assignContext(column: ParsedBattleReportSide,
  owner: SideId): ParsedBattleReportSide {
  if (column.specialBonuses === undefined) return column;
  const bonuses = column.specialBonuses;
  return { ...column, specialBonuses: {
    additive: bonuses.additive.map((bonus) => ({ ...bonus,
      sourceRecognitionState: owner, sourceReportSide: column.sourceSide })),
    buffs: bonuses.buffs.map((bonus) => ({ ...bonus,
      sourceRecognitionState: owner, sourceReportSide: column.sourceSide })),
    debuffs: bonuses.debuffs.map((bonus) => ({ ...bonus,
      sourceRecognitionState: owner, sourceReportSide: column.sourceSide })),
  } };
}

/** Uploading one army never replaces the other army's review state. */
export function mergeOwnedReportImage(current: ReportImportDrafts,
  owner: SideId, report: ParsedBattleReport): ReportImportDrafts {
  const tagged: ParsedBattleReport = { ...report,
    ...(report.left === undefined ? {} : { left: assignContext(report.left, owner) }),
    ...(report.right === undefined ? {} : { right: assignContext(report.right, owner) }),
  };
  return { ...current, [owner]: current[owner] === null ? tagged :
    mergeBattleReports([current[owner], tagged]) };
}
