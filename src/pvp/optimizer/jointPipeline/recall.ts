import type { JointPeakRow, RecallAudit, RecallSource } from "./types";
import { compareJointPeaks } from "./peakScan";

export const peakPairKey = (row: Pick<JointPeakRow, "head" | "body">) => `${row.head}:${row.body}`;
export function mergePeakRecall(global: readonly JointPeakRow[], perHead: readonly JointPeakRow[], k: number) {
  const rows = new Map<string, JointPeakRow>(), sources = new Map<string, RecallSource[]>();
  for (const [list, source] of [[global, "globalTopJ"], [perHead, "perHeadBestJ"]] as const)
    for (const row of list) {
      const key = peakPairKey(row);
      if (!rows.has(key)) rows.set(key, row);
      const flags = sources.get(key) ?? [];
      if (!flags.includes(source)) flags.push(source);
      sources.set(key, flags);
    }
  const perHeadKeys = new Set(perHead.map(peakPairKey));
  const overlap = global.filter((row) => perHeadKeys.has(peakPairKey(row))).length;
  const audit: RecallAudit = { globalTopJCount: global.length, perHeadProtectedK: k, perHeadRawCount: perHead.length,
    perHeadUniqueCount: perHeadKeys.size, overlapWithGlobalTopJ: overlap, mergedRecallCount: rows.size,
    addedOnlyByPerHeadCount: perHeadKeys.size - overlap, finalistRecallSources: [], bestFormalRecallSource: [],
    debugCandidates: [], rankDiagnosticPeakEvaluations: 0 };
  return { rows: [...rows.values()].sort(compareJointPeaks), sources, audit };
}
