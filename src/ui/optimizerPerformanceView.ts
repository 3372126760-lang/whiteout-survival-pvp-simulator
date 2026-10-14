import type { SearchPerformanceReport } from "../pvp/optimizer/profiling";
import type { OptimizationProgress } from "../pvp/optimizer/types";

const escape = (text: string) => text.replace(/[&<>"']/g, (value) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
export function formatSearchDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "估算中…";
  if (ms < 1000) return `${Math.max(0, ms).toFixed(1)} ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function optimizerProgressText(progress: OptimizationProgress | null,
  report: SearchPerformanceReport | null, sinceReceivedMs = 0): string {
  if (!progress) return "";
  const stage = report?.stages.find((row) => row.stage === progress.stage);
  if (!stage || !report) return `${progress.stage}：${progress.completed}/${progress.total}`;
  const extra = report.status === "running" ? Math.max(0, sinceReceivedMs) : 0;
  const elapsed = stage.wallElapsedMs + (stage.status === "running" ? extra : 0);
  const eta = stage.status !== "running" ? 0 : stage.completed >= 2 && stage.totalStable ?
    elapsed / stage.completed * (stage.total - stage.completed) : null;
  const unit = stage.executionWorkload ? stage.executionUnit === "trajectory" ? " 条三队列轨迹" : " 场待执行战斗" : "";
  return `${stage.stage}：${stage.completed}/${stage.total}${unit} · 本阶段 ${formatSearchDuration(elapsed)} · 累计 ${formatSearchDuration(report.totalElapsedMs + extra)} · 当前阶段预计剩余 ${formatSearchDuration(eta)}`;
}
export function performanceReportBody(report: SearchPerformanceReport): string {
  return `<p class="hint">累计 ${formatSearchDuration(report.totalElapsedMs)} · 实际 BattleEngine 调用 ${report.totalBattleEngineCalls} 次 · 复用 ${report.reusedBattles} 次（${(report.cacheHitRate * 100).toFixed(1)}%） · 平均每场 ${formatSearchDuration(report.overallAvgBattleMs)}。平均耗时为各 Worker 战斗执行时长之和 ÷ 调用数；阶段进度与 ETA 使用包含子阶段的墙钟时间；耗时占比使用独占时间。取消或异常时仅包含已回传的调用数。</p>
    <div class="table-scroll"><table class="audit-table"><thead><tr><th>状态 / 阶段</th><th>耗时</th><th>占比</th><th>进度</th><th>候选/工作项</th><th>请求战斗</th><th>正式战斗</th><th>复用战斗</th><th>复用率</th><th>平均每场</th><th>正式执行/复用</th><th>吞吐 / 峰值候选</th><th>缓存命中率</th></tr></thead><tbody>${report.stages.map((row) => `<tr><td>${row.status === "completed" ? "✓" : row.status === "running" ? "▶" : row.status === "cancelled" ? "已取消" : "异常"} ${escape(row.stage)}</td><td>${formatSearchDuration(row.wallElapsedMs)}<small>独占 ${formatSearchDuration(row.exclusiveElapsedMs)}</small></td><td>${row.percentOfTotal.toFixed(1)}%</td><td>${row.completed}/${row.total}</td><td>${row.candidateCount}</td><td>${row.requestedBattles}</td><td>${row.executedBattles}</td><td>${row.reusedBattles}</td><td>${(row.cacheHitRate * 100).toFixed(1)}%</td><td>${formatSearchDuration(row.avgBattleMs)}</td><td>${row.executedBattles}/${row.reusedBattles}</td><td>${row.throughput?.toFixed(1) ?? "—"} ${row.executionWorkload ? row.executionUnit === "trajectory" ? "条轨迹" : "场战斗" : "工作项"}/s · ${row.peakCandidateCount}</td><td>${(row.cacheHitRate * 100).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div>
    <p class="hint">未分段的组装与调度 ${formatSearchDuration(report.unaccountedElapsedMs)}。仅列出本次实际执行的阶段；后续阶段候选数未知，不估算总剩余时间。</p>`;
}
export function renderOptimizerPerformance(report: SearchPerformanceReport | null): string {
  return report === null ? "" : `<details class="mini-details optimizer-performance"><summary>阶段耗时 · ${report.status === "running" ? "运行中" : report.status === "completed" ? "已完成" : report.status === "cancelled" ? "已取消" : "异常"}</summary><div class="optimizer-timing-body">${performanceReportBody(report)}</div><button class="btn btn-small" data-action="copy-optimizer-performance">复制性能报告 JSON</button></details>`;
}
