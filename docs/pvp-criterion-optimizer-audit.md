> **第二轮审计归档（含第一轮对照）：** 本页的数值、旧正式预算和旧车身枚举域属于此前实现；当前第三轮已取消 per-head 保底与两种车身英雄限制，使用四槽同效果族≤2、5 场全局 probe 晋级与 20/40 置信门槛。当前交付和实测请看 [第三轮报告](pvp-criterion-optimizer-round3.md)。

# Criterion 优化器第二轮结构调整审计

更新日期：2026-10-07。本文描述当前默认搜索流程，历史文档中的“近全局最优”和“5 场后全局小 TopK”不再代表默认实现。

## 1. 修改范围与实现入口

本轮调整 optimizer 的硬性候选条件、车身语义预处理、全局理论剪枝及阶段预算。正式规则仍使用上一轮内核。第二轮修改前基线为 [72 个核心文件 SHA256](../examples/criterion-round2-core-hashes-before.json)，涵盖 BattleEngine、DamageEngine、伤害/HP 公式、回合快照、伤亡、索敌、英雄/兵种技能和 ScenarioRunner。

| 入口 | 作用 |
|---|---|
| `src/pvp/optimizer/heroPools.ts` | 服务器、本人拥有、本次优化范围和优化专武等级分离 |
| `src/pvp/optimizer/criterion/signatures.ts` | 从技能定义和实际启用状态生成数值 signature；不解析技能文本 |
| `criterion/compiler.ts` | 调用已有属性、伤害事件及 HP 计算函数编译系数 |
| `criterion/ordered.ts`、`flow.ts`、`solver.ts` | 有序生命周期积分、攻击流量和连续兵损近似 |
| `criterion/jointPreFilter.ts`、`jointSearch.ts` | 集结 C0–C3 联合预筛、正式分层复验和盆地保护 |
| `criterion/bodyPreprocess.ts` | 单技能和组合语义、可实现替换的支配证明、同乘区边际收益及乐观包络 |
| `criterion/potentialSelection.ts`、`searchTypes.ts` | 全局多通道筛选、配置化规模和搜索空间膨胀提示 |
| `scenarioOptimizer.ts`、`adaptiveSimpleSearch.ts` | Single/333 的 Criterion → Theory → 正式战斗 |
| `criterion/threeQueue.ts`、`queueSearch.ts` | 独立队伍属性、对位矩阵、互补组队和调度近似 |
| `optimizer/profiling.ts`、`ui/optimizerPerformanceView.ts` | 可见阶段墙钟、执行工作量、缓存与 ETA |
| `criterion/bodyAblation.ts`、`scripts/run-body-ablation.ts` | 固定车头/比例/对手，仅比较车身的共享 seed 控制实验 |
| `validationUi/damageMetricAudit.ts` | 读取已有详细结果，拆分 HP 承伤、护盾吸收和溢出 |

默认集结路由启用 Criterion。`criterion.enabled=false` 保留旧路由用于兼容和对照；旧路由没有本轮全部保护能力。Single/333 默认启用相同数值内核。三队列启用数值联合种子生成，后接已有正式坐标搜索。

## 2. 英雄池、专武及合法性

硬约束关系为 `OptimizationHeroPool ⊆ OwnedHeroPool ⊆ ServerHeroRegistry`。旧 `availableHeroIds` 在未提供新字段时仍可作为本人/优化范围兼容输入。

- 本人拥有范围：`ownedHeroIds`。
- 优化范围及专武：`optimizerHeroPool.A/B[heroDefinitionId] = {enabled, weaponLevel}`。
- 当前正式配置专武：`sideA/B.simulationWeaponLevels`，与优化池独立。
- 首次初始化有专武英雄 Lv10；无专武英雄 `null`。实际战斗鲁弗斯 Lv6 不会覆盖优化池 Lv10。
- 全选/全不选只更新 `enabled`，保留手动等级。候选构建把池内等级显式写入候选配置。
- 当前方案 baseline 使用原输入和原专武；其审计来源为 `exactBaseline`。生成候选来源为 `optimizerHeroPool`。
- 车身来自独立 `rallyBodyPoolIds`，缺省为服务器阶段允许的远征一技能车身；不要求本人拥有。
- 优化器保留最多两个不同车身英雄的已有搜索范围，新增同 `primaryEffectFamily` 最多两个：不同英雄的同类效果合并计数。无名×2+诺拉×2合法；同类全军攻击×3/×4非法。默认保留有序槽位组合，可显式开启等价槽位合并。手动正式配置及车身控制实验沿用原规则。
- `effectiveHeroGeneration` 取本次启用优化英雄最高代数，近三代窗口为 `[max(1,effective-2),effective]`。每个生成车头必须至少包含一位窗口内英雄，未满足的车头在比例扫描前淘汰。服务器11、本次池最高8时窗口为6–8；池最高11时为9–11。老英雄和SR仍可参与满足条件的混合车头。
- 精确当前配置作为 `exactBaseline` 独立复验，保留用户实际英雄、专武和属性；它是对照例外，不是违反硬约束的生成推荐候选。已知参考只能在当前英雄池、近三代及车身硬约束均合法时保护。

UI 分开显示本人拥有、优化启用、优化专武等级，以及 Lv10/自定义/无专武计数。Top5 显示车头、车身、比例、正式胜率和场次；展开可查看 CI、实际专武和审计。CI 重叠时提示不能声称显著胜出。

## 3. Criterion 数学模型与边界

### 3.1 有序生命周期积分

\[
J_\pi=\sum_k O_{\pi_k}\left(\sum_{j<k}S_{\pi_j}+\frac23 S_{\pi_k}\right)
\]

括号外没有平方。`O_i ∝ sqrt(n_i)`，`S_i ∝ n_i`。前排不输出、仅盾/射且无跨排时严格得到 `O_R(S_D + 2/3 S_R)`。测试同时验证盾/矛、三兵种闭式和独立数值生命周期积分。

`O` 的系数来自正式模型的单位基础伤害、攻击/穿透、作用范围及伤害修正。`S` 使用每兵 HP 与当前兵数；防御和减伤通过目标侧伤害系数作用，避免在 HP 和入射伤害中重复计算。

**正式行动与索敌口径：** `actionOrder` 和 `targetOrder` 分开维护，当前两者均为盾→矛→射。矛奇袭仅该次攻击临时按射→盾→矛索敌。编译模板读取正式常量，未修改引擎规则；盾→射→矛的闭式测试使用显式优先级 `[0,2,1]`，仅验证该顺序下的数学边界。

### 3.2 攻击流量与连续兵损

\[
a_{ij}=\sum_c\lambda_{ic}p_{icj}(state)m_{icj}(state),\quad
D_{X\to Y}=A_{XY}^T[O_X\odot\sqrt{x_X}]
\]

\[
\frac{dx_Y}{dt}=-H_Y^{-1}D_{X\to Y}
\]

- 主攻击奇袭：正常盾目标 80%、射目标 20%；目标死后按 alive mask 重新索敌。
- 额外攻击：主通道保持 100%，独立后排技能可再增加 `0.4 × coefficient`。矩阵行和允许大于 1。
- 当前目标 extra 通道继承主攻击分流；显式后排 extra 保持独立。
- 双方联立推进到最早死亡事件，重建 alive mask/目标矩阵；阶段内使用两次 predictor-corrector。
- 阶段输出平均值：

\[
\bar f=\frac23\frac{x_0^{3/2}-x_1^{3/2}}{x_0-x_1}
\]

单兵种边界用 `n^(3/2)` 不变量消除预测校正偏差。一般多兵种是连续近似，无正式回合、RNG、取整、溢出处理和 BattleTrace。

输出包含 `predictedWinner`、有符号 margin、估计时间、双方三兵种剩余、生命周期潜力、前排保护、后排暴露、跨目标份额、uncertainty、flags 和 omittedMechanisms。margin 不是胜率。

**数学适用范围：** 二维/三维 regression 验证的是生命周期潜力积分及矩阵内核输出的对应 potential，不能声称一般互相消耗 ODE 的胜者或剩余兵数都严格等价于单方闭式 J。纯单兵种的不变量边界另行验证。跨排和复杂时序下的 J 仅为代理指标。

## 4. 技能近似范围

常驻数值效果转换成 ActiveEffect 后交给正式作用域/乘区函数；概率采用期望并增加 uncertainty，周期/攻击次数采用保守平均并标记 roundSkillApproximation。

复杂机制使用 proxy 或省略，并标记 `hardToStaticize`；例如眩晕、闪避、临时护盾、叠加刷新、nextRound 生命周期、目标绑定 debuff、关联 proc、特殊额外伤害基准。每个候选保留具体省略项目，后续由 DeterministicTheory 和正式引擎处理。

本次测量中实际出现的省略项包括：

- 艾蕾诺拉 `soaring-flame`、洛伊德 `ice-fog-bomb`、鲁弗斯 `armor-breaking-strike` 的生命周期代理；
- 鲁弗斯与米娅的目标绑定减益；
- `shield-lightforged-body` 的关联 proc；
- `marksman-flame-impact` 的复杂额外伤害 contribution。

C1使用预编译的作用域/乘区向量，并按输出和生存份额估计边际贡献；首目标系数和通道份额仍是代理，C2才恢复完整scoped系数及连续索敌流。原六维粗签名仅保留为兼容微基准。概率效果期望不等价于正式RNG相关性。高uncertainty通过独立通道和正式样本保护进入后续，有限预算仍可能漏解。

## 5. 集结联合搜索阶段

所有数量按当前池和约束枚举，未硬编码876或3368。先执行近三代硬约束，再做全局理论筛选；理论阶段不强制每头保留比例，明显弱的车头可整体淘汰。

| 阶段 | 默认工作 | 晋级与保护 |
|---|---|---|
| H0 | 所有可组成车头 | 至少一位近三代英雄；依据启用优化池计算窗口 |
| B0 | 合法槽位/英雄组合的完整原始车身空间 | 主效果同类最多2；单技能支配、概率稳定性支配、组合Pareto；签名一次编译 |
| C0 | 近三代合法车头 × 231 个5%比例；生命周期潜力、短程4回合Theory及允许车身的乐观收益 | 全局保留约1%，最大2000，小池下限24；主潜力75%、不确定/特殊/分歧15%、结构10%，去重补足。无每头配额 |
| C1 | C0留下的HeadRatio × 预处理车身，预编译向量计算边际粗分 | Top16、结构3、不确定2、特殊2、探索1；通常每HeadRatio至多24。低边际只在当前HeadRatio删除 |
| C2 | 对C1选中联合候选运行完整MatrixCriterion | 全局多通道选Theory输入，约32–48k矩阵→3–5k Theory |
| C3 | 完整DeterministicTheory；同车头/车身模板复用 | 最多4000、默认矩阵候选的12.5%、小池下限24；正式池最多1500、默认Theory的37.5%、小池下限16 |
| M1a | 累计10场 | 可删同头弱比例；车头不足20场不被整个删掉 |
| M1b | 累计20场 | 高不确定车头继续保护到40场 |
| M2/M3/M4/M5 | 累计40/50/100/300场 | 20/40保护只在正式随机阶段生效；置信淘汰与预算淘汰分记，保留多个头/车身盆地 |
| 1% 微调 | 在保留联合盆地周围先跑 Theory，再正式复筛 | 默认半径3，每盆地4个候选 |
| Final | 每个 finalist 1000场，共享 seed | baseline 和已知参考保留、统一排序；推荐不会低于同批 baseline |

阈值与配额均在 `CriterionSearchOptions` 中；显式自定义Monte Carlo阶段可覆盖默认。大池默认目标为2000 HeadRatio、24 Body/HeadRatio、4000 Theory和1500初始正式候选；小池按全局比例缩放，避免把几百个近等价条目全部送到引擎。合法已知参考可作为显式保护条目超过软预算，审计单列。生成候选硬条件不因此放宽。

C0的 `potentialScore` 为裸头生命周期对数优势加车身边际乐观包络；独立取各作用域/乘区及额外通道最大值，可能不对应一个可实现四槽组合。它是理论代理上界，不能证明正式BattleEngine胜率上界。不确定/分歧通道在主潜力截止附近救回候选；仍可能漏掉静态近似很差的复杂强交互。

审计同时记录主潜力通道截止值与保留条目的最低分。不同通道和保护参考使两者不相等；整体淘汰表示该头没有比例通过全局理论配额，不保证每个淘汰头都低于最终保留条目的最低分。全局理论淘汰与正式随机阶段20/40场保护分开记录。

### 5.1 车身预处理与边际收益

`BodySkillEffectSignature` 保留英雄、技能、等级、效果家族、目标/兵种作用域、触发、概率、乘区、四属性、三类伤害/减伤、敌方减益、易伤、重定向、额外通道、不确定性和机制标记；四槽聚合为 `BodyComboSignature`。从结构化技能定义读取数值，联合扫描不解析技能文本。

单技能支配要求同目标、作用域、主效果家族及乘区，所有有效维度不差，并不存在控制/刷新/额外攻击等未量化价值。删除还必须证明替换后的原始合法组合实际存在、对应槽位的实际技能等级可实现；固定/必选车身与混合技能等级不能被虚构替换删除。同期望、同语义的概率技能被常驻技能按稳定性严格支配：`40%×50%=20%`。

普通受到伤害降低先算 `expectedReduction=p×r`，再进入分母 `1+expectedReduction`。概率40%减伤50%与常驻20%均对应1.20；不平均最终伤害倍率，不使用`1-r`替代正式减伤口径。

组合Pareto比较完整作用域维度，要求至少一个严格优势，且被删除者没有更低不确定性、更高稳定性或特殊/独立通道补偿。同效果数限制和有证明的支配是全局硬删除；兵种限定技能如盾伤+100%仅按当前HeadRatio收益判断，不能因平均效果低被全局删除。

同组已有增益B、新组合贡献v时，粗分使用 `ΔlogC=log((1+B+v)/(1+B))`，同组先加再算边际。低边际软删除的 `rejectedByLowMarginalStacking` 单位为 **HeadRatio×Body评估条目**，不是被全局删除的不同车身数量。

### 5.2 规模异常提示

保留HeadRatio>5000、预处理车身>1500、Matrix>100000、Theory>15000、初始正式候选>5000时记录 `SEARCH_SPACE_EXPLOSION_WARNING`，在结果审计中展示阶段、实际值及阈值。提示不停止计算，不为凑目标强删非支配车身。

Ledger 按实际规范化配置 + seed 缓存，累计复验只执行缺失样本。Final 混合已有共同 screening prefix 和独立 suffix，独立验证调用数单列；不把全部1000场宣称为全新独立样本。

## 6. 单撞、333、三队列

Single 扫全部合法头与比例的矩阵 Criterion，选择各头代表比例交给完整 Theory，再正式复验。333 固定1:1:1，无车身。两者采用同一内核、实际英雄池及专武来源，预算晋级和 CI racing 都保留车头；所有报告的 Final 候选完成配置的最终场次。

三队列先对每个队伍候选分别计算敌方三队的 matchup，按对位覆盖和结构多样性构建单队池，再组合无重复英雄的三队，用共同 scheduler seeds 做廉价剩余兵模拟，选联合种子交给正式 ThreeQueueRunner。每个队列读取自己的属性、外部 Buff/Debuff、技能等级、兵种等级和混等兵。

Criterion 三队列每次最多5场；败者淘汰，胜者把实际连续近似剩余三兵数传入下一场，不能重置满兵。调度仍为 `uniformAliveRandom / provisional`。遇到未决/平局代理时，用 margin 选临时胜方并增加 uncertainty；正式 Runner 才决定最终胜率。

三队列暂不采用集结完整 M1a–M4 预算，保留原坐标搜索参数。单队池、无重复组队和 scheduler 是额外预筛，不是完整三队全局穷举。

## 7. ETA 与性能计数

可见阶段的 ID、分母和墙钟范围一致。嵌套子任务只影响独占耗时，父阶段显示墙钟包括子任务；同名重复测量累计工作量和耗时。样本不足2项或动态总量不稳定时不显示具体 ETA。

正式单撞/集结 ETA 按实际缺失 config+seed 数；已复用请求不进入执行分母。三队列按缺失完整轨迹数计算 ETA，内部实际小战斗调用独立计数；会提前停止的轨迹阶段不估计固定秒数。

520/876 已运行60秒的 regression 期望约41.08秒剩余，不再把子阶段2.2秒作为该阶段计时。

报告区分 requested/executed/reused、wall/exclusive、吞吐、工作单位、缓存命中、候选池峰值。候选峰值为搜索中记录的候选条目数量，非 V8 堆中对象精确计数；C0/C1/C2 观察当前扫描条目及保留条目，不把全部笛卡尔积工作项当作同时驻留候选。

## 8. 第二轮实际测量结果

测量时间：`2026-10-07T05:10:48.841Z`。证据为 [第二轮完整JSON](../examples/criterion-search-round2-benchmark.json)、[运行日志](../examples/criterion-round2-search-benchmark.log) 和 [第一轮冻结对照](../examples/criterion-search-round1-benchmark.json)。采用与第一轮完全相同的合成输入、seed91和Final1000，运行正式BattleEngine；优化策略及默认阶段预算按本轮更新。单线程，无新增Worker或dev server。

本样本只有7位车头英雄、4位车身英雄，原始12头/88有序车身。它测量搜索规模、结构保留和可重复性能，不能代表约20万HeadRatio的正常大池完整胜率质量，也不是用户89.8%实战配置。测量期间47个optimizer TS文件的SHA256汇总前后相同；[72个正式核心文件边界审计](../examples/criterion-round2-core-boundary-audit.json)全部未变。

### 8.1 全部规模审计字段

| 范围 | 字段 | 实际值 |
|---|---|---|
| Head | `allLegalHeadCount` | 12 |
| Head | `effectiveHeroGeneration` | 11 |
| Head | `recentGenerationWindow` | 9–11 |
| Head | `recentEligibleHeadCount` | 11 |
| Head | `rejectedByRecentGenerationCount` | 1 |
| HeadRatio | `rawHeadRatioCount` | 2,541 |
| HeadRatio | `retainedHeadRatioCount` | 28 |
| HeadRatio | `headsAfterC0` | 4 |
| HeadRatio | `headsFullyEliminatedAtC0` | 7 |
| Body | `rawBodyCombinationCount` | 88 |
| Body | `rejectedBySameEffectFamily` | 52 |
| Body | `rejectedBySkillDominance` | 0 |
| Body | `rejectedByProbabilityDominance` | 0 |
| Body | `rejectedByParetoDominance` | 0 |
| Body × HeadRatio | `rejectedByLowMarginalStacking` | 0 |
| Body | `preprocessedBodyCount` | 36 |
| Joint | `roughJointEvaluations` | 1,008 |
| Joint | `matrixCriterionCandidates` | 672 |
| Joint | `deterministicTheoryCandidates` | 86 |
| Formal | `battleEngineCandidates` | 34 |
| Formal | `battleRunsRequested` | 33,780 |
| Formal | `battleRunsExecuted` | 21,650 |
| Formal | `battleRunsReused` | 12,130 |
| Final | `finalCandidates` | 14 |
| Final | `uniqueFinalHeads` | 3 |
| Final | `uniqueFinalBodies` | 4 |
| Final | `known89StructureReachedFinal` | true |

C0普通预算为`ceil(2541×1%)=26`，另保留两个合法已知57/3/40参考，共28。粗网格计数2541不含额外两个参考比例。4个存活头分别获得25/1/1/1个比例；两个“1”来自参考保护，一个来自多通道筛选，没有每头最低配额。

四位车身英雄的主效果不同，原始88组合中52个违反同家族最多2，留下36个。这一小池没有可证明的技能、概率或Pareto支配，因此对应计数为0；不能把回归测试中的人工构造支配计数当作真实池的删减效果。C1扫描1008项、C2只有672项，C3只有86项，本样本没有C2/C3规模膨胀。`warnings=[]`。

### 8.2 C0整体淘汰的车头

先在H0删除唯一不含近三代的 `hero.s1.nataliya / hero.s3.miya / hero.s1.jinman`；它的比例未被扫描。其余11头均完整扫描231比例，其中以下7头没有任何比例通过全局理论筛选：

| 车头（盾/矛/射） | bestPotentialByHead | 原因 |
|---|---|---|
| `hero.s11.eleonora|hero.s11.lloyd|hero.s1.jinman` | 1.803353 | belowMainPotentialCutoff |
| `hero.s10.gregory|hero.s11.lloyd|hero.s11.rufus` | 1.750540 | belowMainPotentialCutoff |
| `hero.s1.nataliya|hero.s11.lloyd|hero.s11.rufus` | 1.678871 | belowMainPotentialCutoff |
| `hero.s11.eleonora|hero.s11.lloyd|hero.s11.rufus` | 1.611845 | belowMainPotentialCutoff |
| `hero.s10.gregory|hero.s3.miya|hero.s1.jinman` | 1.450160 | belowMainPotentialCutoff |
| `hero.s11.eleonora|hero.s3.miya|hero.s1.jinman` | 1.305312 | belowMainPotentialCutoff |
| `hero.s1.nataliya|hero.s3.miya|hero.s11.rufus` | 1.162093 | belowMainPotentialCutoff |

主潜力通道截止值为 `1.912675`；上述最佳潜力均低于该值。最终保留最低值 `1.029317` 包含保护参考，不能拿它作淘汰判据。已知57/3/40结构进入后续依赖明确参考保护，这不证明盲搜会自然发现所有同类强交互。

### 8.3 阶段耗时

JSON字段单位为毫秒；下表转换为秒。`battleEngineTime`为正式执行阶段墙钟总计，包含这些阶段的初始化/调度。审计结束时间略早于返回结果，外层实际总墙钟为 **167.304秒**。

| 字段 | 实际秒 |
|---|---|
| `headGenerationTime` | 0.018353 |
| `headRatioCriterionTime` | 0.458328 |
| `bodyPreprocessTime` | 0.007549 |
| `bodyRoughScanTime` | 0.003675 |
| `matrixCriterionTime` | 0.122073 |
| `deterministicTheoryTime` | 0.485620 |
| `battleEngineTime` | 166.000466 |
| `totalWallTime` | 167.299861 |

### 8.4 正式执行、复用与最终验证

| 阶段 | 进入候选 | 晋级候选 | 请求 | 新增执行 | 复用 | 墙钟秒 |
|---|---|---|---|---|---|---|
| M1a：比例/联合方案粗筛 | 34 | 34 | 340 | 340 | 0 | 3.428 |
| M1b：车头最小样本复筛 | 34 | 34 | 680 | 340 | 340 | 2.979 |
| M2：累计联合筛选 | 34 | 34 | 1,360 | 680 | 680 | 5.872 |
| M3：累计联合筛选 | 34 | 31 | 1,700 | 340 | 1,360 | 2.870 |
| M4：累计联合筛选 | 31 | 13 | 3,100 | 1,550 | 1,550 | 12.664 |
| M5：累计联合筛选 | 13 | 9 | 3,900 | 2,600 | 1,300 | 20.547 |
| M4：联合盆地正式复筛 | 29 | 14 | 8,700 | 6,000 | 2,700 | 44.056 |
| Final：联合方案统一高场次复验 | 14 | 14 | 14,000 | 9,800 | 4,200 | 73.585 |

34个初始正式条目包含精确当前配置；14个Final条目均完成1000场，3个车头、4个有序车身结构，含当前空车身对照。正式淘汰记录为budget40、confidence0；预算截断未描述为统计显著。1%微调5个盆地、20个生成邻居，正式复筛新增6000场；Final新增9800场。

当前对照为731/1000，Top方案1000/1000，两个合法已知参考亦1000/1000，均为同一合成面板。Final共同screening prefix复用4200次，其余9800次实际执行；不宣称所有Final样本是全新独立验证。

### 8.5 与上一轮相同输入比较

| 指标 | 第一轮 | 第二轮 |
|---|---|---|
| 总墙钟秒 | 215.508 | 167.304 |
| 正式请求 | 46,720 | 33,780 |
| 正式新增执行 | 32,700 | 21,650 |
| 正式复用 | 14,020 | 12,130 |
| Final候选/车头/车身 | 19 / 4 / 5 | 14 / 3 / 4 |
| Matrix完整评分 | 2,380 | 672 |
| 完整Theory | 576 | 86 |

单次测量总墙钟减少 **22.37%**，正式新增执行减少 **33.79%**。21,650次正式执行处于本轮15–25k目标范围。减少量主要来自理论晋级和后续复验条目缩减；不是同候选集的纯Engine加速。此对照只是一对顺序运行的测量，未多次统计机器负载波动，不外推全英雄池固定倍数。

### 8.6 全服务器车身池补充审计

[全池预处理JSON](../examples/criterion-round2-full-body-audit.json)采用S11/S16服务器全部可用车身、Lv5、默认最大两种英雄、有序槽位，仅运行B0，不运行正式战斗。实际完整池并不是需求示例的3368，规模如下：

| 阶段 | 原始组合 | 同家族拒绝 | 概率稳定性拒绝 | 其他技能/Pareto拒绝 | 预处理剩余 | 预处理秒 |
|---|---|---|---|---|---|---|
| s11 | 11,816 | 6,980 | 1,044 | 0 / 0 | 3,792 | 1.416 |
| s16 | 21,687 | 12,759 | 1,452 | 0 / 0 | 7,476 | 2.176 |

两个全池中有5种概率技能被合法、同语义的常驻技能支配：`nataliya.wild-roar`、`moli.snow-command`、`heketuo.survival-instinct`、`alongsuo.stormy-waves`、`linen.lion-song`。同一技能可能有多个可实现的常驻替换；1044/1452是被删除的组合数，不是支配技能种数。常驻穿透与普通减伤提供了本轮概率稳定性规则的实际剪枝贡献。

**全池预处理仍未达到500–1000目标。** S11剩3792、S16剩7476，均触发`SEARCH_SPACE_EXPLOSION_WARNING: B0 preprocessedBody >1500`。没有为了数量强删非支配或特殊机制车身。按2000个HeadRatio估算，B1将分别扫描约758万/1495万项（规模乘法，尚未运行完整全池B1计时），高于建议100–200万；C2每HeadRatio最多24和后续全局Theory/MC上限仍控制昂贵阶段。

全池有序槽位包含大量2+2排列：S11为632种不同英雄对×6种排列=3792，S16为1246×6=7476。S11其中2418个纯常驻数值条目只有119种不同聚合scoped数值向量；其余1374含控制/时序/目标绑定/独立通道。数值完全相等不能冒充“至少一维严格更差”的Pareto证明，所以skill/Pareto计数0不意味着缺少实现。S16有3684个组合含未验证未来代技能，其中2814仅因未验证机制标记进入保守类别。

进一步缩减可复用相同纯数值系数缓存，并在槽位等级、固定条件及特殊机制可互换得到证明后使用既有`equivalentMemberPositions`等价域；不能将不同等级/时序强行视为同一方案。当前默认保留有序搜索。该问题作为剩余规模风险明确报告，不以4英雄小池36个车身的结果宣称全池目标达成。

本次B0在最终测试结束后单独复查，1.416/2.176秒仅为预处理观察值；不包含HeadRatio、联合Theory和正式模拟，不能拼成正常全池总耗时。可用 `npx.cmd tsx scripts/audit-body-preprocessing.ts` 复查原始范围、剪枝数量和无序身份组合数。

### 8.7 第一轮历史微基准（单线程、预热后）

测量时间：`2026-10-06T22:58:51.486Z`，Node `v24.20.0`。延迟单位 μs；heap sampling分配量为估计字节/次。

| 工作 | 次数 | mean μs | p50 μs | p95 μs | 总秒 | 估计分配字节/次 | GC次数/总ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| BodyEffectSignature aggregate | 2,000 | 26.412 | 22.500 | 35.200 | 0.0528 | 25633 | 4/2.67 |
| rough body criterion single | 10,000 | 0.251 | 0.100 | 0.200 | 0.0025 | 49 | 0/0.00 |
| MatrixCriterion single | 3,000 | 48.838 | 45.300 | 61.600 | 0.1465 | 69336 | 13/2.62 |
| 100k MatrixCriterion | 100,000 | 44.882 | 44.151 | 48.816 | 4.4882 | 64387 | 389/65.51 |
| 1M rough body criterion | 1,000,000 | 0.019 | 0.017 | 0.027 | 0.0191 | 33 | 1/0.44 |
| Criterion official coefficient compilation | 300 | 487.329 | 446.100 | 687.000 | 0.1462 | 1088691 | 19/3.82 |
| DeterministicTheory | 1,000 | 353.189 | 335.800 | 480.200 | 0.3532 | 613301 | 37/7.21 |
| BattleEngine fast | 300 | 10206.402 | 10037.100 | 12308.500 | 3.0619 | 12127029 | 111/39.23 |

排名研究：24候选 × 100共同seed，额外2,400场正式战斗；Criterion margin与正式胜率的Spearman约 **0.410**。样本小、部分胜率饱和，不足以证明普遍可靠排名。

1M rough仅测预编译签名上的轻量一阶标量表达式，并变化16种签名/输入；不包含候选枚举、签名生成、系数编译及C1排序。100k矩阵仅测已编译数值solver，C2实际阶段还包括系数模板和候选整理。完整C3包括Theory模板构建，其平均成本高于单独estimateTheoryCandidate微基准。

以上微基准为第一轮历史测量，未重新运行；其中1M rough是旧兼容标量表达式，不能作为第二轮带作用域边际扫描的吞吐数据。当前完整搜索的同输入对照见8.5。

## 9. 11盾反例与车身控制实验

用户观察记录在 `src/pvp/tests/fixtures/known11ShieldCase.ts`：10盾约79.5%，11盾2694/3000=89.8%，共同3矛/11弓、57/3/40、无名×2+诺拉×2。

已完成：两套合法结构会自动作为 protected reference 进入联合正式筛选并保留到 Final；人工参考也可通过 `protectedCandidates` 输入。采用可控胜负executor的 Synthetic regression 验证“Head A 默认较好、Head B 默认较差但 B+Q 最佳”能被发现，且 B+Q 完成1000场、优于同批 baseline。

**真实胜率回归尚未完成：** 附件缺少双方完整属性、兵数、兵种等级、专武、技能等级、Buff/Debuff和对手配置。当前 fixture 保存观察及缺失字段，不伪造 opponent。已请求实际导出配置；合成测量只证明该结构进入 Final，不能确认正式89.8%或对该实际对手的推荐排序。

控制实验命令：

```powershell
npm.cmd run debug:body-ablation -- --input saved-battle.json --trials 3000 --output examples/body-ablation.json
```

输入为页面保存/导出的完整配置。默认比较附件P1–P5，可用 `--plans` 指定方案。固定输入A方车头、比例、实际专武和B方配置，只替换车身；输出每方案胜率/Wilson CI、同 seed 配对胜负和剩余兵、配对差及95%经验 Bernstein 区间。区间含有限样本项，全样本同结果时也不会生成虚假的零宽 CI。手动车身与控制实验允许三种或四种不同来源；调试工具不套用优化候选的同效果族≤2 约束。此前“最多两种车身英雄”的优化限制已在第三轮删除。

## 10. 测试、复查和已知盲区

本轮最终门禁全部通过；第一轮79文件/920为历史基线，本轮为82文件/946测试。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| typecheck | 通过 | [日志](../examples/criterion-round2-typecheck.log) |
| lint | 通过 | [日志](../examples/criterion-round2-lint.log) |
| build | 通过；main产物566.40kB（gzip151.63kB），仍有>500kB提示 | [日志](../examples/criterion-round2-build.log) |
| 全量测试 | **82文件、946测试全部通过；62.67秒**，`--maxWorkers=4` | [日志](../examples/criterion-round2-regression-tests.log) |
| 正式核心边界 | 72文件SHA256全部未变 | [边界审计](../examples/criterion-round2-core-boundary-audit.json) |
| 完整搜索实测 | 同输入167.304秒；Final14条均1000场，已知结构到Final | [第二轮benchmark](../examples/criterion-search-round2-benchmark.json) |
| 大车头池漏斗 | 原始3840头→近三代合法1812头，全418572比例扫描；全局预算24允许整头理论淘汰，实际一回合引擎验证 | `src/pvp/tests/rallyFullHeadCoverage.test.ts` |
| 全车身池审计 | S11/S16实际剩3792/7476，触发软提示，未强凑500–1000 | [全池B0审计](../examples/criterion-round2-full-body-audit.json) |

新增回归覆盖：优化池最高8/11对应近三代硬窗口、旧-only车头不进入C0、无每头比例底线、整个弱头理论淘汰、普通裸分一般但高车身乐观收益可晋级；同主效果×3/×4拒绝及×2合法、不同英雄同家族计数、无名2+诺拉2、概率/常驻同期望稳定性支配、普通减伤分母1.20、固定/必选及混合技能等级可实现替换、组合Pareto、盾伤+100%不因平均贡献低被全局删除、同乘区堆叠边际下降、额外通道乐观包络和规模软提示。原20/40样本保护、共同seed、独立专武池、三队列剩余兵及Top5显示继续保留。

主要盲区与限制：

1. 真实89.8%双方完整配置未提供，真实质量复现待做。已知参考保底与未知强盆地的独立搜索发现是不同证据；本次两个57/3/40参考依赖显式保护。
2. C0/C1代理对复杂技能、同回合关联、生命周期和目标流存在偏差。全局约1%截断、多通道潜力带和有限盆地仍可能漏解，不能宣称全局最优。
3. 乐观包络把不同组最大值独立组合，可能不可实现；它是粗理论排序的乐观边界，没有正式胜率上界证明。只按各兵种输出/生存份额估计边际，不完整刻画动态倒排时间。
4. 概率技能p×v仅用于Criterion期望；正式RNG、取整、溢出、护盾、回合技能和关联触发仍由原引擎计算。稳定性支配只在同语义、合法可替换且无特殊补偿时使用。
5. 近三代是生成候选硬条件，会主动放弃用户优化池中所有旧代车头；精确当前对照继续复验，不作为新生成建议。手动正式配置不受优化域替换。
6. Single/333保留其原每头代表比例架构；新全局HeadRatio/Body漏斗针对集结。三队列保留坐标搜索、有限单队池与scheduler seeds，仍不是三队全空间搜索。
7. 本次相同输入完整对照只有原始12头/88车身，小池最终167.30秒不能证明所有正常全池均3–5分钟，也不能证明缩减后推荐质量没有变化。全池理论规模审计与正式胜率测量应分开解读。
8. C0仍需暂存全比例候选及头模板，峰值内存随原始HeadRatio数量增长；选择后清理未保留条目和模板再做Body搜索。候选条目峰值不是V8精确对象数，历史分配量是统计采样。
9. 当前21,650调用满足目标，但大池M1候选、20/40样本保护、比例微调及Final都可能增加调用；目标不是破坏保护的硬上限。膨胀提示只告知规模，未静默强删非支配组合。
10. 本轮未扩展Worker或拆包，也未新增dev server。浏览器扩展真实交互未测；现有DOM/UI测试和生产构建用于验证展示。构建主chunk大小提示仍需作为独立UI加载优化处理。

复查命令：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --maxWorkers=4
npm.cmd run build
npm.cmd run benchmark:criterion-search
```

脚本会保留完整阶段/配置、对比冻结的第一轮结果、检查当前输入一致、全部Final完成1000、known89结构到达Final、72个核心文件未变以及测量期间optimizer源码稳定。历史微基准可用`npm.cmd run benchmark:criterion`另行重测；本轮完整搜索测量不依赖旧rough微基准吞吐。
