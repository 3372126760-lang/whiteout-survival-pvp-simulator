# PVP Criterion 优化器第三轮修正与验收报告

> 历史版本：本文记录 Round 3 当时的要求与测量。Round 4 已将英雄类别规则改为「服务器 S3+ 的车头优化域排除所有 R/SR」，R/SR 没有 S 代数。本文旧排除规则、默认池计数与“不实施 876”描述不代表当前行为。当前动态计数见 [Round 4 类别与车头审计](criterion-head-pool-and-category-round4.md)，当前整体实现见 [Round 4 总报告](pvp-criterion-optimizer-round4.md)。

日期：2026-10-07。本轮修复当前第二版架构，保留 Criterion / MatrixCriterion / DeterministicTheory 与正式战斗规则。

## 1. 交付状态与证据边界

- 已完成车头稀有度规则、C0 全局竞争、四槽车身枚举、M1a 配对探针、20/40 样本置信门槛、UI 与保存迁移。
- typecheck / lint / build 通过；完整测试 `npm.cmd test -- --maxWorkers=2`：90 文件、991 项通过。日志见 [全量测试](../examples/criterion-round3-test-results.log)。构建保留已有主 bundle 超过 500 kB 的提示。
- [72 个正式核心文件 SHA256 审计](../examples/criterion-round3-core-boundary-audit.json)：changedFiles=[]。伤害/HP、行动/索敌、N0、快照、回合末、取整、溢出、normal/skill/extra 分类、护盾/技能时序、ThreeQueue 剩兵和正式车身 runtime 隔离均未改。
- 已完成 UI 参数/保存行为回归及生产构建。现有 Edge 扩展两次返回 `nodeRepl.fetch request failed`，未取得浏览器页面或真实配置；不能声称浏览器自动化验收通过。仅查得现有服务监听5173，未启动新的 dev server。
- 用户 182.95 秒报告缺少完整双方导出配置。下面有完整目录审计，以及上一轮同一合成输入的真实引擎 benchmark；它不能证明用户该对局的耗时、胜率或同配置增量。

## 2. 车头池：为什么仍可能得到 1812

硬过滤为 `hero.generation >= 4 && rarity in {R, SR}`，只约束优化车头。UI 与中央 optimizationHeroIds / CandidateGenerator 同步过滤；注册表、普通手动战斗与车身池保留。

当前目录中 S1–S16 季节英雄全部为 SSR；13 位基础 R/SR 的 generation 是 null。不能把服务器到 S11 当成这些英雄本人变成 S11。按本轮字面规则，当前 S11 默认池排除 S4+ R=0、SR=0。

| 字段（S11 默认拥有/启用全池） | 实测值 |
|---|---:|
| optimizationPoolVisibleHeroCount | 47 |
| excludedPostGen3RCount | 0 |
| excludedPostGen3SRCount | 0 |
| allLegalHeadCountBeforeRecentRule | 3840 |
| effectiveHeroGeneration | 11 |
| recentGenerationWindow | [9, 11] |
| recentEligibleHeads | 1812 |
| oldRecentHeadsRemovedByRarity | 0 |
| rawHeadRatioCount | 418572 |

兵种位置数量：盾15、矛16、射16。代数直方图：{"0": 13, "1": 4, "2": 3, "3": 3, "4": 3, "5": 3, "6": 3, "7": 3, "8": 3, "9": 3, "10": 3, "11": 3}（键0仅代表原始空代数的统计桶）。

动态计算：`15×16×16 − 12×13×13 = 1812`；`1812×231 = 418572`。这里未写死 1812，也未强凑 876。876 对应另一个“只留 SSR”的池：`12×11×11 − 9×8×8 = 876`；该规则会排除基础 R/SR，不等同本轮明确的 S4+ R/SR 规则。真实用户启用/拥有池若不同，将重新动态计算。

完整源数据：[Head Pool 审计](../examples/criterion-head-pool-round3-audit.json)。含 S16 和早期 1812 大池 fixture 的独立记录。

## 3. C0 全局理论筛选

全部满足近三代硬规则的 Head×Ratio 参加全局潜力排名。弱车头的全部231个比例可以消失。高质量车头依靠理论排名自然存活；少量 uncertainty / special / disagreement / diversity 都是全局通道。已删除 unused protectHeadBasins 和新 Rally 路径全部 per-head 最小候选保护，UI 不再显示该字段。

默认大空间 C0 上限2000；小空间使用现有 fraction/floor 的动态预算。精确 baseline 与显式已记录的保护结构是独立身份例外，不构成每个车头保底。

## 4. 四个车身槽与旧错误路径

四槽可以 A+B+C+D / A+A+B+C / A+A+B+B；DFS 每次追加时检查主 effectFamily 的计数，超过2立刻剪枝。每槽记录 heroDefinitionId / runtimeInstanceId / effectFamily / skillId / level，重复定义保留不同 runtimeInstanceId。

旧错误字符串分别存在于 generateFormations 与 generateRawBodyFormations 的固定车身验证。M4 后微调会用父方案四槽列表重新走 fixedBodyExact 验证，这是可触发旧报错的直接调用路径。当前未取得用户原配置及栈，不能断言当次究竟是哪条父方案触发；两处校验、贪心填充及后续候选过滤的两英雄限制已全部删除。

同效果目录的英雄身份不再触发额外唯一性限制。旧 allowDuplicateMembers 字段只做配置兼容，不增加搜索硬限制。四种英雄已通过候选→Final→应用→导出恢复→正式 ScenarioRunner；相关回归在 criterionFourBodyLifecycle.test.ts。

### 完整车身池预处理（非用户对局）

| 阶段 | S11 | S16 |
|---|---:|---:|
| sourceSkillCount | 42 | 57 |
| rawBodyCombinationCount | 3,111,696 | 10,556,001 |
| rejectedDuringGenerationBySameEffectFamily | 112,620 | 342,549 |
| afterSameEffectMax2 | 2,999,076 | 10,213,452 |
| rejectedByStrictDominance | 0 | 0 |
| afterStrictDominance | 2,999,076 | 10,213,452 |
| rejectedByProbabilityDominance | 1,178,952 | 3,106,680 |
| afterProbabilityDominance | 1,820,124 | 7,106,772 |
| rejectedBySemanticEquivalence | 1,800,622 | 7,027,710 |
| semanticBodyCombinationCount | 19,502 | 79,062 |
| rejectedByParetoDominance | 14 | 14 |
| afterPareto | 19,488 | 79,048 |
| rejectedByLowMarginalStacking | 0 | 0 |
| afterMarginalStacking | 19,488 | 79,048 |
| finalPreprocessedBodyCount | 19,488 | 79,048 |

取消两英雄上限后，S11 原始空间从旧11816变为42^4=3111696；3792属于旧限制下的预处理结果。正确四槽空间可以更大，同族规则不能删除四种不同效果的合法组合。无任意数量 cap。保守 Pareto 仅删除14个模板：复杂、时序、控制、概率及未验证补偿项不能凭数值宣布严格下位。

严格下位与相同期望的概率/常驻稳定性支配先于重签名。普通受到伤害降低仍以 expectedReduction 加到 `1+totalOrdinaryReduction` 分母；边际贡献保持 Δlog(1+B+v)。

理论模板合并与正式 seed/槽顺序等价分开统计。等数值别名、可交换的当前 Criterion 模板可共享预筛模板，但未宣称概率技能所有槽顺序的正式单 seed 输出相同；选中的实际顺序照常物化，人工保护身份及原顺序保留。

边际严格剪枝没有脱离 Head/Ratio 的通用证明，故 B0 的 rejectedByLowMarginalStacking=0，afterMarginalStacking=afterPareto；C1 的上下文候选剪枝单独记 rejectedJointByLowMarginalStacking，避免把重复的 Joint 行数混成 Body 池拒绝量。每 HeadBody 缓存7个系数，重复比例改为6权重内积与常数项；仅缓存一个活动车头。旧 Criterion-disabled 搜索也接入同一预处理，避免分配数百万身份数组。

完整证据：[四槽预处理审计](../examples/criterion-round3-full-body-audit.json)、[枚举说明](pvp-body-enumeration.md)。

## 5. 新 Racing 与 UI/保存

| 层 | 累计正式场次 | 默认全局保留 |
|---|---:|---:|
| M1a probe | 5 | 300 |
| M1b | 20 | 80 |
| M2 | 50 | 25 |
| M3 | 100 | 10 |
| M4 | 300 | 5 |
| Final | 1000 | Top5 + exact baseline / 记录的保护身份 |

M1a 不用独立5场胜率做 Top36。默认六 lane：Theory40%、Matrix20%、paired20%、uncertainty8%、special4%、disagreement8%，全局 union / deduplicate 后用组合排名填充；不设 Head 配额。记录每个候选对应相同 seed 的 pairedWins/Losses/Draws、deltaOutcome、deltaRemainingTroops、pairedScore 及 reference。高理论候选即使1/5仍可由理论 lane 进入20场。

普通候选最低20场、高不确定性或 hardToStaticize 最低40场才可被 CI 淘汰，较低旧配置不能降低绝对底线；不再用 min(maxRuns, minimum) 缩短门槛。预算退出与 confidence 严格区分，不保证每个 Head 活到20场。后续全局 TopK 的预算退出不冒充统计显著性。

配置 racingVersion=3。UI 显示实际执行 schedule；同一 resolveJointRacingSchedule 被运行、显示与保存使用。旧无版本/低版本页面存储迁移为新 preset，新版显式自定义累计预算保留；编辑 UI 预算会解除独立 API monteCarloStages override。旧 API 自定义 stages 在新写入时记录其实际语义；重复累计预算仍可保存和显示。

详见 [池/界面/迁移说明](criterion-head-pool-and-racing-ui-round3.md)。

## 6. 同一合成输入 benchmark

Same prior-round synthetic equal panels, seven head / four body hero pool. Real official BattleEngine, final1000. This is NOT the user183s/fullpool configuration.

input 与上一轮逐项 JSON 相同：True。50 个 optimizer 源文件测量前后指纹相同。命令 `npm.cmd run benchmark:criterion-round3`；完整输入、配置、逐候选配对证据、每阶段结果、Top5 与指纹见 [原始 JSON](../examples/criterion-search-round3-benchmark.json)。

| 对比项 | 第二轮 | 本轮 |
|---|---:|---:|
| 总墙钟秒 | 167.30 | 146.71 |
| requested | 33,780 | 24,075 |
| executed | 21,650 | 17,050 |
| reused | 12,130 | 7,025 |
| Final候选 | 14 | 7 |

墙钟降低 12.31%；正式执行降低 21.25%。平均单场正式执行耗时 8.510ms。这个降幅只适用于该合成配置。

### Head / C0 / Joint 审计

| 字段 | 本轮合成值 |
|---|---:|
| optimizationPoolVisibleHeroCount | 7 |
| excludedPostGen3RCount | 0 |
| excludedPostGen3SRCount | 0 |
| heroCountByTroopTypeAfterRarityFilter | {"shield": 3, "lancer": 2, "marksman": 2} |
| heroCountByGenerationAfterRarityFilter | {"1": 2, "3": 1, "10": 1, "11": 3} |
| allLegalHeadCountBeforeRecentRule | 12 |
| effectiveHeroGeneration | 11 |
| recentGenerationWindow | [9, 11] |
| recentEligibleHeadCount | 11 |
| rawHeadRatioCount | 2541 |
| headsBeforeC0 | 11 |
| headsAfterC0 | 4 |
| headsFullyEliminatedAtC0 | 7 |
| retainedHeadRatioCount | 28 |
| retainedByMainTheory | 21 |
| retainedByUncertainty | 1 |
| retainedBySpecialMechanism | 1 |
| retainedByDisagreement | 1 |
| retainedByDiversity | 2 |
| rawBodyCombinationCount | 256 |
| afterSameEffectMax2 | 204 |
| afterStrictDominance | 204 |
| afterProbabilityDominance | 204 |
| semanticBodyCombinationCount | 20 |
| afterPareto | 20 |
| afterMarginalStacking | 20 |
| finalPreprocessedBodyCount | 20 |
| rejectedJointByLowMarginalStacking | 0 |
| roughJointEvaluations | 560 |
| matrixCriterionCandidates | 560 |
| deterministicTheoryCandidates | 72 |

C0 合成11个合法近三代 Head 中4个存活、7个整体淘汰；28个 HeadRatio 含两条明确保护结构额外身份。主排名/全局救援26个与保护结构区别记录。

### Monte Carlo 与时间

| 层 | 进入 | 晋级 | 累计场次 | requested | executed | reused | 秒 |
|---|---:|---:|---:|---:|---:|---:|---:|
| M1a · 共享种子全局探针 | 29 | 29 | 5 | 145 | 145 | 0 | 1.892 |
| M1b · 候选累计样本复筛 | 29 | 29 | 20 | 580 | 435 | 145 | 4.169 |
| M2 · 累计联合筛选 | 29 | 26 | 50 | 1450 | 870 | 580 | 8.018 |
| M3 · 累计联合筛选 | 26 | 11 | 100 | 2600 | 1300 | 1300 | 11.517 |
| M4 · 累计联合筛选 | 11 | 6 | 300 | 3300 | 2200 | 1100 | 18.116 |
| M4 · 联合盆地正式复筛 | 30 | 7 | 300 | 9000 | 7200 | 1800 | 60.255 |
| Final · 联合方案统一高场次复验 | 7 | 7 | 1000 | 7000 | 4900 | 2100 | 41.293 |

| 前置阶段 | 秒 |
|---|---:|
| H0 | 0.0265 |
| B0 | 0.0075 |
| C0 | 0.5534 |
| C1 | 0.0027 |
| C2 | 0.1164 |
| C3 | 0.4695 |

### Protection / elimination

小空间仅29个正式候选，小于M1a300/M1b80预算，因此5场后全部29个进入20场，不人为补足300。1500→300及Theory高排名1/5存活由专门规模回归验证。

| 字段 | 本轮合成值 |
|---|---:|
| m1aCandidateCount | 29 |
| m1aBattlePerCandidate | 5 |
| m1aAdvancedCount | 29 |
| m1bCandidateCount | 29 |
| m1bAdvancedCount | 29 |
| m1aRejectedByTheoryBudget | 0 |
| m1aRejectedByFiveRunProbe | 0 |
| m1aProtectedByTheory | 11 |
| m1aProtectedByUncertainty | 2 |
| m1aProtectedBySpecialMechanism | 1 |
| uniqueHeadsAtM1a | 3 |
| uniqueHeadsAfterM1a | 3 |
| uniqueBodiesAtM1a | 13 |
| uniqueBodiesAfterM1a | 13 |
| candidatesEliminatedWith5Samples | 0 |
| candidatesEliminatedByConfidenceWith5Samples | 0 |
| headsEliminatedByConfidenceWithLessThan20Samples | 0 |
| highUncertaintyEliminatedWithLessThan40Samples | 0 |
| 所有阶段 confidence 淘汰 | 0 |
| 后续 MC budget 淘汰（非CI结论） | 46 |

Probe lane计数允许重叠，合并去重并另外统计参考身份；完整 pairedProbeEvidence 已保存在JSON。各阶段 entered=advanced+eliminated，requested=executed+reused，CI淘汰后的计数已修复且有专门回归。

### Top5 完整结果

Final 7套、2种Head、2种有序Body，全部1000场；当前方案胜率 73.1%。已知11盾/Miya/11射/无名2+诺拉2/57-3-40保留至Final。它是已记录保护结构，本次结果不证明无保护的自动发现。以下100%为合成对局结果，不是用户真实战报胜率。

#### #1

```json
{
  "head": {
    "shield": "hero.s11.eleonora",
    "lancer": "hero.s3.miya",
    "marksman": "hero.s11.rufus"
  },
  "headWeaponLevels": {
    "hero.s11.eleonora": 10,
    "hero.s3.miya": 10,
    "hero.s11.rufus": 10
  },
  "bodySlots": [
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-0",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-1",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-2",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-3",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    }
  ],
  "ratio": {
    "shield": 54,
    "lancer": 3,
    "marksman": 43
  },
  "winRate": 1,
  "trials": 1000,
  "CI_Wilson95": [
    0.996173241514445,
    1
  ]
}
```

#### #2

```json
{
  "head": {
    "shield": "hero.s11.eleonora",
    "lancer": "hero.s3.miya",
    "marksman": "hero.s11.rufus"
  },
  "headWeaponLevels": {
    "hero.s11.eleonora": 10,
    "hero.s3.miya": 10,
    "hero.s11.rufus": 10
  },
  "bodySlots": [
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-0",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-1",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-2",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-3",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    }
  ],
  "ratio": {
    "shield": 54,
    "lancer": 4,
    "marksman": 42
  },
  "winRate": 1,
  "trials": 1000,
  "CI_Wilson95": [
    0.996173241514445,
    1
  ]
}
```

#### #3

```json
{
  "head": {
    "shield": "hero.s10.gregory",
    "lancer": "hero.s3.miya",
    "marksman": "hero.s11.rufus"
  },
  "headWeaponLevels": {
    "hero.s10.gregory": 10,
    "hero.s3.miya": 10,
    "hero.s11.rufus": 10
  },
  "bodySlots": [
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-0",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-1",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-2",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-3",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    }
  ],
  "ratio": {
    "shield": 57,
    "lancer": 4,
    "marksman": 39
  },
  "winRate": 1,
  "trials": 1000,
  "CI_Wilson95": [
    0.996173241514445,
    1
  ]
}
```

#### #4

```json
{
  "head": {
    "shield": "hero.s10.gregory",
    "lancer": "hero.s3.miya",
    "marksman": "hero.s11.rufus"
  },
  "headWeaponLevels": {
    "hero.s10.gregory": 10,
    "hero.s3.miya": 10,
    "hero.s11.rufus": 10
  },
  "bodySlots": [
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-0",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-1",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-2",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-3",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    }
  ],
  "ratio": {
    "shield": 57,
    "lancer": 3,
    "marksman": 40
  },
  "winRate": 1,
  "trials": 1000,
  "CI_Wilson95": [
    0.996173241514445,
    1
  ]
}
```

#### #5

```json
{
  "head": {
    "shield": "hero.s10.gregory",
    "lancer": "hero.s3.miya",
    "marksman": "hero.s11.rufus"
  },
  "headWeaponLevels": {
    "hero.s10.gregory": 10,
    "hero.s3.miya": 10,
    "hero.s11.rufus": 10
  },
  "bodySlots": [
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-0",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s6.wuming",
      "runtimeInstanceId": "A-body-1",
      "effectFamily": "[\"damageReduction\",\"\",\"receivedNormalAttackReduction\",\"selfArmy\",\"army\",\"shield\",\"all\",\"normalAttack\",[]]",
      "skillId": "hero-skill.wuming.wind-shelter",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-2",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    },
    {
      "heroDefinitionId": "hero.s5.nuola",
      "runtimeInstanceId": "A-body-3",
      "effectFamily": "[\"damageIncrease\",\"\",\"commonDamageIncrease\",\"selfArmy\",\"shield\",\"all\",\"all\",\"all\",[]]",
      "skillId": "hero-skill.nuola.multi-troop-combat",
      "level": 5
    }
  ],
  "ratio": {
    "shield": 57,
    "lancer": 5,
    "marksman": 38
  },
  "winRate": 1,
  "trials": 1000,
  "CI_Wilson95": [
    0.996173241514445,
    1
  ]
}
```

## 7. 用户十项问题的明确回答

1. 当前默认S11近三代 Head=1812，来自过滤后的实际角色池乘积减去旧代窗口外乘积；其他拥有/启用池动态计算。
2. 当前目录和默认全池中，旧1812被S4+ R/SR规则删除0。若实际上传配置使用其他元数据，再按它审计。不能依据报告摘要把基础空代数R/SR重新标为S4+。
3. 新Rally C0与所有正式晋级/Final已取消per-head保底。
4. sameEffectFamily≤2在DFS追加时执行，非法分支不生成。
5. src/scripts已不存在最多两种不同Body英雄validator；正式四种英雄物化/应用/导出/运行均通过。
6. 默认M1a保留约300来自六个全局lane合并与组合补足；本合成仅29候选，故保留29，另有显式参考身份例外。
7. 5场confidence淘汰=0；20以下与高不确定性40以下confidence淘汰均0。
8. **对用户182.95秒同配置新增耗时暂无法给出**；缺完整导出JSON。同合成前后167.30→146.71秒。
9. **对用户10465次同配置新增runs暂无法给出**；同合成前后21650→17050。
10.全部991项回归通过，包括强/弱Head、四槽身份、概率稳定支配、M1a1500→300、1/5高理论保护、paired稳定、20/40与CI阶段计数、应用/导出/正式运行、旧配置迁移。

## 8. 真实同配置复现入口

需要本次182.95秒且status=error对局的完整导出JSON：双方属性、英雄池、车身池、约束、优化参数、seed。已向用户请求，当前尚未提供。

```powershell
npm.cmd run benchmark:criterion-round3 -- --input "导出配置.json"
```

支持页面导出 envelope（旧Racing设置按迁移规则升级）或含input/config的测试输入。输出 `examples/criterion-search-round3-user-benchmark.json`，保留完整实际配置与文件路径；必须确认该文件确为所述对局才可将其与183秒摘要比较。原始 JSON 还提供每层requested/executed/reused、平均单场耗时、各层墙钟、所有Final的完整身份/等级/CI。
