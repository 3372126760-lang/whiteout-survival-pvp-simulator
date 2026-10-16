import type { OptimizationProgress } from "../pvp/optimizer/types";
import type { SearchPerformanceReport } from "../pvp/optimizer/profiling";
import { formatSearchDuration } from "./optimizerPerformanceView";
export function playerOptimizationProgress(progress: OptimizationProgress | null, report: SearchPerformanceReport | null, sinceReceivedMs = 0): string {
  if (!progress) return "";
  const stage = report?.stages.find((s) => s.stage === progress.stage);
  const extra = report?.status === "running" ? Math.max(0, sinceReceivedMs) : 0;
  const completed = stage?.completed ?? progress.completed, total = stage?.total ?? progress.total;
  const elapsed = (stage?.wallElapsedMs ?? 0) + (stage?.status === "running" ? extra : 0);
  const eta = stage && stage.totalStable && completed >= 2 ? elapsed / completed * Math.max(0, total - completed) : null;
  return `${progress.stage}\n${completed.toLocaleString()} / ${total.toLocaleString()} · ${total ? (completed / total * 100).toFixed(1) : "0.0"}%\n阶段已用：${formatSearchDuration(stage ? elapsed : null)} · 预计剩余：${formatSearchDuration(eta)} · 总已用：${formatSearchDuration(report ? report.totalElapsedMs + extra : null)}`;
}
