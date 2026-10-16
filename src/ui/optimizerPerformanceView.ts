import { recallSourceLabel } from "./jointCandidateView";
import type { SearchPerformanceReport } from "../pvp/optimizer/profiling";
import type { OptimizationProgress } from "../pvp/optimizer/types";
import type { JointJLineage } from "../pvp/optimizer/jointPipeline/types";
import { getValidationCatalog } from "../pvp/validationUi/catalog";

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
  return `${stage.stage}：${stage.completed}/${stage.total}${unit} · ${stage.total ? (100 * stage.completed / stage.total).toFixed(1) : "0.0"}% · 本阶段 ${formatSearchDuration(elapsed)} · 累计 ${formatSearchDuration(report.totalElapsedMs + extra)} · 当前阶段预计剩余 ${formatSearchDuration(eta)}`;
}
export function performanceReportBody(report: SearchPerformanceReport): string {
  const bodyMarkup = report.bodyEnumerationAudit ? `<details class="mini-details"><summary>B0 车身枚举审计</summary><pre>${escape(JSON.stringify(report.bodyEnumerationAudit.canonical ?? report.bodyEnumerationAudit.legacyTrace ?? report.bodyEnumerationAudit, null, 2))}</pre></details>` : "";
  const jointMarkup = report.jointPeak ? `<details class="mini-details"><summary>J 全局 Top10000 · ${report.jointPeak.evaluatedHeadBodyCount.toLocaleString()} Head×Body</summary><pre>${escape(JSON.stringify(report.jointPeak, null, 2))}</pre></details>` : "";
  const ratio = (value: JointJLineage["jPeakRatio"]) => value ? `${value.shield.toFixed(2)} / ${value.lancer.toFixed(2)} / ${value.marksman.toFixed(2)}` : "—";
  const number = (value: number | undefined) => value === undefined ? "—" : value.toExponential(6);
  const pct = (value: number | undefined) => value === undefined ? "—" : `${(value * 100).toFixed(4)}%`;
  const catalog = getValidationCatalog();
  const names = (key: string) => { let result = key; for (const h of catalog.leaderHeroes) result = result.replaceAll(h.heroId, h.name);
    for (const g of catalog.memberSkills) g.sourceSkillIds.forEach((id, i) => { result = result.replaceAll(id, catalog.leaderHeroes.find((h) => h.heroId === g.sourceHeroIds[i])?.name ?? id); }); return escape(result); };
  const checkpointMarkup = report.jointPeak?.rankCheckpoints ? `<h4>J峰值截断参考</h4><p>Top10000 cutoff J：${number(report.jointPeak.top10000CutoffJ ?? undefined)} · J10000 / J1：${pct(report.jointPeak.rankCheckpoints.find((r) => r.rank === 10000)?.relativeToBest)}</p><div class="table-scroll"><table class="audit-table"><thead><tr><th>排名</th><th>Jmax</th><th>相对Rank1</th><th>比Rank1低多少</th><th>J峰比例</th><th>Head</th><th>Body</th></tr></thead><tbody>${report.jointPeak.rankCheckpoints.map((r) => `<tr><td>#${r.rank}</td><td>${number(r.j)}</td><td>${pct(r.relativeToBest)}</td><td>${pct(r.lossFromBest)}</td><td>${ratio(r.peakRatio)}</td><td>${names(r.headKey)}</td><td>${names(r.bodyKey)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const comparisonMarkup = report.finalCorrelation ? `<h4>Formal Finalist Comparison</h4><p class="hint">J 全局排名描述 Head×Body 自己的理论峰值。保护项的 J 排名仅作诊断，不代表本轮搜索召回；来源独立标注。内部排名分母为本次搜索域；固定 Body 时分母为1，不代表完整 Body 池。比例顺序：盾 / 矛 / 射。</p><div class="table-scroll"><table class="audit-table"><thead><tr><th>正式排名</th><th>正式胜率 / 场数</th><th>来源 Recall Source</th><th>Head</th><th>Body</th><th>Head×Body J峰值全局排名</th><th>bodyRankWithinHead</th><th>headRankWithinBody</th><th>J理论峰比例</th><th>Jmax</th><th>当前对局正式最优比例</th><th>该比例J</th><th>保留理论峰值</th><th>J牺牲</th></tr></thead><tbody>${report.finalCorrelation.finalists.map((r) => `<tr><td>${r.formalRank}</td><td>${pct(r.winRate)}（${r.trials} 场）</td><td>${escape(recallSourceLabel(r.recalledBy))}</td><td>${names(r.headKey)}</td><td>${names(r.bodyKey)}</td><td>${r.initialGlobalJRank ?? r.initialJRank ?? "—"}</td><td>${r.bodyRankWithinHead === null || r.bodyRankWithinHead === undefined ? "—" : `${r.bodyRankWithinHead} / ${report.jointPeak?.bodyCount ?? "?"}`}</td><td>${r.headRankWithinBody === null || r.headRankWithinBody === undefined ? "—" : `${r.headRankWithinBody} / ${report.jointPeak?.headCount ?? "?"}`}</td><td>${ratio(r.jPeakRatio)}</td><td>${number(r.jMax)}</td><td>${ratio(r.formalBestRatio)}</td><td>${number(r.jAtFormalRatio)}</td><td>${pct(r.jRetentionRatio)}</td><td>${pct(r.jLoss)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const recallMarkup = report.recallAudit ? `<h4>Recall Merge · 双通道召回</h4><p>Global Top10000：${report.recallAudit.globalTopJCount} · 每 Head TopK：${report.recallAudit.perHeadProtectedK} · PerHead 原始 / 去重：${report.recallAudit.perHeadRawCount} / ${report.recallAudit.perHeadUniqueCount} · 重叠：${report.recallAudit.overlapWithGlobalTopJ} · 仅 PerHead 新增：${report.recallAudit.addedOnlyByPerHeadCount} · 合并：${report.recallAudit.mergedRecallCount}</p><details><summary>指定候选 / 当前配置的 Head、Body 内部排名诊断</summary><pre>${escape(JSON.stringify(report.recallAudit.debugCandidates, null, 2))}</pre></details>` : "";
  return `<p class="hint">累计 ${formatSearchDuration(report.totalElapsedMs)} · 实际 BattleEngine 调用 ${report.totalBattleEngineCalls} 次 · 复用 ${report.reusedBattles} 次（${(report.cacheHitRate * 100).toFixed(1)}%） · 平均每场 ${formatSearchDuration(report.overallAvgBattleMs)}。平均耗时为各 Worker 战斗执行时长之和 ÷ 调用数；阶段进度与 ETA 使用包含子阶段的墙钟时间；耗时占比使用独占时间。取消或异常时仅包含已回传的调用数。</p>
    <div class="table-scroll"><table class="audit-table"><thead><tr><th>状态 / 阶段</th><th>耗时</th><th>占比</th><th>进度</th><th>候选/工作项</th><th>请求战斗</th><th>正式战斗</th><th>复用战斗</th><th>复用率</th><th>平均每场</th><th>正式执行/复用</th><th>吞吐 / 峰值候选</th><th>缓存命中率</th></tr></thead><tbody>${report.stages.map((row) => `<tr><td>${row.status === "completed" ? "✓" : row.status === "running" ? "▶" : row.status === "cancelled" ? "已取消" : "异常"} ${escape(row.stage)}</td><td>${formatSearchDuration(row.wallElapsedMs)}<small>独占 ${formatSearchDuration(row.exclusiveElapsedMs)}</small></td><td>${row.percentOfTotal.toFixed(1)}%</td><td>${row.completed}/${row.total}</td><td>${row.candidateCount}</td><td>${row.requestedBattles}</td><td>${row.executedBattles}</td><td>${row.reusedBattles}</td><td>${(row.cacheHitRate * 100).toFixed(1)}%</td><td>${formatSearchDuration(row.avgBattleMs)}</td><td>${row.executedBattles}/${row.reusedBattles}</td><td>${row.throughput?.toFixed(1) ?? "—"} ${row.executionWorkload ? row.executionUnit === "trajectory" ? "条轨迹" : "场战斗" : "工作项"}/s · ${row.peakCandidateCount}</td><td>${(row.cacheHitRate * 100).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div>
    <p class="hint">未分段的组装与调度 ${formatSearchDuration(report.unaccountedElapsedMs)}。仅列出本次实际执行的阶段；后续阶段候选数未知，不估算总剩余时间。</p>${bodyMarkup}${checkpointMarkup}${recallMarkup}${comparisonMarkup}${jointMarkup}`;
}
export function renderOptimizerPerformance(report: SearchPerformanceReport | null): string {
  return report === null ? "" : `<h3>高级调试 · 搜索性能</h3><details class="mini-details optimizer-performance"><summary>阶段耗时 · ${report.status === "running" ? "运行中" : report.status === "completed" ? "已完成" : report.status === "cancelled" ? "已取消" : "异常"}</summary><div class="optimizer-timing-body">${performanceReportBody(report)}</div><button class="btn btn-small" data-action="copy-optimizer-performance">复制性能报告 JSON</button></details>`;
}
