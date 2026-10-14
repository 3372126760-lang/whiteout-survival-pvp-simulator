# PVP optimizer 第四轮修正与验收

历史版本记录：第五轮已强制固定最终战报的车头与实际专武，并新增 EMPTY_HEAD、分活动三队列调度及独立 ownership UI；最新搜索维度见 [第五轮报告](pvp-criterion-optimizer-round5.md)。本报告的类别规则和攻防入口继续适用，旧搜索描述不能用于最终战报模式。

完成日期：2026-10-08。范围为英雄类别、优化对象身份、集结防守完整入口、技能场景适用性和车身独立卡片。Criterion 数学与现有搜索漏斗继续复用。

## 1. 英雄类别与当前目录计数

`HeroCategory = R | SR | S`。只有 S 类具备 `sGeneration`；UI/优化目录中的 R/SR `generation=null`，没有 `sGeneration`。正式英雄定义中的兼容字段没有改动，消费代码用类别辅助函数隔离旧字段，不把 R/SR 当成 S 代英雄。

服务器 S3 及以后，车头优化域统一排除全部 R/SR。注册表、普通手动阵容、历史战报和独立车身池继续保留这些英雄。S2 的早期规则保留。

当前无额外拥有/启用/固定约束的目录审计如下。数值由实际目录计算，算法没有写死 876 或 1812。

| 字段 | 数值 |
| --- | ---: |
| 全 Hero Registry：R / SR / S | 4 / 9 / 49 |
| 服务器 S11 可用：R / SR / S | 4 / 9 / 34 |
| S11 排除 R / SR | 4 / 9 |
| optimizerHeadHeroCount | 34 |
| 盾 / 矛 / 射车头数 | 12 / 11 / 11 |
| maxEnabledSGeneration | 11 |
| recentSGenerationWindow | S9～S11 |
| allLegalHeadCountBeforeRecentRule | 1452 |
| recentEligibleHeadCount | 876 |
| 5% ratioCount | 231 |
| rawHeadRatioCount | 202356 |

公式为 `12×11×11 − 9×8×8 = 876`，`876×231 = 202356`。窗口由正在优化一侧的已启用、拥有且服务器合法的 S 英雄最大代数决定；最高仅启用 S8 时窗口为 S6～S8。固定头/候选域约束会进一步改变实际数量，精确 baseline 单独保留。

旧的 15/16/16 全 SSR 合成 fixture 仍可得到 1812：它与当前 S11 默认目录是不同输入，不能把这个历史计数直接解释为非法 R/SR。详见 [目录审计 JSON](../examples/criterion-round4-head-pool-audit.json) 和 [类别说明](criterion-head-pool-and-category-round4.md)。

## 2. 单撞 A/B 与集结角色

| 场景 / 对象 | candidateSide | rallyRole / candidateRole | fixedOpponentSide | 显示胜率 |
| --- | --- | --- | --- | --- |
| 单撞 A方 | A | null | B | A 获胜次数 / 全部样本 |
| 单撞 B方 | B | null | A | B 获胜次数 / 全部样本 |
| 集结进攻方 | A | attacker | B | 进攻方获胜次数 / 全部样本 |
| 集结防守方 | B | defender | A | 防守方获胜次数 / 全部样本 |

统一 `optimizationObjective=candidateSideWinRate`。333 同样只有 A/B 身份。单撞优化对象选择器显示 A方/B方；集结显示集结进攻方/集结防守方。

正式集结适配器已有 A 为进攻、B 为防守的规则。本轮没有交换正式 Rally 输入。`candidateToInput(input,candidate,side)` 只更新所选侧的车头、专武配置、四槽车身、比例和对应兵数，另一侧保持原值。搜索数值模板可转为候选/对手视角，B 候选标注 `criterionPerspectiveSide=B`；正式 BattleEngine 始终接收原来的 A/B 与场景。

单撞镜像回归交换 A/B 配置和英雄池后，验证候选身份、比例、Theory 分数、方向化 Criterion 分数及正式胜率一致。该正式镜像 fixture 关闭概率技能，以检验方向对称性；没有声称任意随机调用顺序都逐种子完全镜像。

## 3. 集结防守完整搜索

攻防共用 `createJointSingleWaveSearchWorkflow`：

```text
H0 合法车头
 → B0 车身预处理
 → C0 全车头×比例潜力
 → C1 车身边际粗筛
 → C2 MatrixCriterion
 → C3 DeterministicTheory
 → M1a 5场 → M1b 20场 → M2 50场 → M3 100场 → M4 300场
 → 1%联合微调与正式复筛
 → Final 1000场
```

没有新增防守简化算法，也没有改变这些阶段的数学、配额或 racing 统计门槛。H0～Final 的阶段覆盖审计保留。B0 的执行位置沿用当前架构。

防守入口固定进攻配置，完整搜索防守车头、比例和车身。防守模式目标为最高自身单波胜率；旧进攻入口的 `auto/minRallies` 连续进攻功能保留。切换到防守时 UI 使用 `singleWin`，API 同样按防守胜率处理，避免将“最少进攻击破波数”套用于防守。

每阶段与 Final 都以所选侧统计 wins/losses/selfRemaining/enemyRemaining；平局和超时仍计入分母。因此防守胜率不是 `1−进攻胜率`。baseline 与所有 Final 入围者使用同一高样本种子范围，推荐不会低于本轮 baseline 的已测胜率。

## 4. 场景限定技能与身份审计

- 优化器技能签名复用正式 `isBattleContextAllowedForSide`，Head、专武、Body 均按正式场景判断：Rally A 为 `rallyAttack`，B 为 `rallyDefense/garrisonDefense`。
- Theory 保留原有正式场景判断；Criterion 补齐相同过滤。没有修改技能定义、数值或实际触发时序。
- 完全不适用于当前角色的车身，在枚举/支配检测前标记 `inactiveInCurrentRallyRole` 并从该方向候选域移除；手动车身配置仍保留原始身份与保存方式。
- 边际计算保留真实模板的伤害/HP/额外输出权重，B 侧缓存与 A 侧分离。
- 历史已知进攻结构不会自动作为防守方向参考；防守可另提供明确的 `protectedCandidates`。

每次结果有 `OptimizationContext`；审计增加 `battleScenario/candidateSide/candidateRole/fixedOpponentSide/optimizationObjective`，以及 Head、专武、Body 按角色生效/不生效的效果 ID、车身角色排除数量。这些是适用性说明，不代表概率或周期效果已在每一场触发。

固定当前车头/车身读取所选侧。切换侧会重新绑定已固定槽位并清除旧侧参考候选；保存新增 `candidateSide`，旧配置默认 A。应用结果及 10000 场追加复验从结果身份读取侧别，防止把防守推荐应用到进攻侧。

## 5. 车身 UI：每槽位一张卡片

每侧四个 `BodySlotCard`，每张包括明确侧别及槽位标题、筛选条件、当前选择、当前选中摘要、技能说明。描述完全包在同一卡片内，具有独立边框、内边距、间距和编号。

下拉文案统一为 `英雄（类别/S代）｜当前等级核心效果｜触发`。详情保留英雄、真实稀有度/S代、技能名、等级、当前效果、触发和完整说明。书允显示 SR，不显示伪 S 代数。

原 `data-side/data-index/data-scope`、slot runtime ID、选择/保存事件、手动重复英雄、技能数值与同效果最多两次的优化器规则继续复用。搜索仍在槽内更新下拉选项，不因输入关键词改写配置。旧“筛选车身技能3 / 车身技能3”的松散重复标题已移除。

## 6. 回归与验证边界

新增/更新覆盖：

- S2/S3/S11 的类别过滤，S-only 近三代，R/SR 注册表/手动/车身保留。
- 单撞 A/B 镜像、B 胜率方向和无 RallyRole；333 无攻防身份。
- 真实正式角色判定及技能签名的 attack-only / defense-only / garrison 适用性。
- 防守完整 H0～Final、1% 微调、Final 1000 场；所有搜索 job 保持固定 A，更新 B。
- 四张卡片的槽位独立、A/B 隔离、四种英雄、重复英雄、真实类别。
- 防守方案应用、保存/还原、追加正式复验及 UI 固定配置绑定。

最终全量命令 `npm.cmd test -- --maxWorkers=2`：**95 个文件、1032 项测试全部通过**，用时 99.92 秒，见 [测试日志](../examples/criterion-round4-test-results.log)。[typecheck](../examples/criterion-round4-typecheck.log)、[lint](../examples/criterion-round4-lint.log)、[build](../examples/criterion-round4-build.log) 均 exitCode=0；build 保留主 bundle 大于 500 kB 的提示。汇总见 [验收 JSON](../examples/criterion-round4-validation-summary.json)。

完整防守流程 fixture 使用可控 outcomes 验证方向、样本与缓存统计，并单独运行正式 BattleEngine 检查装配和复验；它不等同于新真实游戏战报验证，也不提供同用户输入的性能 benchmark。

[72 个正式核心文件哈希审计](../examples/criterion-round4-core-boundary-audit.json) 为 `fileCount=72, changedFiles=[]`。伤害/HP、N0、行动/索敌、回合末、取整、溢出、技能分类/时序、护盾、ThreeQueue 剩兵传递和正式 Body runtime 隔离均保持原样。

浏览器现场视觉验证未完成：现有 Edge 扩展 inventory 返回 JSON 解析错误，连接页面返回 `nodeRepl.fetch request failed`。已确认开发服务仅监听 `127.0.0.1:5173`，没有额外启动 dev server。组件与 main UI 行为由回归覆盖；现场可在 Edge 刷新该地址，切换单撞/集结检查对象文案，再展开双方车身确认四张卡片。
