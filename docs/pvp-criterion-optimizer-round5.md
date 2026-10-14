# PVP optimizer 第五轮交付与验收

日期：2026-10-08。适用本轮 07:39 之后确认的搜索维度、空车头、三队列玩法与英雄池 UI 规则。英雄类别与攻防入口沿用第四轮；本文覆盖其“最终战报也能搜索新车头”的旧行为。

## 1. 搜索维度和固定专武

内部输入仍使用 `attributeInputMode: "finalReport" | "prediction"`，审计映射为 `FINAL_REPORT | CONFIG`。

| 场景 | 车头 | 专武来源 | 搜索维度 |
| --- | --- | --- | --- |
| Single + FINAL_REPORT | 当前唯一 FIXED_HEAD / EMPTY_HEAD | 当前实际等级，未设置按正式适配器 Lv0 | `["ratio"]` |
| Rally + FINAL_REPORT | 当前唯一 FIXED_HEAD / EMPTY_HEAD | 当前实际等级 | `["ratio", "body"]` |
| Rally + FINAL_REPORT + 固定车身 | 同上 | 同上 | `["ratio"]` |
| 333 + FINAL_REPORT | 当前唯一车头 | 当前实际等级 | `[]`，复验当前固定配置 |
| CONFIG，允许生成新车头 | 现有英雄范围、类别和近期规则 | OptimizationHeroPool 专武等级 | Single `["head", "ratio"]`；Rally `["head", "ratio", "body"]` |
| CONFIG，当前无英雄 | 一个合法 EMPTY_HEAD | 无专武 | Single `["ratio"]`；Rally `["ratio", "body"]` |
| CONFIG，当前有英雄且英雄池无可用项 | 保留当前 FIXED_HEAD | 当前实际等级 | 继续比例 / 比例×车身搜索 |

用户锁定比例或车身时对应维度退出。CONFIG 锁定完整当前车头同样不要求近三代；近期约束只用于生成新车头。FINAL_REPORT 不读取英雄池来决定车头、专武或合法性，R/SR 和所有权过滤不用于拒绝当前固定车头。

公共入口：`src/pvp/optimizer/searchDimensions.ts`。导出 `resolveSearchDimensions`、`createEmptyHeadCandidate`、`currentHeadHeroIds`、`currentHeadWeaponLevels`。审计包含：

```json
{
  "attributeInputMode": "FINAL_REPORT",
  "headSearchEnabled": false,
  "headFixedReason": "finalReportAttributes",
  "ratioSearchEnabled": true,
  "bodySearchEnabled": false,
  "searchDimensions": ["ratio"],
  "headMode": "EMPTY_HEAD",
  "headTemplateCount": 1
}
```

FINAL_REPORT 的候选应用入口也强制保留当前英雄与实际专武，外来候选无法覆盖。由 CONFIG 保存的保护候选若要求更换车头，在 FINAL_REPORT 中退出搜索并记录 `ignoredProtectedReferencesByFixedHead`；同车头下的比例、车身保护继续保留。

UI 隐藏整个优化英雄池及“固定当前车头”开关；预测模式恢复该开关和英雄池。结果显示本次搜索维度，“当前最佳”明确限定于本次搜索空间，不声称全英雄全局最优。

## 2. 固定车头 Single 和 EMPTY_HEAD

EMPTY_HEAD 是正式合法候选，三个英雄均为空，英雄技能与专武效果为空。候选与结果都具有 `headMode`，不再用空数组触发仅当前比例的 fallback。

`scenarioOptimizer.ts` / `fixedSimpleSearch.ts` 的固定车头路径：

1. 生成完整 5% simplex，共 **231** 比例，包含 **50/10/40（514）**。
2. 全部 **231** 次 MatrixCriterion；全部 **231** 次 DeterministicTheory。固定模式即使旧配置关闭 Criterion，仍执行完整评价。
3. 全比例参加首轮正式样本。默认每项 20 场，共 **4620** 场；用户粗筛设置允许 20～50 场。
4. Top10 加当前 baseline 累计至默认 300 场；3～5 个候选及 baseline 使用相同最终种子到默认 1000 场。
5. 在入围比例附近做 1% 精搜，保留已复验候选，再统一完成最终样本。当前 baseline 保留原输入，包括非整数原始比例。

Final 样本数尊重用户配置；低场次测试不伪装成 1000 场验证。锁定比例或 333 时只评价固定比例。原大型英雄搜索的 M1a/M1b、Criterion 数学、理论 35%/65% 权重没有修改。

### 反例验收的边界

回归从当前 `100/0/0` 出发，确认 231 比例实际执行、514 进入首轮，并使用受控胜负评价证明更强的替代比例能进入最终推荐。该受控评价不是用户真实 `0% vs 0.2%` 对局的胜率复现；用户完整双方参数未包含在本轮输入中，未声称实测推荐必须是 514。

可复现审计：[固定车头搜索 audit](../examples/criterion-round5-fixed-head-audit.json)。它使用真实 Criterion / Theory / 搜索流程和受控正式阶段结果，明确标记了这个边界。

## 3. 固定车头 Rally 和 EMPTY_BODY

Rally 的公共车头生成与 Single 复用 EMPTY_HEAD 语义，A / B 均支持。最终战报、显式固定车头和空车头统一走完整联合路径，旧配置关闭 Criterion 不能绕回英雄搜索。

- 固定车头强制 5% 粗网格，旧保存的 1% / 10% 配置不会改变 231 个粗比例；1% 精搜仍保留。
- 车身复用现有同 effectFamily 最多 2 次、严格支配、概率/常驻、Pareto、边际收益和当前集结角色过滤。
- 固定模式 C0 不剪掉比例，完整粗扫 **231 × LegalBodyPool**，然后执行 MatrixCriterion、DeterministicTheory、正式 Racing 和 Final。
- 四槽全空的 EMPTY_BODY 在现有 `memberSkillIds: []` 表示中对应四个未选槽，是 **1 个候选**，不是 0 个。
- `headTemplateCount`、`ratioCount`、`bodyCandidateCount`、`roughJointCount` 独立审计。

复现实测审计：空头 + 固定空车身为 `1 × 231 × 1 = 231` 个 rough joint；三来源车身池经过现有预处理剩 6 个模板时为 `231 × 6 = 1386`。这是合成配置的覆盖检查，不代表所有玩家车身池的规模。

## 4. 三队列玩法和 Scheduler

共同规则继续由同一个 ThreeQueue runner 执行：三队、跨队英雄不重复、败者淘汰、胜者继承真实盾/矛/射剩余兵、小场技能刷新、最多五场。正式 PVP BattleEngine 没有复制或改造。

| `threeQueueMode` | Scheduler | 调度 | 优化目标 |
| --- | --- | --- | --- |
| `ICE_FIRE_LEAGUE` | `IceFireLeagueScheduler` | 双方独立循环指针；从本场原位置的下一位寻找存活队伍 | 固定位置整场胜率；允许位置排列候选 |
| `EARTH_HEART_BRAVE_LAND` | `RandomAliveQueueScheduler` | 统一 seeded RNG，每轮从双方存活队伍均匀随机选择 | 调度与技能随机性的 Monte Carlo 整场胜率 |

未指定玩法的旧配置默认随机活动，并保留原随机取样顺序。选择器、保存恢复、Criterion、Fast runner、正式 runner、批量模拟及优化器都使用同一个 mode。

IceFire 双方指针无论上一场胜负如何均推进，死亡队伍跳过，到 3 后回 1。它不是胜者留场。位置排列搜索遵守英雄和比例锁定，**不挪动队伍固定属性、外部增益或兵种等级**。

审计包含 `threeQueueMode`、`schedulerType`、`queueCursorA/B`、`matchSequence`。指针内部从 0 开始；随机模式无指针，为 null。完整场景与批量结果分别显示实际序列和首个完成样本序列。

### 正式 BattleEngine 五场回归

```text
R1 A1-B1 → A胜
R2 A2-B2 → B胜
R3 A3-B3 → B胜
R4 A1-B2 → A胜
R5 A1-B3 → A胜
```

A1 纯盾合成测试中的实际兵数：`90 → 87 → 67 → 43`；R4 / R5 继续使用上场真实剩余兵。证据：[IceFire 正式引擎 audit](../examples/criterion-round5-icefire-audit.json)。该配置用于调度回归，明确不是用户实际战报参数或战报数值拟合。

## 5. 我的英雄和本次优化英雄池

- “我的英雄”独立折叠区域维护长期 `ownedHeroIds`，包含当前阶段 R / SR / S 英雄。
- 预测模式的“本次优化英雄池”只显示已拥有且合法的车头候选。每张卡仅 **1 个 checkbox：参与优化**。
- 顶部统计：`参与优化：X / 可用 Y（已拥有且当前合法）`。专武选择独立保留。
- 全选只启用已拥有、合法的候选；全不选关闭参与。两者不修改 ownership，不重置任何专武等级。
- 取消拥有时关闭双方该英雄的优化参与，保留专武等级；重新拥有不自动重新启用。
- 保存的 `enabled=true, owned=false` 会归一为 false，直接事件也无法启用未拥有英雄。
- FINAL_REPORT 隐藏整个本次优化英雄池，“我的英雄”长期资料继续独立维护。

## 6. 测试、复现和核心边界

最终门禁：typecheck / lint / build 全部 exitCode=0；**99 文件、1073 项测试全部通过**。

新增回归：Single 固定/空车头 9 项、Rally 固定/空车头 11 项、三队列活动 12 项、ownership 4 项、main UI 集成新增 5 项。旧英雄搜索用例明确迁移到预测输入，过滤和全覆盖断言仍保留。

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd test -- --maxWorkers=2
node scripts/run-tsx.mjs scripts/audit-fixed-head-search-round5.ts
node scripts/run-tsx.mjs scripts/run-three-queue-icefire-audit-round5.ts
```

- [最终验证摘要](../examples/criterion-round5-validation-summary.json)
- [完整测试日志](../examples/criterion-round5-test-results.log)
- [正式核心哈希审计](../examples/criterion-round5-core-boundary-audit.json)：**72 个正式核心文件，0 个变更**。

本轮改动在 optimizer、ThreeQueue 场景调度与适配、UI、存储和文档层。普通 PVP 行动/索敌、N0、伤害/HP、rounding、overflow、技能正式时序及 Body effectFamily 规则未变。构建保留现有大于 500 kB 的分块提示；没有新增开发服务器。UI 委托事件、保存应用通过自动回归，未重新进行 Edge 现场视觉验收。
