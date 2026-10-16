# 地心 / 冰火战歌：属性输入、方案保存、OCR 与优化搜索

日期：2026-10-08。以下是本轮生效口径；旧文档中兵种 OCR 与坐标下降搜索属于历史实现。

## 1. 方案保存

- 保存、同名覆盖、重命名、删除、载入方案、导入 JSON 使用应用内受控 Dialog。
- 应用源码没有 `window.prompt()` / `window.confirm()` / `window.alert()` 调用。
- 名称默认按玩法和日期填入，允许 1–80 字符；错误留在弹窗内部，取消不产生错误 banner。
- Esc 取消、输入框 Enter 提交，Tab 留在弹窗内，背景表单处于 inert 状态。
- 方案库、配置结构、自动保存、导入导出沿用原存储接口。
- 回归用缺少全部原生弹窗 API 的 window stub 验证保存、覆盖、取消、删除和载入。没有进行 Edge / VSCode 内嵌浏览器的现场视觉验收。

## 2. 属性字段验收

| 玩法 | 我方输入 | 敌方输入 | Schema |
| --- | --- | --- | --- |
| 地下研究所 | 12 项 | **1 项**全属性 | FULL_12 / ALL_SHARED_1 |
| 装备锻炉 | **9项，逐兵种攻击、防御、穿血** | **2项，全军攻防/穿血** | PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9 / ALL_TROOPS_PAIRED_2 |
| 宝石矿洞 | **6项，逐兵种攻防/穿血** | **2项，全军攻防/穿血** | PER_TROOP_PAIRED_6 / ALL_TROOPS_PAIRED_2 |
| 群兽洞窟 | 12项 | **4项** | FULL_12 / SHARED_BY_STAT_4 |
| 大地之心 | **每队4项**，A1/A2/A3独立 | **一套4项**，B1/B2/B3共享 | SHARED_BY_STAT_4 |
| 英雄之地 | **每队4项**，A1/A2/A3独立 | **一套4项**，B1/B2/B3共享 | SHARED_BY_STAT_4 |

公共 `expandAttributeInput(schema, input)` 将输入展开成标准盾/矛/射 × 攻/防/穿/血 12 项。模式适配器和配置恢复统一展开，正式引擎数据结构保持原样。大地之心与英雄之地保留独立队伍基础值；宠物仅进入评价上下文，容量宠物不参与。

2026-10-09 锻炉我方修正：每兵种保留独立攻击和防御，只配对穿透/生命，三兵种穿血互不共享。存储仍是完整12项；配置恢复、模式切换、正式适配都保留各兵种防御，不再用攻击覆盖。矿洞仍按各兵种攻击/穿透代表值展开攻防/穿血。旧2项共享或旧6项锻炉配对配置已经丢失的差异无法恢复，请按战报重填。其他共享输入采用盾兵代表值：1项取盾攻击，2项取盾攻击/盾穿透，4项取盾四属性。界面明确提示核对；不会平均不一致的 OCR 数值。

锻炉 A 方 OCR 预期9项：盾攻击、盾防御、盾穿血；矛攻击、矛防御、矛穿血；射攻击、射防御、射穿血。仅同兵种穿透/生命做一致性检查，不检查攻击≈防御。真实案例与验证见 [装备锻炉9项修正](pvp-equipment-forge-schema.md)。

## 3. 地下研究所兵级

```text
myTierOptions = [T10, LAB_T11, LAB_T12]
UI = [T10, T11无火晶（研究所）, T12无火晶（研究所）]
enemyTier = T10（盾/矛/射固定，无选择器）
enemyAttributeInputCount = 1
constants = [7.4947, 8.8437, 10.4356]
```

三个我方兵种独立选择。仅选中 LAB_T12 的兵种显示 0/1/2/3 级技能；改为 T10/LAB_T11 时归零并隐藏。敌方固定 T10；研究所不附加火晶技能，也没有将专用等级录入正式游戏兵级枚举。

## 4. OCR

```text
troopRecognitionRemoved = true
attributeRecognitionRemaining = true
```

- 本地 RapidOCR、整图原图/增强双通道、置信度和原图 bounding box 保留。无云端 API。
- 浏览器只发送 `mode: attributes` 一次；Python 不再接收 troopCards 模式，不裁兵种卡片。
- 应用解析入口只读属性。等级、火晶、图标、兵量和特殊加成不再进入新 OCR 结果；旧历史配置和手动特殊加成的解析/结算兼容保留。
- 属性按当前 Schema 归并；`468.O%` 数字容错还原为 `468.0%`。不同数值不自动取平均；缺失、低置信度、双通道异议及共享值冲突要求逐项人工校对。
- 允许手动补齐未识别项，百分数最多两位小数。应用前只修改识图预览；点击应用后一次更新对应侧/队列的属性，保留兵量、兵级、英雄、宠物和其他队伍。
- 导入数值按当前属性输入模式使用。带外部加成的历史最终战报须在原有历史属性入口手动提供加成并反推；新 OCR 不沿用旧历史 specialBonus 来源，也不声称已自动反推。

## 5. 三队搜索结构

```text
每位置 Head × 5% Ratio（FixedHead/空车头仅 Ratio）
 → 每队候选池（默认150，可配置1–300）
 → hero-disjoint + 配对覆盖评分，Pair上限2000
 → 两队低成本 Criterion 估计与 Q3 有界 frontier
 → Triple总预算1000（包含受预算约束的1%局部比例微调）
 → 整场 Criterion + per-troop 剩兵传递
 → DeterministicTheory 前200
 → 正式整场 20 → 50 → 100 → 300 → 1000
```

**冰火战歌**使用 `IceFireLeagueScheduler` / `ICE_FIRE_CURSOR`，有序 Q1/Q2/Q3 候选身份，调度无随机选队。**大地之心/英雄之地**使用 `RandomAliveQueueScheduler` / `RANDOM_ALIVE_QUEUE`，默认100个廉价调度种子；输出估计整场胜率、平均剩兵、至少两队生还率和不确定性。

两种调度共享组合与评价框架；单队平均分仅建立候选池，正式排名使用整场胜率。生成的新英雄互不重复，比例允许重复；固定头和空头保持原身份，不补默认 S11。各位置的属性、兵级、外部配置不参加搜索。

每个小战斗继承实际盾/矛/射剩兵；技能状态、回合数、盾和临时效果由既有场景运行器在新小战斗重建。Criterion 缓存键包含双方完整剩兵向量，不能把不同残兵状态当成同一次对战。

默认累计正式整场序列20/50/100/300/1000，保留上限80/25/10/5。每个候选和baseline有统一TrajectorySampleAccumulator，共享trajectory seed prefix；阶段只补缺失样本，baseline最终总计1000场。首轮综合Criterion、Theory、配对胜负差、不确定性、特殊机制和理论/正式异议保留候选。当前原始配置每一级参与比较，最终与推荐候选采用同一批种子和1000场累计结果；输出最大正式胜率，平局优先当前方案。API 允许显式配置更小预算用于测试；生产默认 Final=1000，地心入口至少1000。

可配置字段：`criterionCandidatesPerQueue`、`criterionPairLimit`、`criterionTripleLimit`、`criterionTheoryLimit`、`criterionSchedulerTrials`、`formalStageTrials`、`formalStageKeeps`，及原有模拟次数。新字段保存/恢复，界面提供候选预算输入；高级审计显示各级实际数量与调度样例。

这是有界近似搜索，配对覆盖评分和候选保留不是全局最优证明。进入正式引擎前的筛选不会运行正式随机战斗。

## 6. 上一轮真实引擎运行记录（从零重跑，已被累计补样本替代）

| 模式 | 单队池 | Pair | Triple（含微调） | Theory | 进入正式的独立方案 | Criterion调度样本 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ICE_FIRE_LEAGUE | 150 / 150 / 150 | 2000 | 964 | 200 | 201 | 1 | 166.04s |
| HEART_OF_EARTH | 150 / 150 / 150 | 2000 | 950 | 200 | 201 | 100 | 78.52s |
| HERO_LAND | 150 / 150 / 150 | 2000 | 950 | 200 | 201 | 100 | 45.77s |

三个样例均完整经过20/50/100/300/1000场阶段，最终每项1000场，失败场数0。样例基线与最终胜率均100%，所以它们只验证流程，不能证明提升。样例设置详见脚本：T10、普通容量300，英雄之地我方仍固定190410，可用英雄池限定S9–S11的9位SSR；耗时来自本机且部分与测试并行，没有旧算法同条件性能对照。

记录：[JSON](../examples/inner-earth-search-benchmark.json)、[运行日志](../examples/inner-earth-search-benchmark.txt)。首次脚本在三个模拟完成后读取旧 UTF8 BOM 审计文件失败，已兼容 BOM 并通过 `--audit-only` 补跑核心核对；[补跑日志](../examples/inner-earth-ui-core-audit-log.txt)。

## 7. 门禁与边界

- 全量：**107 文件 / 1191 项测试通过，0失败**。
- 最终针对性复验：4文件 / 65项通过；本地OCR Python语法检查通过。
- typecheck、lint、build通过。构建有既有大分块提示，不影响成功状态。
- 对上一轮基线比较：**72 个核心文件全部哈希未变**。BattleEngine、Damage/HP公式、N0、行动/索敌、rounding、overflow、已确认英雄和兵种技能以及正式三队调度文件均未修改。
- 本轮没有启动额外 Vite 实例，没有改服务器端口。
- 结果：[验收汇总](../examples/inner-earth-ui-search-validation-summary.json)、[核心核对](../examples/inner-earth-ui-core-boundary-audit.json)。完整测试原始JSON含本机路径，已归档至被Git忽略的 `artifacts/release-0.3.0-beta/archived-test-reports/`。

复现：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npx.cmd vitest run --maxWorkers=2
node scripts/run-tsx.mjs scripts/audit-inner-earth-ui-search.ts
# 已有模拟记录后，仅核对核心文件
node scripts/run-tsx.mjs scripts/audit-inner-earth-ui-search.ts --audit-only
```
