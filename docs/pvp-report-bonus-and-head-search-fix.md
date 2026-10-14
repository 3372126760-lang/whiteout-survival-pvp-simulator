> 后续修复已覆盖本文的旧加算兼容路径及预算内车头搜索，见 [三项修复报告](pvp-expected-head-ocr-fix.md)。2026-10-06 的专武乘区口径又覆盖了本文的场景专武固定百分点规则，当前以 [专武外部 Buff 乘区修复](pvp-weapon-external-buff-fix.md) 为准。本文保留历史问题追溯。

历史记录说明（2026-10-06）：当时集结最终战报模式的候选比例没有写入实际兵数，相关合成搜索数值不作为当前比例搜索验收。已在优化器配置转换层修复，并重新对照；以 [最新理论优化器报告](pvp-theory-optimizer.md) 为准。


# 历史加成上下文与集结车头搜索修复（2026-10-05）

## 1. 原因与范围

本轮只调整配置、属性转换、预测展示和集结候选搜索。没有调整 BattleEngine、DamageEngine、HP 公式、技能数值/概率/时序、三队列匹配与调度。OCR 文本、卡片 ROI、名称匹配与人工确认规则保持上一轮实现。

### 历史 Buff / Debuff 的旧来源

旧数据链为：手动录入或 OCR 历史战报 → `mapping.mapReportSide` 反推原始百分比 → 将历史特殊加成保存为 `side.importedReportModifiers`（三队列为对应 queue 的同名字段）→ `validationUi/adapter.toScenarioSide` 将同一字段交给场景 → 再次用于生成预期属性。

此外，旧预期表的 `ownBuffRate` 通过 `(1 + effectiveValue) × enemyDebuffFactor − (1 + inputReportBonus + lineupCorrection)` 反算差额。它是百分比点差额，不能代表实际 Buff 倍率；原始值 140%、Buff 20%、无减益时，结果 188%，旧表会显示差额 **48%**。现在分别展示原始值、当前官职、当前 Buff/ Debuff、阵容修正和场景专武。

旧外部来源明细另读取本方 `externalBuffs` 的城镇/宠物，以及对方 `externalBuffs` 的城镇/宠物/专家减益，再把剩余差额归给专武。这也可能错误归因历史加成。新高级调试列出 source/target 值、字段路径及当前外部配置的具体来源 ID；专武场景效果单独显示。

用户提到的 `+48/+30/+45.7/-20/-30/-6.5/-5` **没有对应的截图或导出配置可供读取**，因此不能逐项断言其具体来源。上面的 48% 是可复现旧展示错误的数学示例，并非对用户截图的归因。导出当前配置后，可结合高级调试逐字段追踪。

## 2. 两个 bonus context

双方及每个队伍支持以下独立字段，三个数值都以百分比点保存（20 代表 20%，不代表 factor 20）：

```typescript
sourceReportBonuses[troop][stat] = { additive, buff, debuff };
targetBattleBonuses[troop][stat] = { additive, buff, debuff };
reportAttributeBasis = "raw" | "historicalReport";
targetBonusMode = "none" | "reuseSource" | "custom";
sourceReportAttributes[troop][stat]; // OCR 原始历史最终百分比，供追溯
```

`troop` 为 shield/lancer/marksman；`stat` 为 attack/defense/penetration/life。`additive` 仅表示官职百分比点；英雄/专武/阵容差量仍是独立 `lineupCorrection`。

| 模式 | 当前加成 | 是否读取历史 context |
| --- | --- | --- |
| 不沿用（默认） | A/B/D 全为 0 | 仅用于反推与追溯 |
| 沿用原战报 | 深复制当前 source context | 用户明确选择后才用于新战斗 |
| 自定义 | 当前 target 字段，加上当前明确配置的外部环境 | 不读取 source 作为目标 |

公式保持完整精度：

```text
raw = (100 + history) × (1 + D_history) / (1 + B_history) − 100 − A_history
expected = (100 + raw + formationDelta + A_target)
           × (1 + B_target) / (1 + D_target) − 100
```

B/D 在运算时由百分比点除以 100。场景专武仍按已有固定加算技能规则结算，另列 `weaponScenarioContribution`，不将它或英雄主动技能塞入 target Buff。

手动历史报告选择“属性输入含义 → 手动输入历史最终战报”，再填写历史特殊加成；在场景转换边界反推，不改写保存的历史值。OCR 确认应用时沿用已完成的反推流程，保存 raw + source 原始值/context，并标记 `reportAttributeBasis="raw"`，防止重复反推。两种路径得到同样的 raw、target 和战斗属性。

旧 `importedReportModifiers` 只作为历史字段兼容读取，不再自动传给战斗。场景层的当前字段已改名为 `targetBattleBonuses`。已有明确配置、无历史 context 的旧原始面板外部增益迁移为当前自定义乘区；UI 标为自定义兼容配置，选择“不沿用”可清零。历史 context 一旦存在，默认目标一律为零，旧外部环境也不会跨到对方新战斗。

高级调试分别提供 `sourceReportAdditive/Buff/Debuff`、`targetAdditive/Buff/Debuff`、`bonusSources` 和场景专武贡献；显示模型单位为 decimal rate，乘 100 后是百分比点。

## 3. 为什么原来不换车头

`main.renderOptimizer()` 在最终战报模式首次渲染时，无条件设置 `constraints.fixedLeaders=currentHead`，并把单撞 `fixedHeroes` 置为 true；切换输入模式还会再次触发。自动保存会留下这个锁定。已删除这些渲染副作用，默认约束无固定车头。

旧候选生成仅覆盖排名前四的单英雄替换，车身随后消耗预算，联合车头替换更少；固定车身还会提前返回。比例网格可消耗全部粗筛预算，导致生成过的车头根本没有被评估。

修复后：

- 用户池与优化范围取交集，按阶段/代数/位置/必选/禁用过滤**定义 ID**，不按车身运行实例 ID 过滤车头。
- 包含当前头、合法的对手车头参照、各兵种完整池的轮转替换、联合替换与预算内 Cartesian 组合；为车身留出预算。固定车身仍允许头组合搜索。
- 粗筛英雄采用当前比例，随后围绕获胜候选继续搜索头与比例；每次构造保留候选自身三名车头。不会覆盖回 currentHead。
- 旧预算若恰好只够比例网格，均匀抽取粗筛比例、为车头预留槽位；不增加预算，也不静默取消头搜索。
- 合法对手车头参照会保留到最终同种子复验，减少粗筛随机噪声造成的丢失。最终胜率优先排序，当前配置仍参与最终排名。
- 仅修改 A 允许优化的字段，B 始终固定。各英雄专武等级沿用其用户配置。

高级调试和开始搜索的控制台输出含 fixedHead、searchDimensions、各兵种可用头列表与数量、head/body/ratio/totalCandidateCount、预算内粗筛数量、evaluatedHeadLineups、bestHeadLineup、optimizationTargetSide/candidateChangedSide。`headCandidateCount` 是合法头选择的 Cartesian 空间；`totalCandidateCount` 是头 × 已生成车身 × 完整比例网格的上界，**不声称全部已模拟**。实际访问以 evaluatedHeadLineups、coarseCandidateCount、evaluatedCandidates 为准。

配置 schema 升为 v3。v2 无法区别自动锁定与用户勾选的锁定，迁移时清除旧车头锁，并提示需要固定时重新勾选；v3 会正常保存明确选择的锁定。手动车身重复、最多两个不同车身的搜索规则未改。

## 4. 实际引擎回归

[输入场景](../src/pvp/tests/fixtures/rallyHeadSearch.ts)是相同面板、相同兵数/等级的**合成回归**，不是用户 19.9%/27.1% 的保存配置。

| 检查 | 1000 场结果 |
| --- | --- |
| 原 A 车头 X vs B 车头 Y | 3.5% |
| 手动 A 换 Y vs Y | 51.3% |
| 自动搜索推荐 | 72.0% |
| fixedHead | false |
| 盾/矛/射候选 | 2 / 2 / 2 |
| headCandidateCount | 8 |
| 已评估头组合 | 8（包含 Y） |
| 最佳车头 | 娜塔莉亚 / 劳埃德 / 鲁弗斯 |
| 优化与改动侧 | A / A |

结果保存于 [rally-head-search-regression.json](../examples/rally-head-search-regression.json)。复现命令：

```powershell
node scripts/run-tsx.mjs scripts/verify-rally-head-search.ts 1000
```

正式测试还包含真实快速战斗 X/Y 回归、低粗筛预算时仍评估 Y、固定头仅搜索车身/比例、池交集、专武配置、旧锁迁移、UI 打开/重开不会锁头、手动/OCR 同语义、source/target 分离、按队隔离、来源显示及存储往返。

本轮未收到用户实际配置，不能报告用户当前保存状态的真实英雄池数量或断言同一截图配置能达到特定胜率。新高级调试会输出该配置实际运行的值。

## 5. 最终检查

- typecheck、lint、build：全部通过。
- 全量测试：**67 个测试文件、792 个测试全部通过**（上轮 776 项，本轮新增 16 项）。
- 真实快速战斗回归与页面启动/勾选/重开回归均通过。
- 构建仍有主包超过 500 kB 的提示；不是本轮逻辑检查失败。
- 未启动新的开发服务器。当前历史截图/用户保存配置未完成逐项实测归因。
