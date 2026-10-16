import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertMeasuredOptimizerFixture, benchmarkHash, type MeasuredOptimizerBenchmarkFixture } from "./optimizer-benchmark-fixture";
import type { JointPipelineAudit } from "../src/pvp/optimizer/jointPipeline/types";
import type { SearchPerformanceReport } from "../src/pvp/optimizer/profiling";
interface RecordedBenchmark {
  inputFixture: string; inputSha256: string; optimizerConfigSha256: string; totalElapsedMs: number;
  profile: SearchPerformanceReport; candidateCounts: Pick<JointPipelineAudit, "finalOptimizerCandidates" | "comparisonCandidates">;
}
const path = "benchmarks/optimizer/joint-recall-gen12-summary.json";
const report = JSON.parse(readFileSync(path, "utf8")) as RecordedBenchmark;
const fixture = JSON.parse(readFileSync(report.inputFixture, "utf8")) as MeasuredOptimizerBenchmarkFixture;
assertMeasuredOptimizerFixture(fixture);
assert.equal(benchmarkHash(fixture.input), report.inputSha256);
assert.equal(benchmarkHash(fixture.optimizerConfig), report.optimizerConfigSha256);
const p = report.profile, j = p.jointPeak!, r = p.recallAudit!, pipeline = report.candidateCounts;
const sec = (ms: number) => (ms / 1000).toFixed(3);
const c5 = p.stages.find((stage) => stage.stage.startsWith("Criterion") && stage.stage.includes("5%"))!;
const testPath = "artifacts/dual-recall-tests.json";
const tests = existsSync(testPath) ? JSON.parse(readFileSync(testPath, "utf8")) as { numPassedTests: number; numFailedTests: number } : undefined;
const testSummary = tests?.numFailedTests === 0 ? `最近全量${tests.numPassedTests}项测试通过` : "全量测试结果以本机 artifacts/dual-recall-tests.json 为准";
const lines = ["# 双通道召回与完整 Benchmark Fixture 本地验收", "",
  "v0.2.0-beta；本轮未 push、tag、部署。正式战斗引擎、英雄/兵种技能、RNG 和伤害公式均未修改。", "",
  "## 唯一集结优化流程", "",
  "H0 → B0 → J Preparation → J Peak → Recall Merge → Criterion 5% → Criterion 1% → Theory → Formal20 → Formal50 → Formal100 → Formal Ratio A → Formal Ratio B → Formal300 → Final1000（若配置更高最终场次则使用该设置）。", "",
  "旧 C0 HeadRatio、C1边际扫描、C2/C3联合流程及其 orchestration 已删除，不再提供执行分支。单波搜索公开入口仅调用 createPeakJointWorkflow；旧 feature flag、UI checkbox、R0 worker消息/协调器和旧对照执行脚本已移除。旧性能 JSON/说明与冻结输入只作为历史记录保留。公共 Criterion、Theory、Body枚举、共同种子账本及其他场景使用的公共算法继续保留；多波目标仍复用新单波结果后的现有公共多波算法。", "",
  "## 召回及排名", "",
  "每个分片在原来的完整 J 扫描中同时维护 Global Top10000 和每个 Head 的 TopK。默认 perHeadProtectedK=1，不自动扩大。按 Head+Body 索引去重；重叠项同时记录 globalTopJ / perHeadBestJ，合并集合按原 J / HeadKey / BodyKey 次序排序。全局10000名额不被挤占。", "",
  "每个后续候选保留 recalledBy；currentConfig 与 protectedReference 只在 Final 比较，不占用自动搜索晋级预算。若自动候选与保护项完全相同，来源合并；不会因为后来计算出保护项的 J 排名而把它标成自动召回。", "",
  "最终候选、当前配置及 jointDebugCandidates 通过相同系数与峰值求解器计算 bodyRankWithinHead / headRankWithinBody。只按所需 Head 或 Body 轴补算并缓存，不保存或重扫完整 H×B 矩阵。超出搜索域的英雄、Body、实际专武/兵阶返回空排名与原因。排名分母为本次搜索域：固定Body只有1个Body时的第1名不代表全10185 Body内第1名。", "",
  "后半段默认保留数不变：1500 → 500 → 200 → 80 → 30 → 15；比例复核后8套进入300场，保留5套优化项进入Final；当前配置与引用项独立比较。", "",
  "## 可复现 S12 验收输入的实测", "",
  "此表仅对应项目已有的 S12 全可用验收输入，**不是65.2%对8.4%的原始对局**。本轮顺序执行，没有同时运行本任务的测试、构建或浏览器模拟。旧876 Head / 408秒 / 454秒数据不能作为本次严格同输入速度对照。", "",
  `输入：\`${report.inputFixture}\` 保存实际运行的完整canonical配置、优化参数、正式引擎快照和精确种子；历史精简统计见 \`${path}\`。与原profile的inputSha256核对一致：\`${report.inputSha256}\`。完整profile仅保留在忽略目录artifacts/benchmarks/optimizer。`, "",
  "| 项目 | 实测 |", "| --- | ---: |",
  `| S12 eligible Head | ${j.headCount} |`, `| canonical Body | ${j.bodyCount} |`, `| 完整 Head×Body J 扫描 | ${j.evaluatedHeadBodyCount.toLocaleString("en-US")} |`,
  `| Global Top J 数量 | ${r.globalTopJCount} |`, `| Global Top10000 cutoff J | ${j.top10000CutoffJ} |`,
  `| J10000/J1 | ${((j.rankCheckpoints?.find((row) => row.rank === 10000)?.relativeToBest ?? 0) * 100).toFixed(6)}% |`,
  `| 默认 perHeadProtectedK | ${r.perHeadProtectedK} |`, `| PerHead 原始 / 唯一 | ${r.perHeadRawCount} / ${r.perHeadUniqueCount} |`,
  `| 与Global重叠 | ${r.overlapWithGlobalTopJ} |`, `| 仅PerHead新增 | ${r.addedOnlyByPerHeadCount} |`, `| 合并RecallSet | ${r.mergedRecallCount} |`,
  `| Criterion5%总耗时 | ${sec(c5.wallElapsedMs)} s |`, `| 新增项Criterion5%实际用时 | ${sec(r.addedOnlyCriterionElapsedMs ?? 0)} s |`,
  `| 排名诊断补算的J峰 | ${r.rankDiagnosticPeakEvaluations} |`, `| BattleEngine实际场数 | ${p.totalBattleEngineCalls} |`,
  `| 总优化时间 | ${sec(report.totalElapsedMs)} s |`, `| 最终冠军来源 | ${r.bestFormalRecallSource.join(" + ")} |`,
  `| Final优化项 / 独立比较项 | ${pipeline.finalOptimizerCandidates} / ${pipeline.comparisonCandidates} |`, "",
  "新增项耗时是本次单一流程中对仅PerHead候选测得的粗筛成本，不是完整优化的新旧A/B时间差。后续候选组成改变会影响Theory/正式执行成本，不能从这一项推算总增量。未取得同输入的旧全局独占流程耗时，故不报告虚构speedup。", "",
  "## 65.2%真实案例：保留观察，等待完整输入", "",
  "用户确认没有单独保存完整canonical配置；目前浏览器仍保留该对局。历史观察永久保存在 benchmarks/optimizer/matchup-652-history.json，原配置缺失处保持空值。", "",
  "已知 Head：Hervor / Lloyd / hero.s3.gelaige；Body：玲奈 / 哥顿 / 加托 / 亨德里克；正式比例64/36/0，1000场约65.2%。报告的Jmax约2.011664784448075e12，J峰约69.06375/25.43620/5.50005；固定此Body时Head排名161/1062。它低于历史Global cutoff约3.957446969652563e12，因此历史纯全局截断不能召回。", "",
  "**bodyRankWithinHead、该Head真正Top1 Body、Top1是否救回、最低K、是否再次找到64/36/0及约65.2%、真实局冠军来源及总时间：均待用户导出的完整Fixture验证。** 没有猜测属性/Buff/容量/兵阶/T12/专武/种子，也没有把本轮另一份输入的数据套到该案例。", "",
  "新代码会自动为currentConfig给出两种内部排名及该Head的最高J Body；也可通过jointDebugCandidates指定独立诊断对象。Top1不够时保留实际排名作为最低K，不会偷偷扩大默认K或改J。数学回归另外构造了Body排第8、Top1不能救回、Top8可覆盖的反例；它不代表65.2%案例需要K=8。", "",
  "## Developer UI", "",
  "高级调试 · 搜索性能直接显示“J峰值截断参考”：#1/#10/#100/#1000/#2000/#5000/#10000、Jmax、相对Rank1、损失、峰值比例、cutoff和J10000/J1。最终表明确区分Head×Body自己的J峰值与当前对手正式最优比例下的J，显示两个内部排名和来源。公开推荐卡也标注本轮自动搜索、当前配置保护或Protected Reference。", "",
  "入口：?mode=advanced&dev=1 → 开发工具 → Theory / Criterion。完整优化Benchmark Fixture支持下载JSON、复制JSON、粘贴导入、选择文件导入、导入并一键复跑。", "",
  "导出内容：完整A/B canonical BattleConfig、scenario/serverStage、当前英雄/实际专武/Body/技能等级、兵阶及混编、12项属性、Buff、T12技能、容量与配比、集结配置、有效Owned/Optimization/RallyBody池、全部预算与retain、K、目标与侧、固定Head/Body条件、firstSeed/randomSeed、确切筛选/Final共同种子、正式引擎快照和哈希及Head/Body候选数量。", "",
  "导入先通过现有canonical codec，再核对输入/优化参数/引擎快照/精确seed哈希和候选空间。校验失败不会覆盖页面。统计结果受正式机制版本约束，本轮相同版本同seed的微型真实Worker验收与串行结果完全一致。", "",
  "Fixture与正式流程共用Head约束解析：固定Body的必选英雄不会误算成必选Head；空Head与最终战报模式记录真实固定原因。完整统计仍按正式流程相同的Head排序及canonical Body域计算。", "",
  "## 验证与边界", "",
  `${testSummary}；typecheck、lint、生产build通过，输出dist-ui。124份正式引擎/技能/兵种/伤害/RNG源码的既有哈希保持一致。测试覆盖完整J扫描、全局TopK不变、PerHead真实argmax与峰比例、K默认与配置、分片/去重/并集上界、来源保护、两个内部排名、S12到S16动态池及真实最高拥有代、R/SR Head/Body边界、10185 Body、完整Fixture重载和真实固定seed结果。`, "",
  "生产子路径浏览器检查全部通过：旧开关不存在、复制完整Fixture、下载与复制哈希相同、刷新后导入、一键复跑、真实Web Worker Final1000等于同输入串行、recall字段跨Worker传递、Developer表格、保护来源、文件导入恢复K。截图与浏览器记录在忽略目录artifacts/dual-recall-review。", "",
  "Legacy optimizer是否删除：YES（旧集结C0/C1/C2/C3可执行流程）。Global Top10000保留：YES。PerHead保护：YES。默认K：1。65.2%能否被Top1救回 / 最低K：待原Fixture，尚未判定。BattleEngine修改：NO。技能机制修改：NO。push：NO。部署：NO。", "" ];
const output = process.argv[2] ?? "docs/dual-channel-recall-review.md";
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, lines.join("\n"));
process.stdout.write(JSON.stringify({ headCount: j.headCount, bodyCount: j.bodyCount, headBody: j.evaluatedHeadBodyCount,
  cutoff: j.top10000CutoffJ, perHead: r.perHeadRawCount, overlap: r.overlapWithGlobalTopJ, merged: r.mergedRecallCount,
  addedCriterionMs: r.addedOnlyCriterionElapsedMs, totalElapsedMs: report.totalElapsedMs, battleEngineCalls: p.totalBattleEngineCalls }, null, 2) + "\n");
