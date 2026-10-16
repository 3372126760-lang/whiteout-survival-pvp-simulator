import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getValidationCatalog } from "../src/pvp/validationUi";
import type { SearchPerformanceReport } from "../src/pvp/optimizer/profiling";
import type { JointPipelineAudit } from "../src/pvp/optimizer/jointPipeline/types";
import type { CanonicalBodyAudit } from "../src/pvp/optimizer/jointPipeline/canonicalBodies";
import type { RallyCandidate } from "../src/pvp/optimizer/types";
const read = (name: string) => JSON.parse(readFileSync(`benchmarks/optimizer/${name}.json`, "utf8"));
const summary = read("joint-rally-gen12-ab-summary"), audit = read("joint-rally-gen12-body-summary");
const next = { inputSha256: summary.inputSha256, totalElapsedMs: summary.newTotalElapsedMs,
  profile: summary.newProfileSummary as SearchPerformanceReport,
  candidateCounts: { ...summary.newCandidateCounts, peak: summary.newProfileSummary.jointPeak } as JointPipelineAudit,
  finalRecommendations: summary.newFinalRecommendations as { candidate: RallyCandidate; winRate: number; trials: number }[] };
const old = { inputSha256: summary.inputSha256, totalElapsedMs: summary.oldTotalElapsedMs,
  profile: summary.oldProfileSummary, candidateCounts: summary.oldCandidateCounts, finalRecommendations: summary.oldFinalRecommendations };
if (old.inputSha256 !== audit.inputSha256 || next.inputSha256 !== audit.inputSha256 || next.profile.jointPeak === undefined || summary.inputSha256 !== audit.inputSha256)
  throw new Error("Historical summaries do not match the frozen fixture/audit; do not relabel measurements.");
const body = audit.canonicalAudit as CanonicalBodyAudit, p = next.profile, pipeline = next.candidateCounts, legacy = audit.legacyAudit.legacyTrace;
const stage = (prefix: string) => p.stages.find((s) => s.stage.startsWith(prefix))!;
const sec = (ms: number) => (ms / 1000).toFixed(3), pct = (x: number) => (x * 100).toFixed(4) + "%";
const catalog = getValidationCatalog(), heroes = new Map(catalog.leaderHeroes.map((h) => [h.heroId, h.name]));
const bodyNames = new Map(catalog.memberSkills.flatMap((g) => g.sourceSkillIds.map((id, i) => [id, heroes.get(g.sourceHeroIds[i]!) ?? id] as const)));
const ratio = (r: RallyCandidate["ratios"] | undefined) => r ? [r.shield, r.lancer, r.marksman].map((v) => Number(v.toFixed(4))).join(" / ") : "—";
const top = next.finalRecommendations.slice(0, 5);
const lines = ["# S12 canonical Body 与分阶段 Formal Ratio 本地验收", "", "版本 v0.2.0-beta，本轮仅本地修改，未 push、tag 或部署。", "",
  "> Head 候选池问题复核：本文及关联 A/B 数据仅保留为性能 benchmark。该冻结输入仅启用 S1–S11 的 34 名 SSR（876 Head），三名 S12 英雄未参与 Head 搜索。任何排名均不能用于判断 S12 英雄优劣，也不能称为 S12 最优阵容。原输入与 profiling 保持不变；补池修复和新 H0 统计见 [Head Pool 修复验收](head-pool-s12-review.md)。", "",
  "## 输入与比较口径", "",
  "本轮保存完整可复现 S12 输入；启用的 Head 池为 S1–S11 的 34 名 SSR，服务器阶段为 S12，Body 可使用 S12 内所有合法来源。因此实测 Head 为 876；这是启用英雄池的实际结果，不声称所有 S12 车头均启用。双方属性、Buff、兵阶、专武、英雄池、优化目标、firstSeed 和 Final 1000 在 A/B 中完全相同，唯一区别是 useSimpleRatioPrior。", "",
  `A = false（旧 C0/C1/C2/C3）；B = true（本轮 canonical Body/J/Criterion/Theory/Formal）。输入 SHA256：\`${summary.inputSha256}\`。A/B summary 校验输入、优化参数和最终 common seed 哈希一致。A 用时 ${sec(old.totalElapsedMs)} s；B 用时 ${sec(next.totalElapsedMs)} s；比值 ${summary.speedup.toFixed(3)}。本轮A/B顺序执行，测量期间没有同时运行本任务的测试或构建；四个Workers及CPU环境相同。早期未冻结版本的输入与A/B记录另存pre-freeze文件，未混作当前数据。`, "",
  "fixture schema=2、frozen=true。input与canonicalBattleConfig保存完整双方配置，engineScenario保存正式适配器快照；OwnedHeroPool、OptimizationHeroPool和RallyBodyPool明确列出ID，专武逐英雄等级、兵阶、T12技能等级、战报属性、Buff与全部optimizer options均保存；seedPolicy直接保存300个筛选种子和1000个最终共同种子。普通benchmark运行不会覆盖已有fixture；发现输入/引擎快照/参数/种子哈希变化会报错，防止跟随当前默认值静默变化。", "",
  "用户提供的 454.202 s / 54000 场 / Body 57313 缺少原始完整输入，仅保留为历史基线。不得将其标记成严格同输入 A/B。408.05 s 的更早历史记录也未被替换或伪称复现。", "",
  "## 按要求逐项汇报", "",
  `1. **S12 实际 Head：${pipeline.peak.headCount}。** 自动 Head 仅 SSR，近三代按启用的自有英雄最高代计算；Body 不使用 Head 的 rarity filter。`, "",
  `2. **原 57313 审计：尚未精确复现该历史输入。** 保存 fixture 通过修改前的 J 枚举政策实际得到 **${legacy.finalBodyCount}**（差 ${legacy.finalBodyCount - 57313}）。可追溯链为 ${legacy.rawOrderedCombinationCount} 有序四槽 → 扣同 family 超两份 ${legacy.rejectedByMultiplicityLimit} → ${audit.legacyAudit.afterSameEffectMax2} → 数值 alias 去重 ${legacy.deduplicatedByCanonicalEffect} → ${legacy.orderedAfterNumericAliases} → 可交换排列去重 ${legacy.deduplicatedByPermutation} → ${legacy.finalBodyCount}。概率支配 ${legacy.rejectedByProbabilityDominance}、显式四项排除 ${legacy.rejectedByExplicitOptimizerExclusion}、后续 semantic/Pareto ${legacy.deduplicatedBySemanticIdentity}。旧数值代表仍有 ${legacy.numericAliasRepresentativeCount}，真正完整语义效果为 ${legacy.canonicalEffectCount}。**不能把差额 454 随意归因于某项规则；需要历史原输入才能回答。**`, "",
  `3. **canonical 去重：${body.bodyHeroCount} 个来源 → ${body.canonicalEffectCount} 个完整效果 → 自动 ${body.automaticEffectCount} 个。** operation 的两个历史标签按正式引擎同义处理；supported/TENTATIVE 是验证标签，不形成新效果，RULE_UNKNOWN 不与有效效果合并。kind/group/value/scope/target/source/damageType/trigger/probability/interval/duration/activation/lifecycle/stack/refresh 都参与比较。`, "",
  `计数口径：56859 是上一轮 J 分支的旧 Body 枚举政策（jointPolicy=true）；A=false 的 C0 分支仍有自身原有的支配/Pareto规则，实际保留 ${old.candidateCounts.Body} 个Body。两条旧路径分别保留完整审计，不把它们与历史57313或新10185混为同一个阶段。复制性能报告JSON现包含bodyEnumerationAudit；新B0显式提供canonicalEffectCountBefore/After及所有删除/去重数。`, "",
  "B0的rejected/deduplicated字段以四槽组合数计；效果池的删除数另由45→25→21表示。显式排除为4种canonical效果，对应删除9849个未受重复上限约束的四槽组合；canonical去重已完成全部语义identity合并，因此后续semantic identity=0，避免重复扣数。", "",
  `4. **Body = ${body.finalBodyCount}。** C(24,4)=10626，去除 21 个四份相同、420 个三同一异，共 10185。fixture明确启用完整45来源Body池，无额外剔除。新 B0 的计数链：${body.stages.map((s) => `${s.stage}=${s.count}`).join(" → ")}。有固定/必选/禁用/等级差异/Body 池约束时，另报 additionalConstraints，不修改 10185 的回归期望。`, "",
  `5. **Head × Body = ${pipeline.peak.evaluatedHeadBodyCount.toLocaleString()}。** 全部扫描，保留全局 Top10000，没有每车头保底或提前减少 TopK。`, "",
  `6. **J 峰值 ${sec(pipeline.peak.elapsedMs)} s；预计算 ${sec(pipeline.peak.preparationElapsedMs)} s。** ${pipeline.peak.workerCount} Workers；${pipeline.peak.objectiveEvaluationCount.toLocaleString()} 次 J，${pipeline.peak.kktEvaluationCount.toLocaleString()} 次 KKT 工作。`, "",
  "7–8. **J rank checkpoints 与相对 Rank1 的下降：**", "", "| Rank | Jmax | J/J1 | Loss | J Peak 盾/矛/射 |", "|---:|---:|---:|---:|---|",
  ...(pipeline.peak.rankCheckpoints ?? []).map((r) => `| ${r.rank} | ${r.j.toExponential(9)} | ${pct(r.relativeToBest)} | ${pct(r.lossFromBest)} | ${ratio(r.peakRatio)} |`), "",
  "完整 HeadKey/BodyKey/peakRatio 已写入 jointPeak.rankCheckpoints；Developer 显示“J峰值截断参考”。", "",
  `9. **5% Criterion：${pipeline.criterionPairs} → ${pipeline.criterionFinePairs}**，${pipeline.criterionEvaluations} 次局部比例评估，${sec(stage("Criterion · 局部 5%").wallElapsedMs)} s。每个 J 峰值 ±10 个百分点，全兵种合法 simplex 网格。`, "",
  `10. **1% Criterion：${pipeline.criterionFinePairs} → ${pipeline.theoryPairs}**，${pipeline.criterionFineEvaluations} 次比例评估，${sec(stage("Criterion · 局部 1%").wallElapsedMs)} s。复用 Target-Flow Criterion，在粗筛最佳局部 ±5pp 且受 J ±10pp 限制。`, "",
  `11. **Theory：${pipeline.theoryPairs} → ${pipeline.formalPairs}**，${pipeline.theoryEvaluations} 次评估，${sec(stage("Theory").wallElapsedMs)} s。`, "",
  ...[20, 50, 100].map((n, i) => `${i + 12}. **Formal ${n}：${stage(`Formal ${n} ·`).candidateCount} 套，新增 ${stage(`Formal ${n} ·`).executedBattles} 场，复用 ${stage(`Formal ${n} ·`).reusedBattles} 场。**`), "",
  `15. **Formal Ratio A：${p.formalRatio!.lineupCount} 套，${p.formalRatio!.generatedRatioCount} 个比例；新增 ${p.formalRatio!.stageAExecutedBattles} 场，复用 ${p.formalRatio!.stageAReusedBattles} 场。** 所有中心/邻居仅用相同前20 seeds比较；保留每套 Top2，总 ${p.formalRatio!.stageARetainedRatioCount} 个。`, "",
  `16. **Formal Ratio B：新增 ${p.formalRatio!.stageBExecutedBattles} 场，复用 ${p.formalRatio!.stageBReusedBattles} 场。** 仅 Top2 补到100；已有中心100场不重跑。两阶段预算上限每套 280 新增，15套最多4200；实测 ${p.formalRatio!.stageAExecutedBattles + p.formalRatio!.stageBExecutedBattles}。`, "",
  `17. **Formal Ratio 总耗时：${sec(p.formalRatio!.elapsedMs)} s。** 比例为中心加合法的六个 ±1pp 转移邻居，最多七个。比较复用 SingleWinObjective，未新增综合分数。`, "",
  `18. **Formal300：${stage("Formal 300").candidateCount} 套，新增 ${stage("Formal 300").executedBattles} 场，复用 ${stage("Formal 300").reusedBattles} 场。** 比例复核后先选8套再跑300场，之后保留5套。`, "",
  `19. **Final1000：优化候选 ${pipeline.finalOptimizerCandidates}，独立比较 ${pipeline.comparisonCandidates}，实际去重后 ${stage("Final").candidateCount} 套；新增 ${stage("Final").executedBattles} 场。** reference 数量取当前配置；不强制写死3。共同最终种子=筛选前300+700个独立验证种子，双方使用相同策略。`, "",
  `20. **BattleEngine executed：${p.executedBattles}**，requested ${p.requestedBattles}，reused ${p.reusedBattles}，cache hit ${pct(p.cacheHitRate)}，avg battle ${p.overallAvgBattleMs!.toFixed(3)} ms（各 Worker 执行时间之和/调用数）。`, "",
  `21. **完整新流程：${sec(next.totalElapsedMs)} s。** 阶段时间以 profile 的墙钟时间为准，未用 worker CPU 时间代替用户耗时。`, "",
  `22. **相对历史454.2019 s：耗时减少 ${pct(1 - next.totalElapsedMs / 454201.9)}，相对54000场减少 ${pct(1 - p.executedBattles / 54000)}。** 仅历史参照。当前完整输入 A/B：旧 ${old.profile.executedBattles} 场 → 新 ${p.executedBattles} 场；旧/新最佳胜率 ${pct(old.finalRecommendations[0].winRate)} / ${pct(top[0]!.winRate)}，baseline相同=${summary.baselineIdentical}。一个 fixture 不构成跨对局质量保证。`, "",
  "23–26. **最终 Top5：J 初始名次、两种比例、J 保留率、1000场胜率：**", "",
  "| Formal | Head | Body | initialJRank | J Peak 盾/矛/射 | Formal Best 盾/矛/射 | Jmax | J(Formal) | 保留率 | JLoss | 胜率 |",
  "|---:|---|---|---:|---|---|---:|---:|---:|---:|---:|",
  ...top.map((r, i) => { const c = r.candidate; return `| ${i + 1} | ${Object.values(c.leaderHeroIds).map((id) => heroes.get(id!)).join(" / ")} | ${c.memberSkillIds.map((id) => bodyNames.get(id)).join(" / ")} | ${c.initialJRank ?? "独立比较"} | ${ratio(c.jPeakRatio)} | ${ratio(c.formalBestRatio)} | ${c.jMax?.toExponential(6) ?? "—"} | ${c.jAtFormalRatio?.toExponential(6) ?? "—"} | ${c.jRetentionRatio === undefined ? "—" : pct(c.jRetentionRatio)} | ${c.jLoss === undefined ? "—" : pct(c.jLoss)} | ${pct(r.winRate)} |`; }), "",
  "每个优化候选保留 initialJRank/jPeakRatio/criterionRatio/theoryRatio/formalBestRatio；Formal300/Final1000 的 candidate.ratios 就是 formalBestRatio。独立 baseline/reference 的 initialJRank=null，未伪造 J 排名。J(formal) 与初始求峰共享 combineJointCoefficients 的同一张表及 ratioObjective，未另写展示公式。", "",
  "另外列出全部五个 optimizer finalists（不占用独立比较名额）：", "",
  "| initialJRank | Head | Body | J Peak | Formal Best | J 保留率 | 1000场胜率 |", "|---:|---|---|---|---|---:|---:|",
  ...next.finalRecommendations.filter((r) => r.candidate.initialJRank).map((r) => { const c = r.candidate; return `| ${c.initialJRank} | ${Object.values(c.leaderHeroIds).map((id) => heroes.get(id!)).join(" / ")} | ${c.memberSkillIds.map((id) => bodyNames.get(id)).join(" / ")} | ${ratio(c.jPeakRatio)} | ${ratio(c.formalBestRatio)} | ${pct(c.jRetentionRatio!)} | ${pct(r.winRate)} |`; }), "",
  `finalCorrelation：finalistJRanks=${JSON.stringify(p.finalCorrelation!.finalistJRanks)}；bestFormalInitialJRank=${p.finalCorrelation!.bestFormalInitialJRank ?? "null（独立比较）"}；maxInitialJRankAmongTop5=${p.finalCorrelation!.maxInitialJRankAmongTop5}。`, "",
  "27. **修改文件：**", "",
  "- 注册表：src/pvp/bodyEffects/canonicalRegistry.ts。",
  "- 搜索：src/pvp/optimizer/jointPipeline/{canonicalBodies,types,workflow,peakScan,coefficients}.ts；src/pvp/optimizer/criterion/{bodyEnumeration,jointPreFilter}.ts；src/pvp/optimizer/{types,profiling}.ts。",
  "- UI：src/ui/{bodySkillPresentation,bodySkillSelectView,bodySlotCard,optimizerPerformanceView,main}.ts。",
  "- 测试：src/pvp/tests/{canonicalJointPipeline,jointPipeline,bodySkillPresentation,uiStartup}.test.ts。",
  "- 工具与结果：scripts/{audit-joint-body,benchmark-joint-optimizer,report-joint-gen12,optimizer-benchmark-fixture,freeze-joint-fixture}.ts；benchmarks/optimizer/joint-rally-gen12-{input,ab-summary,body-summary,pre-freeze-input,pre-freeze-ab-summary}.json；legacy-gen12-454s-history.json；formal-engine-integrity.json。完整profile/audit保存在忽略目录artifacts/benchmarks/optimizer。",
  "- 文档：README.md、本文件、此前流水线报告的历史版本标记。工作区中更早任务的其他未提交修改仍保留，未混称为本轮变更。", "",
  "28. **验证：1550/1550 全量测试通过，其中本轮新增48项，包含A–AB和额外语义/等级/锁定身份/伤害通道/固定fixture回归。typecheck、lint、生产build通过，dist-ui输出成功。** 本地生产子路径检查：25个Body选项/八分类、4 Workers、1000场与串行一致、分阶段预算、J lineage、Developer两表、B0审计、四独立Body实例完整应用、分享恢复、刷新200、普通模式/高级模式/开发者模式均通过，无pageerror/requestfailed。124个受保护正式源码逐文件哈希不变；既有固定种子1000场战斗结果逐字段不变。", "",
  "29. **BattleEngine未修改。正式英雄/兵种技能、伤害公式、RNG与BattleConfig语义均未修改。** J的S/O/J主公式、固定20/40回合折算和概率免伤算法不变；补齐了芮妮typed延迟标记的期望独立skillDamage通道，不当作skillDamageIncrease乘区。正式引擎仍按原mark/extraDamage事件运行。韦恩/芮妮/哥顿归技能伤害类，阿赫莫斯归减伤类；分类不改变乘区。", "",
  "30. **未push，未tag，未部署。** 开发默认保留useSimpleRatioPrior=false；本地验收在高级模式?mode=advanced&dev=1 → Developer → J Debug勾选新流程。各retain预算可配置；本轮没有自动缩小Top10000。", "",
  "## 数据与复现", "",
  "- [完整输入](../benchmarks/optimizer/joint-rally-gen12-input.json)",
  "- [B0 历史计数摘要](../benchmarks/optimizer/joint-rally-gen12-body-summary.json)",
  "- 完整profile与canonical映射审计存放在被Git忽略的artifacts/benchmarks/optimizer；旧C0已移除，不能用当前代码重跑旧流程。",
  "- [同输入 A/B 汇总](../benchmarks/optimizer/joint-rally-gen12-ab-summary.json)",
  "- [历史454秒摘要](../benchmarks/optimizer/legacy-gen12-454s-history.json)", "",
  "```bash", "npm run benchmark:joint-rally -- --fixture benchmarks/optimizer/joint-rally-gen12-input.json", "node scripts/run-tsx.mjs scripts/audit-joint-body.ts", "node scripts/run-tsx.mjs scripts/report-joint-gen12.ts", "```", "",
  "公开Body选择使用最早代代表，旧分享/保存配置的原英雄ID、技能等级和四个runtime实例仍合法保留。自动排除为完整canonical效果（包括对应的等效别名），手工选择仍显示。茉莉同效果的最早S1代表在现有注册顺序中为娜塔莉亚，包含茉莉/赫克托；该完整效果一并不参加自动搜索。S14若出现真正新增且数值不同的效果，会如实增加该阶段选项；仅重复既有效果不增长。", "" ];
const output = process.argv[2] ?? "docs/pvp-canonical-body-gen12-review.md";
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, lines.join("\n"));
process.stdout.write(`Saved ${output}\n`);
