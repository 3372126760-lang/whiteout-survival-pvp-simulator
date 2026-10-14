# PVP 集结配队优化器

2026-10-08 最新流程保留 Criterion 联合搜索与 Racing。第五轮固定最终战报车头与实际专武，支持合法 EMPTY_HEAD / EMPTY_BODY，完整扫描固定车头下 231 个比例×车身；详见 [第五轮交付报告](pvp-criterion-optimizer-round5.md)。下述大型车头搜索仅适用允许生成新车头的预测模式；最终战报不使用车头英雄池或近期限制。FastBattleMode、Worker、模板及正式战斗规则继续复用。本文最后两节保留旧版本历史验收。

本模块位于 `src/pvp/optimizer/`，不修改战斗引擎。输入沿用 Validation UI 的 `ValidationBattleInput`；集结双方各自以 `rallyDeployment = { totalTroops, ratios }` 输入，现有最大余数分配器将比例确定性地转换成整数兵数。三兵种各用一个等级，允许比例为 0。比例不是 100% 时，UI 禁止启动模拟。

预测模式的集结容量按 `floor((基础容量 + 固定容量 + 宠物等级×1500) × (1 + 百分比容量增益))` 计算；宠物容量等级支持 Lv0–10，仅改变出征人数。最终战报模式直接使用输入兵数。

## 搜索与比较

- `SearchConstraint` 支持阶段、拥有/启用英雄范围、必选/禁用、固定车头/部分车身和位置约束。英雄类别分为 R / SR / S，只有 S 类具有 `sGeneration`。**服务器进度达到 S3 时，Head 优化域排除所有 R/SR**；S2 及更早仍允许。注册表、手动阵容与独立车身池保留 R/SR。近三代窗口仅由启用、拥有、服务器合法的 S 类英雄最大 `sGeneration` 计算，要求生成的完整 Head 至少包含一名窗口内 S 英雄；详见 [Round 4 类别与车头审计](criterion-head-pool-and-category-round4.md)。
- `OptimizationConfig.candidateSide` 选择 A 集结进攻方或 B 集结防守方，默认 A。`RallyCandidate` 仅改变所选侧三个车头、四槽车身技能和兵种比例，对手及其余战斗配置固定。双方使用完整 H0～Final，并按正式角色过滤技能。C0 扫描全部硬规则合法 Head × 231 个 5% 比例，按理论潜力和 GLOBAL uncertainty / special mechanism / disagreement / diversity lanes 竞争，默认全局约 2000 HeadRatio。**没有 per-head 最低代表数**，弱 Head 的全部比例可以在 C0 淘汰。
- Body Enumeration 是四槽 DFS。在添加第 3/4 槽时即检查 `effectFamily` 计数，**同效果族最多 2 次**；允许 A+B+C+D、A+A+B+C、A+A+B+B，不按不同英雄数限制。组合后复用严格下位、等期望概率稳定性下位和 Pareto 预处理；同乘区边际收益是每个 HeadRatio 的软评分，不伪装成通用技能下位。默认保留有序槽位；明确开启 `equivalentMemberPositions` 才合并排列。
- 预处理车身与 C0 留下的 HeadRatio 先 Rough 联合扫描，每个 HeadRatio 默认至多 24 个 Matrix 候选；联合结果再 GLOBAL 竞争约 4000 个 DeterministicTheory 和约 1500 个正式候选。这些数字是可配置预算，不是性能报告中的实测量。
- 当前精确配置与明确记录的参考候选是比较例外，同阶段使用共同种子；Final 均按请求高样本复验。推荐按同批正式结果排序，包含 baseline，不能低于本次 baseline 的已测胜率。1% 微调针对全局入围的联合候选，不为每个 Head 重新建立保底。

### 当前默认正式 Racing

| 阶段 | 每候选累计场次 | 全局晋级预算 |
| --- | ---: | ---: |
| M1a | 5 | 300 |
| M1b | 20 | 80 |
| M2 | 50 | 25 |
| M3 | 100 | 10 |
| M4 | 300 | 5 |
| Final | 1000 | 默认 Top 5，另记录精确 baseline / 明确参考例外 |

M1a 是共享种子 paired probe，晋级合并 C3 Theory、MatrixCriterion、配对表现、不确定性、特殊机制和分歧通道；不是 5 场胜率直接 Top36。5 场的 confidence elimination 必须为 0。

普通 / 高不确定性候选累计 20 / 40 场后才允许相应置信淘汰，可配置更高阈值；这是候选的统计门槛，不是每个 Head 必须保到 20 场。理论预算淘汰和 Monte Carlo confidence 淘汰分别审计。

UI 直接编辑 Criterion 的全局 C0、累计场次和晋级数；已移除“每套至少进入正式候选”与旧 M1/M2/M3 keep 字段。新导出包含 `racingVersion: 3`；只在加载旧存储时升级旧预算，正常 API 显式自定义阶段保持语义。

- `singleWin` 搜索阶段在 Wilson 95% 区间重叠时也比较我方剩余兵数；最终统一复验严格按胜率优先排序，胜率相同再比较剩余兵数。Wilson 区间描述**胜率估计不确定性**；P5/P50/P95 描述**每场兵数结果分布**，两者不能混用。
- `minRallies` 先最小化达到目标击破概率的波数，再比较该波累计击破率、前一波累计击破率和敌军剩余兵数。`auto` 在最终复验单波最高胜率不超过低阈值时切换多波；高阈值以上仍按单波胜率及自损比较。阈值与模拟预算均在 `OptimizationConfig` 中配置。

## 车身定义与运行时身份

正式手动战斗允许同一英雄定义占据多个槽位，例如书允 ×4；优化生成候选遵守同效果族最多 2 次，因此该手动例子不会成为生成的优化组合。`heroDefinitionId` 用于读取英雄名称、技能与静态数据；旧 `heroId` 保留为相同定义 ID 的兼容别名。`runtimeInstanceId` 用于战斗状态、技能状态缓存、增益来源、技能日志与附加事件身份。

| 槽位 | heroDefinitionId | runtimeInstanceId |
| --- | --- | --- |
| A 车身 1 | hero.body.shuyun | A-body-0 |
| A 车身 2 | hero.body.shuyun | A-body-1 |
| A 车身 3 | hero.body.shuyun | A-body-2 |
| A 车身 4 | hero.body.shuyun | A-body-3 |

B 同理使用 B-body-0 至 B-body-3。ID 按稳定槽位生成，不使用随机数，不随 render 改变。初始化现在检查 runtimeInstanceId 非空且侧内唯一；车头英雄定义重复及车头兵种位置限制保持原规则。旧状态/配置只有 heroId 时，在载入或战斗初始化时补齐定义与实例字段；新配置只提供 heroDefinitionId 时也能通过存储解码。保存后保留两种 ID。

四个相同车身的技能状态分别带 ownerRuntimeInstanceId；逐行动缓存、状态写回与 effect source 使用实例 ID，避免覆盖其他槽位。技能定义、数值、概率、时序及伤害/HP 公式未调整。候选生成允许同定义在效果族上限内重复，也允许四种不同英雄；实例化时给每个槽位分配独立 ID。已删除“最多两个不同车身定义”的旧限制。

回归覆盖书允 ×4、真正重复或空实例 ID 拒绝、车头定义规则、独立 proc/cooldown/增益来源、旧配置迁移、B 侧 ID、固定种子保存恢复和优化候选实例化。2026-10-04 的 776/776 是历史验收，当前全量结果见第三轮报告。

## 多波状态

每条 Monte Carlo trajectory 独立运行。下一波**只继承该条轨迹上一战的敌方盾/矛/射整数剩余兵数**，绝不按初始比例重新分配，也不把多条轨迹的平均兵数当成一支实际敌军。每波重新创建 BattleState：A 方完整新集结，B 方仅数量减少；双方 HP、残血、回合、技能计数、临时效果、RNG 状态全部从新战斗开始。不同波可选不同 `RallyCandidate`。

序列候选采用有限宽度 beam search。每个候选均用真实随机状态样本排名；扩展序列时从头重跑其完整轨迹，不用唯一均值状态作为下一波敌军。最终方案使用独立高样本 seed 对完整串联轨迹重新验证。Beam 剪枝和有上限的英雄候选生成是近似算法，结果**不是全局最优证明**。若在 `maxWaves` 内达不到目标，`targetWaves` 为 `null`，不能误报为击破。

优化器单战、多波及三队列使用 `FastBattleMode`，只保留胜负、回合和剩余兵数。静态技能解析在候选之间缓存，初始战斗模板在阶段之间复用。UI 最多使用四个候选 Worker；粗/复筛可提前停止统计上明显落后的候选，最终及当前方案完整复验。集结默认累计 5/20/50/100/300 后统一复验 1000，晋级预算见上表；单撞/333 和三队列使用各自现有配置，不用该表冒充其运行预算。单场调试与既有批量模拟保持原行为。实现与性能验证见 [优化器性能文档](pvp-optimizer-performance.md)。

## 基准

运行 `npm run benchmark:optimizer`。脚本实际调用 PVP 引擎，除候选、1000 场复验和多波轨迹外，还比较 compact/快速模式、技能解析缓存、三队列完整日志/模板模式。输出实测耗时与实际执行回合数。此基准不能代表 1500 回合及复杂英雄阵容的耗时；这类场景仍需要执行大量真实战斗回合。

## 历史记录：2026-10-05 车头搜索验收

已移除最终战报模式渲染时的自动车头锁，v2 自动保存的旧锁迁移时清除并提示重新选择。预算内搜索覆盖三名车头与联合组合，合法对手车头参照保留到最终复验；调试信息区分合法搜索空间与实际已评估组合。真实引擎 1000 场合成回归：当前 3.5%，手动换头 51.3%，自动搜索 72.0%。全量 792/792 通过。详见 [两项修复与验证报告](pvp-report-bonus-and-head-search-fix.md)。

## 历史记录：完整车头覆盖修复（2026-10-05）

本节是旧实现验收记录。当前 C0 可整体淘汰弱 Head，不再要求每个合法车头都进入正式 Engine；最新行为以上文及第三轮报告为准。

- 输出 `legalHeadCandidateCount`、`evaluatedUniqueHeadCandidateCount`、`headCoverageRate`，口径均为 Stage 1；`evaluatedHeadLineups` 是实际战斗调用得到的独立车头集合，不是理论枚举列表。
- 输出 `fixedBody`、`availableBodyCandidateCount`（合法生成的车身组合数）、`bodyCandidateCount`（实际访问的独立车身组合数）。固定四槽或明确固定车身时数量 1 正常；未固定时独立搜索整套单英雄/双英雄车身替换，避免只换一个槽而被“两种英雄”约束卡住。
- 15×16×16 回归实际执行全部 3840 套车头。此覆盖用例每比例 1 场、最多 1 回合，只验证引擎调用与覆盖率，不用于推断胜率。这是历史实现记录；当前 M1 为每代表比例 5 场，最终 1000 场，Theory 完整扫描先行。
- 合法的“复制 B 车头到 A”进入 Stage 1，并作为当前比例参照保留到最终同种子完整复验；B 不修改。
- UI 与优化器通过同一属性 builder 构建正式属性。详见 [本轮三项修复报告](pvp-expected-head-ocr-fix.md)。
