# benchmarks/optimizer 暂存数据审计

2026-10-15，v0.3.0-beta。审计起点是用户已执行 `git add -A` 的index：19个JSON，共4,026,665字节。先逐一读取暂存blob并保存本机备份，再检查代码依赖和完整输入，最后清理工作区并重新暂存。没有commit或push。

## A：必须保留的完整输入与测试基线

| 文件 | 原暂存字节数 | 保留原因 |
| --- | ---: | --- |
| `joint-rally-gen11-input.json` | 17806 | 唯一保存的Gen11实验完整双方输入与优化参数；J微测量脚本也读取它 |
| `joint-rally-gen12-input.json` | 64891 | 冻结的Gen12完整BattleConfig、optimizer config、引擎快照和精确共同种子；`canonicalJointPipeline.test.ts`直接读取 |
| `joint-rally-gen12-pre-freeze-input.json` | 17868 | 冻结前实验的唯一完整输入，与正式冻结版的哈希不同；不得因已有新版而删除 |
| `head-pool-s12-all-available-input.json` | 52086 | H0全可用S12的独立输入；审计脚本读取，不能用876 Head的旧输入替代 |
| `formal-engine-integrity.json` | 17351 | 辅助测试fixture，不是BattleConfig：124份正式源码的预期哈希；`canonicalJointPipeline.test.ts`直接读取，必须保留 |

以上4份既有输入与完整性基线不重写，不调整默认值或哈希。

另外新增 **`joint-recall-gen12-input.json`**：从原 `joint-recall-gen12-profile.json` 精确提取实际运行的canonical输入、完整optimizer config、引擎快照、300个筛选seed和1000个Final seed。它不是摘要，也没有猜测补齐字段。保留的input SHA256为 `1ea73d061bac6487e4788599ad0bbb406d28bee90a2a663854f47e49ee5df9cf`，与原profile一致；来源Head Pool原文件的哈希为另一规范化口径，不能只保留来源文件替代实际运行输入。

新增回归同时核对完整输入/配置/引擎/seed哈希、codec往返不改变输入、Head=1062、Body=10185，并验证seed损坏会拒绝。无需读取完整profile或运行整轮benchmark即可验证输入仍完整。

## B：保留精简历史与摘要

| 原文件 | 原暂存字节数 | 处理 |
| --- | ---: | --- |
| `joint-rally-gen11-ab-summary.json` | 87823 | 精简：保留A/B口径、输入/参数哈希、环境、耗时、场数、候选数、阶段计数和最终推荐；移除完整统计DTO和重复诊断树 |
| `joint-rally-gen12-ab-summary.json` | 113318 | 同上；保留J检查点、Formal Ratio与最终J相关性必需字段，供历史报告生成器读取 |
| `joint-rally-gen12-pre-freeze-ab-summary.json` | 112918 | 精简冻结前历史，保留对应旧输入哈希和推荐，不冒充正式冻结版 |
| `joint-peak-microbenchmark.json` | 1748 | 已是小型微测量摘要；保留当时环境、规模、耗时和串行/Worker等价结论，新运行不覆盖它 |
| `legacy-408s-history.json` | 1352 | 用户提供的历史耗时观察，缺少原始完整输入；原样保留 |
| `legacy-gen12-454s-history.json` | 714 | 用户提供的57313 Body/454.202秒观察，不能声称严格同输入复现；原样保留 |
| `matchup-652-history.json` | 1710 | 用户提供的65.2%/8.4%观察及未知字段；原样保留，不推断缺失配置 |

从完整输出另提取3份小型历史摘要：

- `head-pool-s12-all-available-summary.json`：1062/876 Head、参与池、近代窗口及来源哈希。
- `joint-rally-gen12-body-summary.json`：历史57313、可复现56859、差额-454，以及canonical 45→25→21→10185的逐层计数。
- `joint-recall-gen12-summary.json`：J空间、Global/PerHead/重叠/并集、候选数、正式场数、耗时和精简最终推荐；完整输入独立链接到A类文件。

摘要保留被归档原件的暂存SHA256和项目相对路径；历史计时与胜率没有重测或改写。处理后B类共10份，不含完整配置副本、逐候选轨迹或巨大的诊断树。

## C：完整profile/audit移出Git

| 原文件 | 原暂存字节数 | 实际依赖与归档处理 |
| --- | ---: | --- |
| `joint-rally-gen11-old-profile.json` | 296467 | 无测试直接读取；历史数据已进入精简A/B摘要，完整原件本机归档 |
| `joint-rally-gen11-new-profile.json` | 61854 | 无测试直接读取；同上 |
| `joint-rally-gen12-old-profile.json` | 2689341 | 无测试直接读取；大部分体积是完整Criterion诊断与采样integrity树，保留必要历史摘要后归档 |
| `joint-rally-gen12-new-profile.json` | 169487 | 只有历史报告工具读取，已改为读取B类摘要；完整原件归档 |
| `joint-recall-gen12-profile.json` | 278398 | 原来内含唯一的实际canonical快照和精确种子；先提取到A并核对哈希，再提取B摘要，最后归档 |
| `joint-rally-gen12-body-audit.json` | 31303 | 无测试直接读取；完整canonical映射可由输入与注册表生成，历史逐层计数留在B |
| `head-pool-s12-all-available-audit.json` | 10230 | 无测试直接读取；H0可重新生成，历史计数留在B |

7份原始文件移至被忽略的 `artifacts/benchmarks/optimizer/archive-staged/`，不是直接销毁。原19份暂存blob另保存在本机 `artifacts/benchmark-staging-audit/original-staged/`，包含精简前的summary备份。

**当前运行结果可再生成，不代表旧流程可重跑。** 旧C0/C1/C2/C3已删除，当前代码不能重新产生当年的旧profile，也不承诺相同墙钟耗时。旧原件作为本机历史资料归档，Git保留原输入、原数值与来源哈希；不恢复旧执行分支。

没有任何完整profile是测试直接读取的正式fixture。必须保留的是A类输入及哈希基线，而不是这些完整运行输出。

## 默认输出与文档

- 联合benchmark默认读取A类recall输入，完整profile写入 `artifacts/benchmarks/optimizer/joint-recall-gen12-profile.json`。
- Head/Body审计与J微测量默认写入同一忽略目录，自动创建输出目录。
- `.gitignore`额外禁止 `benchmarks/optimizer/*-profile.json`、`*-audit.json` 再次误入暂存；不忽略输入、summary、history或完整性基线。
- 两个历史报告生成器只读取Git内摘要与完整输入，不再依赖完整profile；可将生成文档输出到单独的本机路径验收。
- 已更新README、benchmark说明和历史报告引用，公开链接不再指向被移走的文件。

处理后保留16个JSON：5份完整输入、1份必要哈希基线、10份精简摘要/历史，合计约0.36MB；原暂存约4.03MB。未修改战斗引擎、技能、RNG或伤害公式。

## 验证

- 数据检查：四份原有输入逐字节保持一致；7份归档原件与原暂存blob一致；原有小型历史记录保持一致；A/B原耗时、场数、阵容、比例和胜率保持一致。
- `npm.cmd run typecheck`、`npm.cmd run lint`通过。
- 两个输入相关测试文件59/59通过；默认全量 `npm.cmd test` 为125/125文件、1560/1560项通过。新增1项用于保护提取的完整recall输入及候选空间，不读取完整profile。
- 两个历史报告生成器在没有原完整profile的工作目录中，成功从Git内摘要生成文档到忽略目录，未出现缺失数值。
- H0和Body audit实际运行成功，默认完整输出均进入忽略目录；H0=1062，旧J Body=56859，canonical Body=10185，未运行完整战斗benchmark。
- 124份正式源码完整性校验通过；本轮没有修改战斗引擎、技能、RNG或伤害公式。
