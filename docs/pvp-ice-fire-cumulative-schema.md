# 冰火战歌累计采样、地心 Schema 与 OCR 修正

日期：2026-10-09。覆盖 2026-10-08 21:32 后本轮确认口径。

## 已完成

- 正式三队搜索：默认累计整场序列 `20/50/100/300/1000`，不再逐阶段从零重跑。自定义 `formalStageTrials` 为递增累计值，Final 由 `finalValidationCount` 加入统一序列；UI 从同一解析函数展示实际序列。
- 当前方案从首轮作为受保护 baseline 累计。每个候选按统一 trajectory seed prefix 补齐缺失样本；Worker 的串行/并行完成次序不改变样本身份。
- `TrajectorySampleAccumulator` 保存 wins/losses/failedTrials 和逐整场 seed、结果、子战斗数。失败场继续计入正式胜率分母，不算胜利。
- 默认保留 80/25/10/5；前期保留综合 C1、C2、配对胜率差、不确定性、特殊机制及理论/正式异议，保留预算可配置。Final 仅按共同正式样本胜率排序，平局优先 baseline。
- 历史 `criterionEnabled=false` 兼容搜索也改用统一 seed 前缀与累计缓存，baseline 在搜索前只采首轮预算，最终补齐；不再独立从零复验1000场。
- C0 按 Q1/Q2/Q3 分段，candidateCount 是实际 Head×Ratio 数。输出每队原始比例数、C0保留比例数、Top20（head/ratio/criterionScore）。固定/空车头只固定 Head；显式锁定比例时才停止比例搜索。
- Pair 阶段存在独立流程：hero-disjoint、Q3合法性、覆盖/车头/比例评分、20%结构多样性配额、有界Q3评分frontier。这里的上界是候选评分上界，不是正式胜率的数学上界，不构成全局最优证明。
- 结果页仅在比例搜索、替代比例正式评价和Final替代比例比较均有审计证据时，允许显示“当前方案是本次搜索空间最佳候选”；否则显示“本次未产生有效替代候选”。
- 正式优化和普通批量模拟分别显示整场与子战斗数量，增加3/4/5场结束率、A/B 3:0横扫率、maxRoundHitCount和失败seed/子战斗身份。结束率以成功完成整场为分母，正式胜率仍以请求整场为分母。

## 地心我方独立字段 / 敌方2项

| 模式 | 我方 | 敌方 |
| --- | --- | --- |
| GEM_MINE | PER_TROOP_PAIRED_6 | ALL_TROOPS_PAIRED_2 |
| EQUIPMENT_FORGE | PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9 | ALL_TROOPS_PAIRED_2 |

矿洞我方字段：shieldAttackDefense/shieldPenetrationLife、lancerAttackDefense/lancerPenetrationLife、marksmanAttackDefense/marksmanPenetrationLife。
锻炉我方字段（2026-10-09 后续战报修正）：shieldAttack/shieldDefense/shieldPenetrationLife、lancerAttack/lancerDefense/lancerPenetrationLife、marksmanAttack/marksmanDefense/marksmanPenetrationLife。
敌方字段：sharedAttackDefense/sharedPenetrationLife。

公共 `expandAttributeInput()` 按模式展开完整12项。UI矿洞我方显示三个兵种区，各两项；锻炉每区三项，攻击与防御独立；敌方显示全兵种区两项。存储仍是完整12项。锻炉恢复和正式适配保留每兵种自己的攻击、防御、穿透代表值。旧共享2项或旧锻炉配对6项已丢失的差异不能推算恢复，请按战报重填。

OCR保持本地、整图、bounding box和属性识别。带兵种名称按文字锚点；无兵种名称只对完整且顺序明确的12行属性表按相对行序映射盾/矛/射，缺行或歧义留人工补齐。矿洞只检验同兵种攻防、穿血配对；锻炉 A 方预期9项，只检验同兵种穿血配对，攻击与防御不同不构成冲突，跨兵种也不比较。未恢复兵级/图标/火晶/数量OCR。

真实例子和不同穿血值、人工确认、原子应用均有回归测试。OCR验证使用构造的bbox结果，尚未收到本轮原始截图用于再次跑本地识别器。新增锻炉9项验证见 [后续修正说明](pvp-equipment-forge-schema.md)；下方搜索审计和历史验证结果保留原测试时间的记录。

## 实际搜索审计

测试方案：六队无英雄；双方各队300兵、T10、各属性240%、基线34/33/33。**不是用户出现19次失败的原方案**。

| 字段 | 实际值 |
| --- | --- |
| q1SingleCandidateCount | 231 |
| q2SingleCandidateCount | 231 |
| q3SingleCandidateCount | 231 |
| q1UniqueRatioCount | 231 |
| q2UniqueRatioCount | 231 |
| q3UniqueRatioCount | 231 |
| pairCandidateCount | 2000 |
| tripleCandidateCount | 964 |
| uniqueTripleRatioPatternsAtC1 | 964 |
| uniqueTripleRatioPatternsAtC2 | 200 |
| uniqueTripleRatioPatternsAtM1 | 201 |
| uniqueTripleRatioPatternsAtFinal | 5 |

| 累计场数 | 候选数 | 新增整场 | 复用整场 | baseline新增 |
| --- | --- | --- | --- | --- |
| 20 | 201 | 4020 | 0 | 20 |
| 50 | 80 | 2400 | 1600 | 30 |
| 100 | 25 | 1250 | 1250 | 50 |
| 300 | 10 | 2000 | 1000 | 200 |
| 1000 | 5 | 3500 | 1500 | 700 |

- 统一 seed 集：`threeQueue:991:trajectory-v1`；pairedComparisonEnabled=true。
- 实际新增整场 13170；相同保留候选若各阶段从零重跑需 18520；减少 5350（28.9%）。这只是样本工作量比较，不是与旧版本同条件耗时对照。
- baseline实际采样1000，分阶段复用记账470（20+50+100+300，这个累计账不能解释成470个不同seed）。
- 当前胜率 51.0%，最终候选 99.8%；每个Final候选1000个共同seed。样例耗时 156.90s，部分期间并行执行静态检查，不能用于稳定时间基准。
- Final全部5候选：5000条请求、4991条完成、9条未决。finishIn3/4/5为73.03%/17.81%/9.16%；A3:0=70.65%，B3:0=2.38%，maxRoundHitCount=0。各级全部候选的累计分布也逐级输出。
- 推荐方案单独1000条：finishIn3/4/5为83.9%/13.9%/2.2%，A3:0=83.9%，B3:0=0%，失败0。大量3场结束与99.8%胜率相符。Final整体分布与单候选分布分开保存。
- 核心边界72文件SHA256保持一致。

JSON：[`ice-fire-schema-audit.json`](../examples/ice-fire-schema-audit.json)。内含全部Top20和保留/淘汰证据、逐阶段补样本、每级seedRange及正式/理论分歧。输入：[`ice-fire-search-validation-input.json`](../examples/ice-fire-search-validation-input.json)。

## 发现并修复“未决=超时”的错误展示

原有 `ThreeQueueUnresolvedError` 同时覆盖“达到回合上限”和“双方同回合全灭”，但历史消息及UI都提示提高maxRounds，不能据此判断实际跑了1500回合。本轮保留正式引擎的平局/未决处理规则，只修正UI描述并增加明确失败原因。

新增failureReason=`roundLimit` / `simultaneousElimination` / `unknown`，同时记录failedBattleId、failedBattleSeed和优化候选candidateKey。

针对审计中原有失败seed与候选身份执行185条诊断复验，精确重现每级失败数量，未新增优化器样本或改变排名。**Final的9条未决全部是simultaneousElimination，不是回合超时。** 脚本：[enrich-ice-fire-failure-audit.ts](../scripts/enrich-ice-fire-failure-audit.ts)。

例如本轮测试方案trial seed1243：A1-vs-B1在第48回合双方全部淘汰，分类`SIMULTANEOUS_ELIMINATION_DRAW`。日志：[ice-fire-simultaneous-elimination-replay.json](../examples/ice-fire-simultaneous-elimination-replay.json)。不会把这类未决当作胜利，也没有改写IceFire调度规则。

这证明旧提示存在误分类；**不能据此断言用户原方案19条失败都属于同一原因**。仍需原方案复现用户提供的3010811274等seed。

## 1500回合：诊断已就绪，用户故障仍待复现

项目没有失败seed `3010811274/3010811334/3010811340/3010811341/3010811481` 对应的当时六队方案，已向用户索取导出JSON。seed单独不足以还原战斗；不能声称已经找到具体卡死子战斗或根因，也没有把人工零伤害测试当作该故障复现。

新增独立诊断模块 `src/pvp/diagnostics/iceFireReplay.ts` 和脚本：

```powershell
node scripts/run-tsx.mjs scripts/replay-ice-fire.ts <真实失败方案.json> 3010811274
```

省略seed参数会回放五个已知seed。输出 `examples/ice-fire-failure-replay.json`，每场小战斗保留battleId/battleSeed、末尾20回合双方兵数/HP/临时盾/aliveMask、raw/rounded/actualHPDelta、攻击目标/事件数、stun/skip决定、技能冷却及临时runtime、每回合HP/兵量差。

30回合HP及兵数无变化会记录 `NO_PROGRESS_STALEMATE`，不中断战斗，不判胜负。末尾仍停滞时区分零取整伤害、有事件无HP进展、无攻击事件需要索敌/跳过行动检查；空侧未终止单独分类。临时runtime重建输出initialRuntime和runtimeReset用于排查跨小战斗污染。

回归验证生产场景运行器每场传入新scenario（仅剩兵更新）并新建正式状态；临时盾、待结算事件及回合数重置。**这证明接口/实现，未完成用户失败seed下的证明。**

本轮未改N0、正式Damage/HP、行动/索敌、奇袭、rounding、overflow、英雄技能与IceFire cursor；没有提高1500上限。


## 验证结果

- typecheck、lint、build通过；build保留原有大chunk提示。
- 最新全量：1198/1198通过，失败0；使用 `--maxWorkers=2`。初轮高并发三项耗时测试超时，单独重跑均通过，随后降低并发的全量通过。
- 最新定向：35/35通过，覆盖累计补样本、Schema、历史兼容搜索和玩法调度。
- 核心72文件再次核对无变更：[`ice-fire-schema-core-boundary-audit.json`](../examples/ice-fire-schema-core-boundary-audit.json)。
- 测试方案用已知seed 3010811274跑出5场已决子战斗（44/43/37/20/6回合），实际尾部日志：[`ice-fire-synthetic-replay.json`](../examples/ice-fire-synthetic-replay.json)。这是诊断链路验证，明确不是原1500回合故障复现。
- 验证摘要：[`ice-fire-schema-validation-summary.json`](../examples/ice-fire-schema-validation-summary.json)。没有新启动dev server；没有做浏览器现场视觉验收。
