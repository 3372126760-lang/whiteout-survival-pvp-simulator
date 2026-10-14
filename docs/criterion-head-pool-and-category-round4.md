# Round 4：英雄类别、服务器车头限制与动态审计

## 规则与边界

`HeroCategory = "R" | "SR" | "S"`。R、SR 是独立类别，没有 `sGeneration`；原有 `rarity: "SSR"` 映射为 S 类，只有 S 类英雄有 S1–S16 代数。兼容 UI 旧字段 `generation` 对 R/SR 固定为 `null`，不虚构 S0/S1/S4。

- 服务器 S2 及更早：车头优化仍允许 R/SR。
- 服务器 S3 及之后：Head 优化域排除全部 R/SR，包含基础英雄；与英雄本人的代数无关。
- 同一过滤供「玩家英雄池」「优化范围」可见项、拥有范围和启用候选 ID 使用，A/B 各自取其启用池。
- 注册表不删除任何英雄；手动阵容、历史配置与车身池仍可使用 R/SR。车身枚举不读取 Head 优化范围。
- 当手动基线含 R/SR 时，可作为原方案独立评估；它不会作为新生成的 S3+ Head 候选。
- 本次只调整元数据与搜索合法性；正式战斗规则、英雄技能、伤害与 HP 公式未改。

`src/pvp/validationUi/heroCategory.ts` 提供 `heroCategory`、`heroSGeneration`、`heroCategoryMetadata` 与 `heroCategoryLabel`；只依据结构化字段，不解析名字或 ID 伪造代数。

## 近三代窗口

令 `P` 为当前侧拥有、启用、服务器可用且通过 Head 类别过滤的英雄池：

```
G = max({hero.sGeneration | hero ∈ P 且 hero.category = S})
窗口 = [max(1, G − 2), G]
```

新生成的完整 Head 至少包含一个窗口内 S 英雄。三个位置均选择池内对应兵种的英雄；允许旧 S 英雄与近期英雄混搭。R/SR 即使带有错误的旧 `generation`/`sGeneration`，也不能抬高 G 或满足近期条件。

S11 服务器只启用到 S8 时，窗口是 S6–S8；不能直接按服务器固定为 S9–S11。A/B 最大启用代数互不覆盖。

## 当前目录的真实计数

可重复运行：

```powershell
node scripts/run-tsx.mjs scripts/audit-optimizer-head-pool-round4.ts
```

输出：[criterion-round4-head-pool-audit.json](../examples/criterion-round4-head-pool-audit.json)。全局 Registry：R 4、SR 9、S 49。下表基于项目目录与默认全拥有、全启用范围；未收到实际用户配置 JSON，不能将它冒充某一用户截图的审计。

| 场景 | Head 英雄（盾/矛/射） | 排除 R / SR | 全合法完整 Head | 启用最大 S 代 | 近期窗口 | 近期合法 Head | ×231 比例 |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: |
| 全目录 S2 | 6 / 7 / 7 | 0 / 0 | 294 | 2 | S1–S2 | 219 | 50,589 |
| 全目录 S3 | 4 / 3 / 3 | 4 / 9 | 36 | 3 | S1–S3 | 36 | 8,316 |
| 默认全池 / 全目录 S11 | 12 / 11 / 11 | 4 / 9 | 1,452 | 11 | S9–S11 | 876 | 202,356 |
| S11 只拥有/启用至 S8 | 9 / 8 / 8 | 4 / 9 | 576 | 8 | S6–S8 | 426 | 98,406 |
| 全目录 S16 | 17 / 16 / 16 | 4 / 9 | 4,352 | 16 | S14–S16 | 1,986 | 458,766 |
| 旧大型纯 SSR 夹具（15/16/16） | 15 / 16 / 16 | 0 / 0 | 3,840 | 16 | S14–S16 | 1,812 | 418,572 |

计数动态来自目录、服务器与启用范围，没有硬编码 876 或 1812。该旧大型夹具原本就是纯 SSR，1812 **不含 R/SR**；它与默认 S11 池不是相同输入，不能把两者差额归因于非法 SR。

完整无锁 Head 的计数公式：

```
allLegalHeadCountBeforeRecentRule = nShield × nLancer × nMarksman
recentEligibleHeadCount = allLegal − oldShield × oldLancer × oldMarksman
rawHeadRatioCount = recentEligibleHeadCount × ratioCount
```

本脚本采用无锁 5% 完整比例网格，`ratioCount = 231`。固定位置、额外筛选、实际比例范围、手动基线和缺位阵容由候选生成器另行计数，不能直接套用这张表。

## 审计字段

- `serverGeneration` 与 `rHeroCount / srHeroCount / sHeroCount`：服务器可用目录的类别计数。
- `registryCategoryCounts`：完整目录的类别计数，保留 R/SR。
- `enabledPoolCategoryCounts`：类别过滤前的当前侧拥有、启用、服务器合法范围。
- `excludedRByServerStage / excludedSRByServerStage`：此启用范围被服务器 Head 类别规则排除的数量。
- `optimizerHeadHeroCount`、`sHeroCountByGeneration`、`heroCountByTroopTypeAfterHeadFilter`：类别过滤后的候选池。
- `maxEnabledSGeneration`、`recentSGenerationWindow`、`allLegalHeadCountBeforeRecentRule`、`recentEligibleHeadCount`、`rawHeadRatioCount`：近期限制与完整网格数量。

初始化不会建立隐藏 R/SR 的优化设置；已有旧池条目也不会被删除。为避免初始化把排除计数从 13 变为 0，隐藏且未建立条目的 R/SR 在过滤前沿用旧 `availableHeroIds` 的启用默认值；显式停用仍有效。最终 Head 过滤无条件拒绝 S3+ R/SR，缺失的可见 S 设置仍按停用处理。

## 回归验证

针对 S2 / S3 / S11、R/SR 假代数、A/B 启用最大代数、S8 近期窗口、Registry 与手动 R/SR、SR 独立车身、初始化与进度往返、目录动态乘积的测试已加入 `optimizerHeadRarityFilter.test.ts`。与 `optimizerBasinsAndPolicy.test.ts`、`heroPoolAndThreeQueueCandidates.test.ts` 联合运行：3 文件、23 测试通过；所有自有修改文件 ESLint 通过，整仓 typecheck 通过。完整项目 gate 以主代理的本轮总报告为准。
