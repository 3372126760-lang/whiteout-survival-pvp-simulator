import type { ParsedBattleReportSide } from "../pvp/battleReportRecognition/types";

export function reportBonusSummary(column: ParsedBattleReportSide | undefined): string {
  const bonuses = (["additive", "buffs", "debuffs"] as const)
    .flatMap((group) => column?.specialBonuses?.[group] ?? []);
  const unknown = column?.unmatchedBonuses?.length ?? 0;
  const pending = bonuses.filter((item) => item.conflict || !item.amount.confirmed &&
    (item.amount.needsConfirmation || item.amount.confidence < .85)).length + unknown;
  const conflicts = bonuses.filter((item) => item.conflict).length;
  return `${bonuses.length + unknown}项 / ${pending}待确认${conflicts ? ` / ${conflicts}真正冲突` : ""}`;
}
