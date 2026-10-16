import type { JointJLineage, RecallSource } from "../pvp/optimizer/jointPipeline/types";
const ratio = (value: JointJLineage["jPeakRatio"]) => value ? `${value.shield.toFixed(2)} / ${value.lancer.toFixed(2)} / ${value.marksman.toFixed(2)}` : "—";
const number = (value: number | undefined) => value === undefined ? "—" : value.toExponential(8);
const pct = (value: number | undefined) => value === undefined ? "—" : `${(100 * value).toFixed(2)}%`;
export function recallSourceLabel(sources: readonly RecallSource[] = []): string {
  const auto = sources.includes("globalTopJ") || sources.includes("perHeadBestJ");
  const rows = [auto ? "本轮自动搜索" : "", sources.includes("currentConfig") ? "当前配置（保护复验）" : "",
    sources.includes("protectedReference") ? "Protected Reference（保护复验）" : ""].filter(Boolean);
  if (!rows.length) return "其他保护通道 / 未记录来源";
  const channel = sources.includes("globalTopJ") && sources.includes("perHeadBestJ") ? "Both：Global Top10000 + PerHead Best" :
    sources.includes("globalTopJ") ? "Global Top10000" : sources.includes("perHeadBestJ") ? "PerHead Best" : "";
  return rows.join(" + ") + (channel ? ` · ${channel}` : "");
}
export function renderJointCandidateDiagnostics(candidate: JointJLineage): string {
  const rank = candidate.initialGlobalJRank ?? candidate.initialJRank;
  return `<span class="joint-candidate-diagnostics"><br>Head×Body J峰值全局排名：${rank ? `#${rank}` : "—（未进入 Global Top10000 或不在搜索域）"}<br>
    J理论峰比例：${ratio(candidate.jPeakRatio)}<br>Jmax：${number(candidate.jMax)}<br>
    当前对局正式最优比例：${ratio(candidate.formalBestRatio)}<br>该比例J：${number(candidate.jAtFormalRatio)}<br>
    保留理论峰值：${pct(candidate.jRetentionRatio)} · J牺牲：${pct(candidate.jLoss)}<br>
    Head内部 Body 排名：${candidate.bodyRankWithinHead ?? "—"} · 固定Body时 Head 排名：${candidate.headRankWithinBody ?? "—"}</span>`;
}
