# 场景配队优化交付说明

2026-10-06 最新优化搜索：新增自动英雄稀有度／近三代规则、保守支配审计、多个盆地连续 5% 爬坡和局部 1% 精搜。理论 35%/65% 权重与最终正式 BattleEngine 复验保留，核心战斗和技能规则未修改。详见 [本轮交付与验收报告](docs/pvp-basin-search-and-hero-policy.md)。


## 场景路由与界面

顶部“配队优化”在四种场景均可打开当前场景面板。`src/ui/optimizerRoute.ts` 映射 `SINGLE → single`、`THREE_THREE_THREE → 333`、`THREE_QUEUE → threeQueue`、`RALLY → rally`。单撞、333、三队列和集结各自显示相应的搜索参数与结果。

旧页面把顶部按钮限定为 `battleContext === "rally"`，但仍在除三队列外的页面渲染 `renderOptimizer()`；这个函数原来只生成 Rally 参数。旧 Rally 搜索结果返回到 `optimizationResult`，结果组件却排在配置、批量统计之后，页面没有跳转和应用入口。现在结果直接位于当前优化面板后，并在搜索完成时滚动到结果。搜索中显示阶段进度，失败显示错误。

## 单撞与 333

`src/pvp/optimizer/scenarioOptimizer.ts` 提供 `SingleScenarioOptimizer` 和 `ThreeThreeThreeScenarioOptimizer`。单撞固定一侧对手与双方兵种等级，搜索所选一方三个兵种的车头英雄和整数百分比兵种比例。比例基点步长为 100（即 1%）；搜索采用确定性抽样粗筛、局部 1% 细筛及独立种子最终复验，属于有预算的近似搜索，不声称遍历所有英雄与 5151 种比例的笛卡尔积。333 的比例保持场景规定的 1:1:1，只搜索车头英雄。所有英雄来源复用当前 ServerStage 可用目录。

每个候选通过 `compileValidationBattle` 执行当前场景的真实 BattleEngine 试验；粗筛、二阶段和最终复验使用从固定 root seed 派生的共同种子组。最终 Top K 只按最终复验胜率排序。当前方案以未修改的原始输入、同一最终种子组复验；提升值是胜率百分点（pct）。

搜索不改页面战斗配置。点击应用后，只更新所选一方的车头，以及单撞的盾/矛/射兵数；333 只更新车头。应用经过 ServerStage sanitize 与场景预检，再由页面原有 autosave 保存。搜索选项作为 schemaVersion 2 的可选字段随自动存档、命名方案和 JSON 导入导出保存；旧配置缺字段时加载默认选项。

## Rally

Rally 保留原有分阶段单波搜索与 Beam 多波搜索。修复 `candidateToInput`：每个候选都构造自己的 `BodySkillConfig[]`，保留同一技能原有等级，并且只写入远征一技能。旧代码只改 `selectedMemberSkillIds`，却保留旧 `bodySkills`；战斗适配器优先读取后者，导致搜索中的车身替换未真正用于战斗。

结果面板显示当前方案、推荐方案、同种子最终复验胜率、Top K、固定项、多波路径每波配置与累计击破概率。未达目标时显示 `target_not_met`、最高已找到概率和最佳近似路径。单波候选可直接应用；多波路径可将第 1 波方案写回当前配置。页面当前配置只能代表一波，多波后续波次保持在结果面板供查看，不自动写入当前配置。Rally 最终单波结果来自真实 BattleEngine 复验，多波路径来自 `runFreshTrial` 的独立轨迹复验。

## 三队列

`src/pvp/optimizer/threeQueueOptimizer.ts` 的 `ThreeQueueScenarioOptimizer` 一次仅优化 A 或 B 的三个有序队列；另一方及双方每队属性、容量、兵种等级、服务器阶段均沿用当前页面输入。每个状态包含三队各自的盾、矛、射车头英雄与整数基点比例。候选英雄从当前 ServerStage 可用目录选取；比例只在 1% 网格上搜索，每队独立占满自己的 `deploymentCapacity`。界面提供每队英雄与比例锁定。候选生成和应用均复制原队列的独立战报属性与等级，不将它们纳入搜索。

搜索先用最终复验种子测量当前原始方案，再生成当前比例的整数化方案、近邻、英雄替换、均衡及偏重结构和种子驱动的远距离组合。联合 Beam 每次只改变一队，并以**完整三队列**胜率保留状态；随后做局部复筛，最后对 Top K 使用真实 `runThreeQueueBatchSimulation → runThreeQueueScenario → BattleEngine` 重测并重排。它不会枚举 `(英雄 × 5151)^3`，也不使用单撞胜率拼接。候选生成、队列洗牌和模拟试验均使用固定种子；每一阶段所有候选共用相同 trial seed 组。种子组由 root seed 依次派生：候选采样偏移 10,000，粗筛 100,000，逐轮 Beam 200,000 起每轮增加 10,000，复筛 600,000，最终复验 900,000。代码没有 `Math.random()`。

缓存键包含完整输入、所选侧、完整**有序**三队配置、阶段种子与试验次数。同一阶段的重复方案不重测。没有对队列排列做 canonical 去重：当前运行器虽无槽位加成，但固定 trial seed 下的洗牌作用于槽位位置；此外第几队锁定也依赖顺序。改变顺序会改变当前共同种子样本与锁定语义。

当前方案和最终候选使用相同最终 seed 组。`failedTrials` 沿用三队列批量模拟语义，胜率分母为全部请求场次。界面显示当前、推荐、Top K 的整场胜率、胜负/失败/有效场次、三队英雄与比例，并允许应用已验证方案。应用只写回所选侧三队车头与比例，经过 ServerStage 清理、三队列预检、每队兵数分配校验和自动保存。搜索在 Worker 中执行，可取消；取消后不产生可应用的候选。搜索结果与运行缓存不持久化，选项进入自动存档、命名方案和 JSON 导入导出。

## 验证与剩余工作

`src/pvp/tests/scenarioOptimizer.test.ts`、`src/pvp/tests/threeQueueOptimizer.test.ts` 和扩充的 `optimizer.test.ts` 覆盖四场景路由、阶段限制、1% 比例、333 固定比例、三队列确定性、真实运行器和洗牌、三队锁定/容量/等级/单侧应用、失败 Trial、autosave、Rally 固定车身、候选车身写回和目标未达状态。本轮未修改 BattleEngine、DamageEngine、伤害/HP 公式、技能、ServerStage 或 BodySkillConfig 规则。

三队列默认预算为 18 个初始候选、2 次粗筛、宽度 3 的两轮 Beam、30 个复筛候选、每候选 5 次复筛、3 个最终候选各 50 次复验。完整三队列模拟比单撞明显更慢；可在面板调整预算或取消搜索。当前没有浏览器自动化界面测试环境，界面需在浏览器中做最终目视检查。

2026-09-28：类型检查、lint、构建通过；46 个测试文件、630 项测试通过。
