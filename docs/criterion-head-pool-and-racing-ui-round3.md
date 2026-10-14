# 第三轮：车头英雄池、Racing 参数与持久化边界

> 历史版本：本文记录 Round 3 当时的要求与测量。Round 4 已将英雄类别规则改为「服务器 S3+ 的车头优化域排除所有 R/SR」，R/SR 没有 S 代数。本文旧排除规则、默认池计数与“不实施 876”描述不代表当前行为。当前动态计数见 [Round 4 类别与车头审计](criterion-head-pool-and-category-round4.md)，当前整体实现见 [Round 4 总报告](pvp-criterion-optimizer-round4.md)。

本文件记录目录核对和 UI / 配置链路；性能、剪枝量与最终胜率以本轮实际 benchmark / 总审计为准。

## 1. 车头稀有度规则的准确含义

硬规则仅用于优化车头：

```ts
hero.generation >= 4 && (hero.rarity === "R" || hero.rarity === "SR")
```

满足条件的英雄不出现在“玩家英雄池 / 优化英雄范围”，也不进入 `optimizationHeroIds`。此规则不删除英雄注册表、不修改手动战斗、不限制集结车身池。

`serverHeroIds` / `ownedHeroIds` 保留原语义；`visibleOptimizationHeroIds` / `ownedOptimizationHeroIds` 提供优化 UI 的过滤视图。两方优化启用标记与优化专武等级仍独立于当前阵容。

### 当前目录的实际数据

脚本：`scripts/audit-optimizer-head-pool.ts`；输出：`examples/criterion-head-pool-round3-audit.json`。

当前目录中，所有已标注 S1–S16 的赛季英雄均为 SSR；13 位基础 R/SR 的 `generation` 为 `null`。没有已经录入的 `generation >= 4` R/SR。审计将未标代英雄放入计数桶 `0`，这不是虚构游戏中的 S0。

因此，对当前默认 S11 全启用目录执行上述字面规则：

| 项目 | 动态目录计算值 |
| --- | ---: |
| 优化英雄数 | 47 |
| 被排除的 S4+ R | 0 |
| 被排除的 S4+ SR | 0 |
| 盾 / 矛 / 射英雄数 | 15 / 16 / 16 |
| recent window | 9–11 |
| 近三代规则前所有车头 | 15 × 16 × 16 = 3840 |
| 全部旧代车头 | 12 × 13 × 13 = 2028 |
| 近三代合法车头 | 3840 − 2028 = 1812 |
| HeadRatio 数 | 1812 × 231 = 418572 |

这里的 1812 来自目录、拥有/启用、阶段和位置计算，代码没有写死 1812 或 876。与用户所给 C0 数量一致不意味着已取得用户本次完整配置；属性、对手、车身池、等级和种子仍需原始配置确认。

若额外把所有基础 R/SR 也删除，S11 目录会变成 12 / 11 / 11，近三代车头为 `12×11×11 − 9×8×8 = 876`。这是“只允许 SSR”的另一项规则，与保留 S1–S3 R/SR 的本轮要求不同，未实施。不能因为想得到 876 就删除基础英雄或给其虚构 S4 代数。

回归以局部的未来 S11 R/SR 元数据夹具证明过滤生效，同时证明注册表和手动配置仍可识别相同英雄 ID。夹具恢复后不改变正式目录。

## 2. 实际运行、UI 与保存共用同一个 Racing 解析器

`src/pvp/optimizer/criterion/racingSchedule.ts` 提供 `resolveJointRacingSchedule`：

1. 显式 `monteCarloStages` 优先。
2. 对没有显式 `criterion.screeningTrials` 的旧 API 配置，继续尊重其自定义 `stages`。
3. 其余配置使用 Criterion 的 `screeningTrials` / `screeningKeep`。

新默认：

| 阶段 | 每候选累计场次 | 全局晋级预算 |
| --- | ---: | ---: |
| M1a | 5 | 300 |
| M1b | 20 | 80 |
| M2 | 50 | 25 |
| M3 | 100 | 10 |
| M4 | 300 | 5 |
| Final | 1000 | 默认 Top 5，明确记录基线 / 指定参考例外 |

UI 直接显示解析器返回的实际场次和保留数；C0 显示“全局保留 HeadRatio”，默认 2000。已删除 Rally 的“每套至少进入正式候选”和旧 M1/M2/M3 控件。

高级设置可调整累计场次和候选置信淘汰最低样本。普通 / 高不确定性阈值显示正式搜索实际使用的最低 20 / 40 场，可以上调；不是每个车头存活保底。

修改可见参数时，正常递增场次会写入 Criterion 并清除独立旧阶段覆盖，防止 UI 与实际运行不一致。显式 API 若使用相同累计场次的连续预算剪枝，保持显式阶段表示，避免擅自合并其预算步骤。

开始搜索的 UI 日志使用动态近三代车头审计；不再为写启动日志而先在主线程枚举整套车身。

## 3. 旧存储迁移与新 API 配置分开处理

仅 `restorePersistedConfig` 加载旧存储时迁移：

- `criterion.racingVersion` 缺失或小于 3：恢复新 5/20/50/100/300、300/80/25/10/5 预算。
- 丢弃旧独立 `monteCarloStages`，初次探针改为 5，Final 入围默认改为 5。
- 保留 C0 规模等其余配置，不修改英雄、属性、兵种、对手和固定车头。
- 返回 `optimizerRacingMigrated`，自动保存和方案载入显示明确提示。

新写入 / 导出统一标注 `racingVersion: 3`。直接 API 自定义数组和显式阶段不会被当成旧存储重置。旧 API 自定义 `stages` 的实际预算会在写入前物化，避免完整 Criterion 默认值在恢复后静默覆盖该配置。物化后再次保存/恢复保持幂等。

已有全局配置 schema 与旧三队列属性迁移逻辑保持独立；新 Racing 标志不会冒充“服务器阶段调整”或“固定车头重置”。

## 4. Worker、推荐应用与导出边界

- 优化 Worker 接收当前 input / config，子 Worker 的候选任务按提交顺序返回，候选模板亲和与共同种子保持原有路径。
- 四个车身由 `memberSkillIds[4]` 物化为 `bodySkills[4]`，每个槽的 runtime ID 保持独立。
- 结果详情逐槽展示车身；应用推荐仍经 `candidateToInput`，导出逐槽保存，UI 不引入“两种车身英雄”结构。
- 手动战斗保留其现有车身规则。优化的同效果族上限由候选枚举处理；此 UI / 存储调整不修改正式技能聚合或引擎校验。
- 本轮未通过浏览器连接实测，不能把静态构建和自动化测试当成浏览器可见效果或多 Worker 实际吞吐验证。

## 5. 验证范围

新增测试覆盖：未来 S4+ R/SR 的 UI/候选排除、早期 R/SR 保留、Registry / 手动不删除、过滤后有效代数、旧预算迁移、新自定义预算保存、旧 API 阶段物化、重复累计预算、UI 参数与实际解析一致、输入验证。

已有真实 Engine 紧凑回归现在显式指定小场次；不再依靠旧 `config.stages` 去覆盖新版完整 Criterion 默认数组。已保留原始胜率、共同种子、Final 场次、输入不修改、同步/异步一致性断言。

正式 BattleEngine、DamageEngine、HP、英雄技能、索敌、统一结算和 ThreeQueue 剩余兵传递未被此模块调整。
