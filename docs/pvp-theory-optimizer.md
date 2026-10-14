> **历史版本归档：** 本文记录早期 TheoryPreFilter / per-head 代表 / 旧 5/20/50/200 预算，不代表当前默认行为。第三轮采用 C0 GLOBAL 无车头保底、四槽 Body effectFamily≤2 和 5/20/50/100/300 Racing；最新流程与实测见 [第三轮报告](pvp-criterion-optimizer-round3.md)。

# 多峰保护的近全局搜索：英雄过滤与多盆地比例精搜（2026-10-06）

最新验收、英雄过滤审计、盆地路径、调用量对照见 [本轮交付报告](pvp-basin-search-and-hero-policy.md)。以下内容是当时流程与验收；请勿用于解释当前默认搜索。

## 范围和流程

集结单波的车头 × 比例搜索已改为独立 `TheoryPreFilter`。单撞复用同一理论模块；333 完整枚举车头，但兵种仍固定 1:1:1。集结车身在正式阶段单独筛选，最多两个不同车身英雄。三队列继续使用已有坐标下降和调度，本轮没有枚举三支队伍的全部联合组合。

```text
服务器／英雄池合法性 → R/SR 过滤 → 近三代至少一人 → 保守严格支配
 → 全部剩余合法车头
 → 每套完整比例理论扫描
 → 该车头的多个局部峰 + 三类探索 + 参照保护
 → M1（每套至少一名代表实际进入 BattleEngine）
 → M2 正式筛选
 → 多个优秀盆地：50 场共同种子、六邻居 5% 连续爬坡
 → 多个中心的局部 1% 窗口：20 / 50 / 200 场复验
 → Final 统一高场次正式复验 + 精确原配置 baseline
 → 按正式结果排名
```

理论阶段没有全局 Top1% 截断。`maxCandidates` 仅约束后续车身和邻域扩张，不截断车头枚举或完整理论网格。理论分不是胜率；它只决定该车头首先送哪些比例进行正式验证，M1 完成后才允许淘汰整套车头。

## 1. TheoryScore

`templateBuilder.ts` 每套车头构建一次静态数值模板：复用正式场景转换、属性 resolver、兵种常数、HP 公式、scope 和伤害 group 聚合。专武外部 Buff 同组规则自动沿用正式属性 resolver。`calculateBaseTroopDamage` 和 `createDamageEvent` 仅用于初始化每个来源兵种 × 目标兵种的未取整数值系数，不运行任何正式回合。

对候选比例使用浮点人数，初始总数来自正式配置：

```text
DPS_s = sqrt(min(N_A0, N_B0)) × Σ_t sqrt(n_s,t) × cachedDamage_s,t,target
EHP_s = Σ_t n_s,t × HP_unit,s,t × nominalMitigation_s,t
TTK_s = 对方首目标总 HP / DPS_s
```

`nominalMitigation` 是对方初始兵种占比加权的正式防御／减伤分母与减防／直接抵消修正；概率类非线性分母使用等效值，因此 EHP 是排序估计。目标绑定易伤等不在该静态 EHP 内作完整生命周期模拟。输出同时保留初始 DPS、EHP、首目标 TTK、盾生存回合和射手输出窗口；后两项是诊断指标，不额外重复加权。

定义：

```text
L(a,b) = log((a+ε)/(b+ε)) / (1 + |log((a+ε)/(b+ε))|)
D(a,b) = (a-b) / max(ε, |a|+|b|)
ε = 1e-9
staticScore_A = 0.55 L(DPS_A,DPS_B)
              + 0.30 L(EHP_A,EHP_B)
              + 0.15 D(TTK_B,TTK_A)
```

`DeterministicBattleEstimator` 独立运行最多 24 个连续估计回合。新 `expectationProgram.ts` 由正式技能定义构建私有期望状态，复用正式属性／伤害／HP／效果聚合函数，按正式行动顺序与回合开始浮点快照计算，末尾统一扣除 `damage/HP_unit`。不调用 BattleEngine，不生成 BattleTrace，不改变正式技能状态。默认索敌仍是当前正式代码的盾→矛→射；奇袭分支使用射→盾→矛，超量伤害不跨栈穿透。

每个兵种对每个目标保留 3×3 下一轮输出矩阵，伤害含 `sqrt(N0) × sqrt(n_float)`。`initialNextRoundOutput=O0`、`nextRoundOutput=Or`、`outputRetention=Or/O0` 使用实际存活目标和目标概率分支。25% 兵数在相同目标／状态下约保留 50% 输出；不是把剩余人数比例当攻击能力。矩阵是各目标潜在输出，标量按当前实际索敌汇总并扣除期望护盾吸收；没有存活目标时标量为 0。输出字段仅作辅助解释，未改变下述 35%/65% 权重。

```text
remaining_s = 估计剩余人数 / 初始人数
terminal_A = A 胜 +1，A 败 -1，双方都存活或都灭亡 0
deterministicScore_A = 0.7 terminal_A + 0.3(remaining_A-remaining_B)
TheoryScore = 0.35 staticScore + 0.65 deterministicScore
```

优化 B 时对优势分取反。权重是当前工程排序启发式，没有拟合为真实胜率；最终排名不使用这些权重。

## 2. Uncertainty 和概率等效

每侧启发式不确定性累计：

| 来源 | 增量 |
| --- | ---: |
| 概率技能（每项技能） | 0.035 |
| 暂定／规则未验证技能 | 0.04 |
| 未完整传播的关联行动／目标标记机制 | 0.08 |
| 省略的单项 effect、跨回合概率／控制／目标关联近似 | 每项 0.045 |

每侧封顶 0.8；取双方平均，再在估计回合上限仍未结束时加 0.08、单兵种比例达到 90% 时加 0.03，最终封顶 0.95。这是理论模型的失真风险标记，不是统计置信区间。

纯数值概率技能使用：

```text
mathematicalExpectation = probability × value
usedEquivalent = calibratedEquivalents[effectId]
              ?? mathematicalExpectation × probabilityEquivalentCoefficient
```

系数只修正概率小于 1 的效果，默认 1；没有伪造已校准数据。按 `effectId` 配置的值优先，模板保留 `{ skillId, effectId, mathematicalExpectation, calibratedEquivalent?, usedEquivalent }`。例：巴希提 50% × 50% 附伤数学期望 0.25，配置校准值 0.18 后使用 0.18。

当前期望程序支持数值概率贡献、普通暴击期望、目标分支、闪避／眩晕边际、命中依赖、独立附伤与同主攻击段的追加伤害、自然回合／实际主攻击计数周期、nextRound 持续状态、数值 Buff/Debuff 和加托护盾期望预算。周期技能按计数或回合触发，不摊成每回合平均值。

以下仍是估计边界：目标绑定标记／一次性易伤／衰减伤害／skipMainAttack 暂未完整传播；跨回合概率刷新、眩晕与攻击计数的联合分布、非线性分母和随机护盾吸收使用近似。相关机制在 `omittedMechanisms` 中记录并增加不确定性。它不是完整概率状态树，也不是正式战斗的确定等价版本。正式 BattleEngine 仍逐回合按原技能规则执行，所有输入的禁用／调试设置保留；强制触发调试不作为理论校准依据。详见本轮交付报告的边界说明。

## 3. 比例多峰与探索

5% 网格有 231 点；一个内部点有六个守恒转移邻居：一兵种减 5，另一兵种加 5。分数 ≥ 所有合法邻居即为局部峰。

每套车头默认保留：

| 类别 | 数量 | 规则 |
| --- | ---: | --- |
| 局部峰 | 3 | 取分数最好的峰；不足时用本车头理论 Top 补齐 |
| 不确定性探索 | 1 | 最大化 `TheoryScore + k × Uncertainty`，默认 k=1 |
| 比例结构探索 | 1 | 优先未覆盖结构区，再最大化与已选比例的 L1 距离 |
| 随机探索 | 1 | seeded RNG，优先未覆盖结构区中的未选点 |

结构区为盾重、矛重、射重、均衡、极端。同分时优先更远的点，避免平坦峰全部挤在一起；候选去重并合并入选理由。网格足够大时默认六个代表，小网格可少于六个；至少保证 `minSurvivorsPerLineup`（默认 1；大于网格大小时至多保留全网格）。不存在 `Math.random()`。

先按新英雄规则确定合法组合 H，再扫描 H×231，保留每套多个峰和探索代表。S11 默认目录实际为 47→34 名英雄、3,840→1,452→876 套组合，对应 202,356 个理论点；该完整目录计数来自枚举审计，不是完整 1000 场运行。默认通常每套 6 个代表，参照补点和去重会改变实际 M1 数量；以运行调试为准。上一轮 3,840／887,040／23,040 口径已成为过滤前的历史空间。

## 4. 默认正式预算与保护

| 阶段 | 每候选正式场次 | 常规保留数量 |
| --- | ---: | ---: |
| M1 | 5 | 3000 |
| M2 | 20 | 500 |
| M3 | 50 | 50 |
| M4 | 200 | 10 |
| Final | 1000 | 最终展示 Top5 |

`OptimizationConfig.monteCarloStages` 可覆盖整套 `{trials, keep}` 日程。兼容旧 `stages`：`initialBattleTrials` 为 M1 上限（不超过 M2 场数），三段 `stages[].trials` 分别对应 M2/M3/M4；`stages[].keep` 分别是 M1/M2/M3 预算，M4 使用 `verificationTop`。单撞／333 同样支持显式日程、M1 和中间场数参数。

每阶段共享 seeds，偏移依次 0、100000、200000、300000；Final 和精确 baseline 使用 500000。不同阶段样本不混排。M1 完整执行每个代表，关闭提前淘汰；后续允许正式统计提前停止，未跑足的候选不进入下一层或最终排名。Final、当前参照和受保护人工候选不做提前停止。

当前原配置在 Final 单独直接运行；合法的对手车头 + 当前实际比例，以及 `protectedCandidates` 内合法人工方案，从 M1 到 Final 一直保护，不受 TopK 删除。保护方案仍受英雄池、服务器阶段、固定车身及最多两个不同车身英雄约束；原始 baseline 可以在搜索约束外独立验证。最终胜率优先，保证不低于当前和受保护手动方案在相同最终 seeds 上的结果。

M2 后默认选 4 个优秀盆地，每套车头最多 2 个、同车头种子保持比例距离。使用 M3 的 50 场与 offset=200000 的同一套 seeds 验证中心和六个 5% 转移邻居，移动到更优点继续扩张，直到局部最优或最多 6 轮。随后最多 4 个中心各生成盾／矛 ±5 百分点的局部 1% 窗口，射手补足 100%；内部窗口为 121 点，不运行所有车头×5151。

局部点先用 M2 的 20 场共同种子复筛，再进入 M3 50、M4 200、Final 1000；已验证的爬坡中心保留到 M3，避免被 20 场噪声提前挤出。胜率是阶段主排序，剩余兵数只作同胜率次序。相同候选／场数／seed offset 的完整结果缓存复用；提前淘汰的残缺样本不会晋级。扩张／精搜理由分别为 `localExpansion`／`fineSearch`，不继承父节点理论分冒充子节点的正式结果。车身替换仍为 `bodyScreening`，自动车身同样遵守 S3+ 稀有度规则，用户明确固定的车身槽和原始 baseline 保留。多波复用既有真实轨迹 Beam 搜索，正式候选继续使用 Worker 池与 FastBattleMode。

## 5. 修正候选兵数转换

复核发现旧 `candidateToInput` 只写 `rallyDeployment.ratios`。最终战报模式的正式适配器读取 `troops.*.count`，导致旧比例搜索没有实际改变参战人数。

现在最终战报模式以原始三个兵种真实兵数的总和固定总兵力，根据候选比例调用现有最大余数分配，更新 `troops.*.count` 和部署元数据；混等兵按原分布重分配等级数量。12 项属性、等级类型、技能配置和 B 侧保持原输入。预测模式继续让现有容量／部署适配器生成兵数。

理论模板也通过该转换，因此每个比例的理论浮点人数和正式整数人数指向同一总兵力。当前参照比例从最终战报实际兵数反算，不读取可能过期的部署比例。36000 人、52/38/10 对应 **18720/13680/3600**，已加入回归。

此修复属于优化器配置适配；BattleEngine、DamageEngine、伤害公式、HP 公式和技能定义未修改。此前比例未生效的 72.0%／51.3% 历史合成结果不作为本轮有效验收，下面的对照重新测试两种搜索流程，使用相同已修复的候选转换，以比较算法本身。

## 6. Coverage 与调试

调试包含：`theoryCandidateCount`、`legalHeroLineupCount`、`theoryHeroCoverage`、`ratiosPerHeroLineup`、`localPeaksDetected`、`battleCandidateCount`、`heroLineupsEnteringBattleEngine`、`battleHeroCoverage`。

`theoryLineups` 保存每套车头的完整扫描数量、局部峰数和代表数量；`battleSelections` 保存每个实际候选的 key 和合并的 `selectionReasons`：`theoryLocalPeak`、`theoryTop`、`uncertaintyExploration`、`randomExploration`、`ratioDiversity`、`localExpansion`、`fineSearch`、`bodyScreening`、`currentConfig`、`protectedReference`。`monteCarloStages` 保存阶段候选数、场数、保留数和实际运行场数。

新增 `heroPoolAudit`（分层计数、排除原因、完整支配比较和三档分类）及 `ratioSearchAudit`（每个盆地的种子、连续中心、停止原因、精搜中心、新比例数和车头数）。`basinSearch` 参数随配置保存／恢复。

页面显示 Theory 覆盖、每套比例数量和 M1 候选数；展开高级调试才生成完整 JSON，避免 3840 阵容的调试内容拖慢普通渲染。理论分只在调试来源中显示，不显示“理论胜率”。新增参数随自动保存／JSON 导入导出恢复；旧配置缺字段使用新默认值，其显式场数预算保留。

## 7. 上一轮历史验证与实测

本节保留上一轮过滤前结果，不能当作当前英雄过滤和比例扩张版本的结果。当前结果以 [本轮交付报告](pvp-basin-search-and-hero-policy.md) 和 [本轮实测 JSON](../examples/basin-optimizer-benchmark.json) 为准。

<!-- BENCHMARK -->

已运行 typecheck、lint、engine/UI build；**71 个测试文件、843 项测试全部通过**。构建仍有既有的主包超过 500 KB 提示，构建成功；本轮未做浏览器人工验收，也未启动新 dev server。

### 完整覆盖验收

`rallyFullHeadCoverage.test.ts` 用真实 FastBattleEngine 首轮验证：

| 指标 | 结果 |
| --- | ---: |
| 合法车头 | 3840（15×16×16） |
| 理论评估 | 887040 |
| 每套比例扫描 | 231 |
| 每套进入正式候选 | 6 |
| M1 候选 | 23040 |
| 理论英雄覆盖 | 100% |
| 正式英雄覆盖 | 3840/3840，100% |

该覆盖用例每候选 1 场、最多 1 回合，不能据此推断胜率。默认每候选 5 场是实际搜索预算，未将此覆盖测试冒充默认大空间性能测量。

### 同空间真实旧／新对照

执行 `npm run benchmark:theory-optimizer`：固定空车身、相同八套合法车头、231 点粗网格、种子 91、最多 300 回合，两版最终都用同一套 1000 seeds。两种算法均采用已经修复的候选兵数转换；这里比较搜索流程，不复现比例没有生效的旧错误。旧搜索快照在 `scripts/benchmarks/legacySingleWaveSearch.ts`，生产代码不调用。

| 指标 | 旧流程 | 新流程 |
| --- | ---: | ---: |
| Theory 候选 | — | 1848 |
| Theory 扫描耗时 | — | 54.21 ms |
| M1 正式候选 | 24 | 51 |
| 搜索正式战斗总场次（含 baseline） | 60,040 | 41,005 |
| 搜索总耗时 | 524.14 s | 343.71 s |
| 最佳 1000 场胜率 | 89.4% | 94.2% |
| 最佳比例（盾/矛/射） | 44/9/47 | 52/8/40 |

正式调用量减少 **31.70%**，墙钟耗时减少 **34.42%**；最佳胜率增加 **4.8 pct**。

旧最佳车头：`hero.s1.nataliya/hero.s1.moli/hero.s11.rufus`。

新最佳车头：`hero.s1.nataliya/hero.s11.lloyd/hero.s11.rufus`。

手动参照为十一代三车头、50/20/30，最终胜率 **86.6%**；入选理由 `protectedReference`，保留到最终，推荐达到／超过手动和旧流程。脚本对这两项质量条件都会失败退出；独立再跑手动参照的 1000 场仅用于验证，不计入搜索耗时和搜索调用量。

新流程本次扫描全部 1848 点，检测 13 个局部峰，送入 M1 的 51 点包含 48 个多峰／探索代表以及三个去重后的参照补点；理论与正式英雄覆盖均为 8/8，100%。

| 新阶段 | 候选数 | 计划场数 | 实际场次 | 保留数量 |
| --- | ---: | ---: | ---: | ---: |
| M1 · 全车头正式验证 | 51 | 5 | 255 | 51 |
| M2 · 正式逐级筛选 | 51 | 20 | 1020 | 51 |
| M3 · 正式逐级筛选 | 151 | 50 | 4770 | 50 |
| M4 · 正式逐级筛选 | 110 | 200 | 20960 | 13 |
| Final · 统一高场次复验 | 13 | 1000 | 13000 | 13 |

最终另有精确 baseline 1000 场，计入总调用量。正式提前淘汰使实际场次可低于候选数×计划场数；最终排名只使用完整 1000 场结果。

原始参数、种子、最佳候选、剩余兵数分布、Coverage 和阶段场次见 [实测 JSON](../examples/theory-optimizer-benchmark.json)。这是已有合成等属性回归，不是用户真实战报。八套空间与 3840 套覆盖测试分别验证性能／质量和全空间进入首轮，二者不可混为一次测量。单机 Node 串行对照，墙钟时间受运行环境影响，没有把这一次测量推广为所有阵容的固定加速比。

回归覆盖六邻居与多个局部峰、峰不足补齐、低分阵容仍保留、高不确定性探索、结构多样性、固定 seed、不调用 Math.random、官方系数与 HP、概率校准优先级、复杂机制省略、人工保护和约束、真实正式排名优先、共同 seeds、单撞 B 侧、333 固定比例、最终战报候选实际人数及配置参数存取。

<!-- END BENCHMARK -->

## 8. 核心实现文件

| 文件 | 作用 |
| --- | --- |
| `src/pvp/optimizer/theory/templateBuilder.ts` | 复用正式属性／效果函数构建系数模板，处理概率等效与复杂机制省略 |
| `src/pvp/optimizer/theory/expectationProgram.ts` | 私有期望技能状态、时序、目标分支、计数与回合缓存 |
| `src/pvp/optimizer/heroSearchPolicy.ts` | 英雄稀有度／近三代规则、完整签名与保守支配审计 |
| `src/pvp/optimizer/basinSearch.ts` | 多盆地连续 5% 扩张与局部 1% 窗口 |
| `src/pvp/optimizer/theory/staticEstimator.ts` | DPS、EHP、TTK、下一轮输出及保留率 |
| `src/pvp/optimizer/theory/deterministicBattleEstimator.ts` | 连续兵量确定性估计，无正式战斗、RNG 和日志 |
| `src/pvp/optimizer/theory/ratioPeakDetector.ts` | 六邻居 simplex 图与多峰检测 |
| `src/pvp/optimizer/theory/theoryPreFilter.ts` | 每套的峰、补齐、探索、多样性与 seeded RNG |
| `src/pvp/optimizer/theory/rallyPreFilter.ts` | 完整车头 × 网格扫描、人工／当前／对手参照保护 |
| `src/pvp/optimizer/singleWaveSearch.ts` | M1–M4、扩张、正式排名、Coverage |
| `src/pvp/optimizer/scenarioOptimizer.ts` | 单撞／333 共用理论层及分级正式验证 |
| `src/pvp/optimizer/candidateGenerator.ts` | 最终战报候选比例生成实际兵数 |
| `src/pvp/optimizer/troopAllocation.ts` | 复用单撞混等兵数量重分配 |
| `src/storage/configCodec.ts` | 理论参数、日程、人工参照持久化与旧配置兼容 |
| `src/ui/main.ts` | 参数、覆盖统计和按需调试 JSON |

本框架是**多峰保护的近全局搜索**，没有严格数学全局最优保证。理论评分和不确定性尚未用真实战报拟合；合成回归也不能证明所有真实阵容上的搜索质量。这里保证全英雄／全理论网格覆盖和每套进入正式 M1，而不是全比例都进行了正式 Monte Carlo。
