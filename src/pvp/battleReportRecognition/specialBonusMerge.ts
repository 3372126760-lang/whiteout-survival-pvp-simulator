import type { ParsedSpecialBonus, SpecialBonusCandidate,
  SpecialBonusRowQuality, SpecialBonusSource } from "./types";

export function bonusRowQuality(candidate: SpecialBonusCandidate): SpecialBonusRowQuality {
  const field = candidate.amount;
  return candidate.rowQuality ?? { labelConfidence: field.ocrConfidence ?? field.confidence,
    valueConfidence: field.ocrConfidence ?? field.confidence,
    structuralConfidence: field.structuralConfidence ?? field.confidence,
    finalConfidence: field.finalConfidence ?? field.confidence,
    isNearTopEdge: false, isNearBottomEdge: false, isPartiallyClipped: false };
}

function compare(left: SpecialBonusCandidate, right: SpecialBonusCandidate): number {
  const a = bonusRowQuality(left), b = bonusRowQuality(right);
  const full = (quality: SpecialBonusRowQuality) => quality.isPartiallyClipped ? 0 :
    quality.isNearTopEdge || quality.isNearBottomEdge ? 1 : 2;
  const rank = { exact: 3, alias: 2, fuzzy: 1 };
  return full(b) - full(a) || rank[right.matchType ?? "exact"] - rank[left.matchType ?? "exact"] ||
    b.structuralConfidence - a.structuralConfidence || b.valueConfidence - a.valueConfidence ||
    b.finalConfidence - a.finalConfidence;
}

function highQuality(candidate: SpecialBonusCandidate): boolean {
  const row = bonusRowQuality(candidate);
  return !row.isNearTopEdge && !row.isNearBottomEdge && !row.isPartiallyClipped &&
    candidate.matchType !== "fuzzy" && !candidate.amount.needsConfirmation &&
    [row.labelConfidence, row.valueConfidence, row.structuralConfidence,
      row.finalConfidence].every((value) => value >= .85);
}

function uniqueSources(sources: readonly SpecialBonusSource[]): SpecialBonusSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = JSON.stringify([source.imageId, source.rawText, source.value, source.bbox]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidates(bonus: ParsedSpecialBonus): readonly SpecialBonusCandidate[] {
  return bonus.candidates?.length ? bonus.candidates : [{ amount: bonus.amount,
    ...(bonus.matchScore === undefined && bonus.matchConfidence === undefined ? {} : {
      matchScore: bonus.matchScore ?? bonus.matchConfidence }),
    ...(bonus.matchType === undefined ? {} : { matchType: bonus.matchType }),
    ...(bonus.rowQuality === undefined ? {} : { rowQuality: bonus.rowQuality }),
    sources: bonus.sources ?? [] }];
}

/** Repeated list rows are observations of one effect, never additional effects. */
export function mergeSpecialBonuses(old: readonly ParsedSpecialBonus[],
  incoming: readonly ParsedSpecialBonus[]): readonly ParsedSpecialBonus[] {
  const rows: ParsedSpecialBonus[] = [];
  for (const bonus of [...old, ...incoming]) {
    const key = (item: ParsedSpecialBonus) =>
      `${item.sourceRecognitionState ?? item.sourceArmy ?? "unknown"}|${item.canonicalLabel ?? item.label}`;
    const index = rows.findIndex((item) => key(item) === key(bonus));
    if (index < 0) { rows.push(bonus); continue; }
    const prior = rows[index]!;
    const byValue = new Map<number, SpecialBonusCandidate>();
    for (const candidate of [...candidates(prior), ...candidates(bonus)]) {
      const previous = byValue.get(candidate.amount.value);
      const winner = previous === undefined || compare(candidate, previous) < 0 ? candidate : previous;
      byValue.set(candidate.amount.value, { ...winner,
        sources: uniqueSources([...(previous?.sources ?? []), ...candidate.sources]) });
    }
    const ranked = [...byValue.values()].sort(compare);
    const best = ranked[0]!;
    const matchScore = best.matchType === "exact" || best.matchType === "alias" ? 1 :
      best.matchScore ?? prior.matchScore ?? prior.matchConfidence ?? 0;
    const genuine = ranked.filter(highQuality);
    const conflict = genuine.length > 1;
    const unresolvedValue = !highQuality(best) && ranked.length > 1;
    rows[index] = { ...prior, amount: { ...best.amount,
      needsConfirmation: conflict || unresolvedValue || Boolean(best.amount.needsConfirmation),
      alternatives: conflict ? genuine.slice(1).map((item) => item.amount.value) :
        unresolvedValue ? ranked.slice(1).map((item) => item.amount.value) : [] },
    ...(best.matchType === undefined ? {} : { matchType: best.matchType }),
    matchScore, matchConfidence: matchScore,
    rowQuality: bonusRowQuality(best), conflict,
    conflictValues: conflict ? genuine.map((item) => item.amount.value) : [],
    candidates: ranked, sources: uniqueSources(ranked.flatMap((item) => item.sources)) };
  }
  return rows;
}

export function selectSpecialBonusCandidate(bonus: ParsedSpecialBonus,
  index: number): ParsedSpecialBonus {
  const candidate = bonus.candidates?.[index];
  if (candidate === undefined) throw new Error("特殊加成候选无效。");
  return { ...bonus, amount: { ...candidate.amount, confirmed: true,
    needsConfirmation: false, alternatives: [] }, rowQuality: bonusRowQuality(candidate),
    ...(candidate.matchType === undefined ? {} : { matchType: candidate.matchType }),
    matchScore: candidate.matchType === "exact" || candidate.matchType === "alias" ? 1 :
      candidate.matchScore ?? bonus.matchScore ?? bonus.matchConfidence ?? 0,
    matchConfidence: candidate.matchType === "exact" || candidate.matchType === "alias" ? 1 :
      candidate.matchScore ?? bonus.matchScore ?? bonus.matchConfidence ?? 0,
    conflict: false, conflictValues: [], candidates: [] };
}
