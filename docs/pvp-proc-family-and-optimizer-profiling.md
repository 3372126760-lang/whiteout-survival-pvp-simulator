# 米娅同机制 family、历史战报英雄 UI 与优化器计时验收报告

更新：2026-10-07。范围：明确授权的米娅同 family 效果去重、重复 UI 删除、性能观测；不调整伤害/HP公式、其他技能、搜索晋级与排名规则。

## A. 米娅：独立概率、唯一目标效果

- 声明：`MIA_DOOM_ENTANGLEMENT.procEffectFamilyId = "miya-doom-entanglement-family"`。
- 两个来源仍是两个 HeroState 与两个 SkillRuntime；`B-body-1`、`B-body-2` 分别调用原有 RNG、更新原有 triggerCount。没有跳过第二个来源的判定。
- 只改变目标效果 identity：按来源阵营 + family + 目标阵营/兵种 + 效果种类/乘区/数值共享标识。原有目标绑定、nextRound、duration=1、replace/刷新语义保持不变。相同目标只维持一份 +0.50；不同目标互不影响。
- 合并概率是审核统计值，不额外掷骰：`P(any) = 1 - Π(1 - p_i)`。一/二/三/四个50%来源分别为50%/75%/87.5%/93.75%。
- 注册表检查显式 family 的规则状态、触发时机、recipient/scope、数值、duration、activation 与 refreshMode；不使用 UI 文本或 vulnerability group 自动判别 family。
- Theory评分器的私有静态估算副本移除 procEffectFamilyId，再执行原有概率等价估算；正式注册技能与运行状态保留该字段。此处只处理元数据兼容，不改变 TheoryScore 数值规则。
- 未标记 family 的 +25% 等其他易伤保持已有计算。已确认 family 的 +50% 与独立 +25% 在现有同组规则下为 +75%，不会把两份米娅加到 +100%。

### 当前数据库的身份差异

目前只对确认的米娅一技能显式加入上述 family。鲁弗斯当前一技能为全军攻击 +25%；二技能为射手成功普攻后的额外伤害60%及下一回合易伤25%，不具备米娅的50%判定/50%易伤描述和同一触发规则。因此未把鲁弗斯25%易伤合并，也未改其原技能数值。弗洛拉当前仍为 S13 推测数据且有 `mainAttackAttempt` 声明；模板复用不等于规则确认，也不会自动继承 family。新增确认的同机制英雄，需要显式填写该字段并通过注册表校验。

### 固定 seed 的可检查 Trace

合成回归场景，seed=93；TEST兵种常数、极高生命使目标稳定；不是实际游戏战报。两个米娅均成功：

| 来源 | procRoll | procResult |
|---|---:|---|
| B-body-1 | 0.2514261936 | true |
| B-body-2 | 0.4452923508 | true |

`familyCombinedProbability=0.75`、`familyProcResult=true`、`generatedEffectValue=0.50`。第二回合正式 damageEvent 的 vulnerability `summedValue=0.50`、`multiplier=1.50`，只有一个 effectInstanceId。

逐来源 HeroSkillTrace 保留；RoundBattleTrace 新增 procEffectFamilies，按单次主攻击 parentEventId 分组，不跨三个兵种的攻击合并概率。高级伤害事件展示 family JSON；文本 BattleTrace 也输出上述审计字段。

- [JSON Trace](../examples/miya-proc-family-trace.json)
- [文本 Trace](../examples/miya-proc-family-trace.txt)
- 重现：`node scripts/run-tsx.mjs scripts/generate-proc-family-trace.ts`。

## B. 历史战报英雄 UI

原“共享战报英雄阵容”与“战报英雄阵容”都绑定同一份 reportHeroByTroop。已删除重复入口，A/B各保留一个“历史战报英雄”区域，每方三名英雄及各自历史专武等级。说明：用于反推历史战报中的英雄与专武属性贡献，不代表当前模拟阵容。

“当前模拟英雄”单独编辑现有 leaderHeroIds（即 simulation hero state）及 simulationWeaponLevels。保留现有持久化字段名，没有做不必要的格式迁移。历史入口仅更新 reportHeroByTroop/reportWeaponLevels；模拟入口仅更新 leaderHeroIds/simulationWeaponLevels。

属性链没有改动：

```text
heroDelta = simulationHeroContribution - reportHeroContribution
weaponDelta = simulationWeaponContribution - reportWeaponContribution
formationDelta = heroDelta + weaponDelta
```

UI回归实际触发选择事件并保存/恢复，验证双向修改不会串写另一套阵容和专武。

## C. 优化器性能观测

- 计时位于候选生成、英雄目录过滤、稀有度/代数规则、严格支配检测、Theory评分、峰提取、代表选择和正式评估阶段的内部边界。
- 不存在的2%比例阶段不生成记录；当前流程为5%邻域扩张与1%窗口复筛。单撞/333/三队列及集结多波均接入已有真实流程。
- 单调时钟 `performance.now()`；startedAt/finishedAt 是相对 session 开始的毫秒偏移。嵌套同步阶段暂停父阶段计时，避免百分比双算；elapsedMs因此可能小于finishedAt-startedAt。
- Worker正式执行每场的计数和耗时回传给协调器。三队列记录每次实际队列对战，多波记录实际发生的波次；不把一条三队/多波轨迹误算成一场 BattleEngine。
- avgBattleMs = 各Worker实际战斗执行时长之和 / 实际调用数，含每场状态创建/战斗执行；独立模板准备、消息调度由阶段墙钟耗时覆盖。并行时该执行时长之和可能超过墙钟阶段耗时。
- 不注入seed/RNG，不调整候选、预算、晋级、搜索半径和排序。Node API 默认可不启用观测；浏览器 optimizerWorker 自动启用。
- 进度事件约250ms节流，界面350ms刷新当前阶段耗时/累计耗时/阶段ETA。更新标签与折叠区内容，不每场重绘整页。completed=0时ETA待估算；只估计当前阶段，不猜测总剩余时间。
- 完成后保留“阶段耗时”和复制JSON按钮。异常把当前阶段标记error；已有三队列取消保留上次回传统计并标记cancelled。取消/异常统计仅含已回传批次，不虚构未回传的调用数。
- 阶段completed/total是实际阶段工作项；candidateCount在扫描/过滤阶段指处理的记录数，在正式评估阶段指候选数。cacheHitCount涵盖配置模板命中与已有候选评估命中。

### 完整 benchmark

六英雄等面板合成回归、seed=91、固定空车身、全7个合法车头×231个5%比例点、原M1-M4和盆地流程、Final每候选1000场。最终最高胜率94.3%。这是正式引擎测量，不是实际游戏战报拟合。

- 开启 profiling：291.495 s；报告内部累计 291.494 s。
- 关闭 profiling：298.239 s。
- 两次全部结果（排除新增计时报告）、候选排序、样本统计、搜索诊断完全一致：`true`。
- 正式 BattleEngine 调用数：38,080；平均每场 7.594 ms。
- 顺序运行期间存在其他验证工作和机器负载变化；墙钟差不能据此宣称提速。此对照用于验证观测不改变结果。

| 实际阶段 | 耗时(s) | 总时间占比 | 处理项/候选 | BattleEngine调用数 | avgBattleMs | 缓存命中 |
|---|---:|---:|---:|---:|---:|---:|
| 候选生成 | 0.004152 | 0.001% | 1 | 0 | — | 18 |
| 英雄目录合法性过滤 | 0.000877 | 0.000% | 1736 | 0 | — | 0 |
| 英雄合法性 / 稀有度 / 代数过滤 | 0.000047 | 0.000% | 30 | 0 | — | 0 |
| 严格支配检测 | 0.009712 | 0.003% | 30 | 0 | — | 0 |
| Theory阵容模板与扫描调度 | 0.039883 | 0.014% | 7 | 0 | — | 0 |
| 5% Theory评分扫描 | 1.772261 | 0.608% | 1617 | 0 | — | 0 |
| 局部峰提取 | 0.000617 | 0.000% | 1617 | 0 | — | 0 |
| 不确定性 / 多样性 / 探索代表选择 | 0.002849 | 0.001% | 1617 | 0 | — | 0 |
| M1 · 全车头正式验证 | 2.160780 | 0.741% | 44 | 220 | 9.674 | 0 |
| M2 · 正式逐级筛选 | 7.269433 | 2.494% | 44 | 880 | 8.245 | 44 |
| Basin · 5%扩张第1轮 | 10.154695 | 3.484% | 26 | 1300 | 7.798 | 9 |
| Basin · 5%扩张第2轮 | 2.686908 | 0.922% | 6 | 300 | 8.941 | 1 |
| Basin · 5%扩张第3轮 | 1.580067 | 0.542% | 3 | 150 | 10.517 | 0 |
| Basin · 1%窗口共同种子复筛 | 78.945796 | 27.083% | 523 | 9580 | 8.214 | 69 |
| M3 · 正式逐级筛选 | 16.790055 | 5.760% | 55 | 2450 | 6.840 | 6 |
| M4 · 正式逐级筛选 | 70.234164 | 24.095% | 51 | 10200 | 6.881 | 45 |
| Final · 统一高场次复验 | 89.166541 | 30.589% | 12 | 12000 | 7.427 | 12 |
| Final · 当前方案独立复验 | 10.659989 | 3.657% | 1 | 1000 | 10.650 | 0 |

阶段之外的组装/调度：15.634 ms。

最耗时前三阶段：

1. Final · 统一高场次复验：89.167 s（30.59%），12,000场。
2. Basin · 1%窗口共同种子复筛：78.946 s（27.08%），9,580场。
3. M4 · 正式逐级筛选：70.234 s（24.09%），10,200场。

完整数据：

- [Search Performance Report JSON](../examples/optimizer-performance-report.json)
- [启用/关闭计时的完整对照](../examples/optimizer-profiling-benchmark.json)
- 重现：`npm run benchmark:optimizer-profiling`。

## 文件与职责

| 文件 | 改动 |
|---|---|
| src/pvp/heroSkills/procEffectFamily.ts | 明确 family 注册与兼容性校验 |
| src/pvp/heroSkills/definitions/s3Heroes.ts | 米娅一技能 family 声明 |
| src/pvp/heroSkills/resolveHeroSkills.ts | 目标效果 identity 去重及逐来源 Trace 字段 |
| src/pvp/logging/procEffectFamilies.ts、battleTrace.ts | 每次主攻击的 family 概率审计与文本输出 |
| src/pvp/optimizer/profiling.ts | 单调计时、排除嵌套重复、报告、取消/异常状态 |
| src/pvp/optimizer/execution.ts、fastTemplates.ts | Worker场次/时长回传，异常送回workflow |
| optimizer各workflow、candidateGenerator、heroSearchPolicy、theoryPreFilter | 真实阶段边界计时，不改变结果 |
| src/pvp/optimizer/theory/templateBuilder.ts | 私有估算副本剥离概率 family 标记，避免正式规则校验误用于静态近似 |
| src/ui/optimizerPerformanceView.ts、optimizerWorker.ts、main.ts、styles.css | 展示耗时/ETA/JSON，保留历史记录，删除重复英雄入口 |

## 规则边界与浏览器验证

与上轮已验证的70个边界文件SHA-256比较：仅5个已有heroSkills文件变更，均用于本轮明确授权的family规则或导出/校验。BattleEngine、DamageEngine、伤害/HP公式、回合流程、heroStatCorrection、validationUi和storage均未改。新增日志与优化观测文件另列于上表。

- [边界校验](../examples/proc-family-profiling-boundary-check.json)
- 复用现有 http://127.0.0.1:5173 服务，未启动额外实例；最终身份接口确认PID=47396，Vite监控/HMR记录包含本轮修改。该身份检查不等于浏览器端HMR视觉验收。
- Edge扩展连接仍报 `nodeRepl.fetch request failed`，未声称完成真实浏览器视觉验收。界面事件、保存隔离、进度更新及异常后的报告保留/复制由回归测试覆盖。

## 最终检查

| 命令 | 结果 |
|---|---|
| npm run typecheck | 通过 |
| npm run lint | 通过 |
| npm run build | 通过；仍有主UI包超过500kB的体积警告 |
| npm test -- --maxWorkers=2 | 75个文件、886项测试全部通过，95.53s |

第一次将build/lint与全量测试同时执行，两个现有测试触及默认5000ms超时，其余884项通过。随后单独运行全套测试、限制两个Worker，全部886项通过；没有修改断言或放宽测试超时。

关键覆盖：1/2/3/4个family来源；全失败/部分成功/全成功；refresh不叠层；不同易伤不误合并；三兵种RNG顺序；fixed seed；历史/模拟英雄和专武实际事件与保存隔离；阶段计时/ETA/节流；完整结果计时开关等价；真实三队列/多波调用计数；取消与异常报告保留、界面复制JSON；Theory私有副本不改变正式米娅定义。
