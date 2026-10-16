# R0 Ratio Prior：本地实验与验收

> 此文记录旧 R0 实验，保留作历史对照。当前 `useSimpleRatioPrior=true` 已改为严格 J 全局 Top10000 新流水线，见 [新验收报告](pvp-joint-pipeline-review.md)。

日期：2026-10-14。版本仍为 v0.2.0-beta。本轮只在本地修改，没有推送、发布或修改 Pages 工作流。

`useSimpleRatioPrior` 默认 **false**。第一阶段只为集结 Criterion 搜索分配 C0/C1 比例预算；C2、C3、Formal racing、1% refinement 和 Final 保留。10 组 A/B 的最终推荐与胜率一致，但总耗时中位数仅约 1.026 倍改善，尚不满足“明显提速后再默认启用”的条件。

## 接入位置与配置

```text
H0 合法车头
B0 合法车身与 BodyEffectSignature
R0 全部 Head × Body → S/O → 全局峰与区域 → 有界联合候选池
C0 比例建议、旧网格探索、当前/历史参考比例
C1 原有车身边际评分 + 联合峰值车身保留通道
C2 原 Target-Flow Criterion
C3 原 DeterministicTheory
M1 原正式引擎 racing
原 1% refinement
原 Final（默认 1000 场）
```

入口为 `criterion/jointPreFilter.ts` 中的 `createJointRallyPreFilter`。同步调用仍可使用原 `preFilterJointRallyCandidates`；异步调用通过原优化 workflow 派发 R0 数值任务。开关关闭时不预计算 R0、不派发 R0 Worker、不新增候选或区域，保留旧流程的候选顺序与审计口径。Criterion 被关闭时不启用 R0。

本地打开 `?mode=advanced&dev=1`，展开开发工具 → **Ratio Prior Debug**，勾选实验开关后运行集结配队。完成后可选择任意合法 Head/Body，查看 S/O、最佳比例、Jmax、R99/R98、风险原因及实际进入 C2 的比例集合。该入口和性能明细不显示在普通/高级玩家界面。配置保存与分享会保留开关；旧配置缺少该字段时恢复为 false。

## S/O 的计算

不读取或解析技能展示文本。复用 `prepareCriterionHead`、`BodyEffectSignature`、现有概率/周期/proc family 数值近似，以及正式属性、伤害分组函数生成的单位普攻/技能伤害矩阵。

预计算的数据包括：

- HeadSimpleSignature：单位 HP、双方 3×3 普攻/技能伤害矩阵、额外攻击通道、各 body term 的同组基准分母、风险码。
- BodySimpleSignature：稀疏的整数 term ID、数值、兵种/伤害类别路由、额外攻击系数、结构 ID 与风险码。

它们存放在 `SimpleSignatureTable` 的 typed arrays 中。每个组合只组合数值，不再查询英雄/专武定义或构造 effect list。

设对手兵数为 (n_j)，单位 HP 为 (h_j)。固定投影权重为：

```text
a_j = sqrt(n_j) / Σ sqrt(n_j)       对手输出来源权重
t_j = n_j * h_j / Σ(n_j * h_j)     对手目标权重
```

`D^N`、`D^K` 分别是现有 Criterion 编译器产生的单位普攻和技能伤害。它们已包含攻击、穿透、受击目标防御、现有增伤/易伤/减防/减伤乘区。`c^N` 为普攻及 additionalAttack 系数，`c^K` 为技能/extraDamage 的期望系数。`b^N/b^K` 为车身增加的对应通道。

每个 scoped cell 先按原乘区叠加规则计算车身相对倍率，再汇总：

```text
incoming_i = Σ_j a_j * (
  enemyD^N_ji * enemyC^N_j / survivalFactor^N_ij
  + enemyD^K_ji * enemyC^K_j / survivalFactor^K_ij
)

S_i = headHP_i / max(1e-12, incoming_i)

O_i = Σ_j t_j * (
  ownD^N_ij * outputFactor^N_ij * (ownC^N_i + b^N_i)
  + ownD^K_ij * outputFactor^K_ij * (ownC^K_i + b^K_i)
)
```

生命修正进入 survivalFactor，等价于改变单位 HP；防御和减伤改变承伤分母。敌方减攻/减穿改变相应输出来源的 incoming cell。攻击、穿透、增伤、易伤与减防进入 output cell。先解决各来源/目标的乘区，再做权重汇总，没有按不同来源的 Buff 创造新的乘法规则。

同组边际倍率沿用 `(1 + headSum + bodySum) / (1 + headSum)`；不同组继续相乘。普通、普攻、技能 received reduction 按既有伤害规则共享当前伤害类别的分母。directCancellation 沿用 `1 - sum` 的语义。专武外部属性组使用当前战报上下文的 Buff 基准；最终战报/预测模式仍由原适配器决定，不在 R0 重算 BattleConfig。

例如诺拉×2给盾/射 `receivedDamageReduction +0.30`；无名×2给盾 `receivedNormalAttackReduction +0.50` 与 `receivedSkillDamageReduction +0.60`。无其他同区值时，盾的对应分母为 1.80 / 1.90，射为 1.30，矛保持原值。相关静态 S/O 已与正式 scoped 系数编译结果逐项核对。

S/O 是固定对手权重下的静态先验，J 不是胜率。存活顺序、索敌变化、伤亡反馈仍由后续 Criterion/Theory/正式引擎计算。

## 可静态化与风险标记

| 机制 | R0 处理 |
| --- | --- |
| 现有数值化的攻击、穿透、防御、生命、普通/普攻/技能增减伤、减攻/减防、易伤 | 复用 scope/group 数值；如诺拉多兵种作战、无名避风扑雨 |
| 当前目标、parentBaseDamage 的额外伤害与 additionalAttack | 复用已编译的独立通道系数 |
| 概率触发、周期/attackCountTrigger | 复用现有 signature 的 probability/interval 与 proc family 期望；输出 uncertainty |
| nextRound、持续窗口、refresh/stack、冷却、目标绑定 | hardToStaticize，扩大范围；无法可靠映射的机制可以 bypass |
| 护盾、眩晕、闪避、改变索敌、crossTarget/all-target extraDamage、marker/token、linked proc、未确认规则 | 保留风险原因；强控制/相关性/索敌机制允许绕过比例收缩 |
| incomingSourceTroop 条件分母、对手生命降低改变固定目标权重 | 当前压缩签名未完整覆盖其交互，明确标记并绕过比例收缩 |

风险同时考虑对手机制。被禁用技能不参与 Head 风险检查。无法静态化的效果沿用 signature 的 omittedMechanisms，不为它们虚构完整收益。R0 不把低先验分解释成阵容非法。

## 求峰与区域

目标严格使用：

```text
J(x) = (Σ S_i x_i) * (Σ O_i sqrt(x_i))
x_i >= 0, Σ x_i = 1
```

对非负系数、正目标值，`log J` 为凹函数；全部 O 正时有唯一内点峰，不会出现需要 231 点扫描才能发现的隐藏局部峰。

KKT 条件把三维比例求峰化为单个标量：

```text
x_i ∝ (O_i / (z - S_i))²
3 * Σ S_i x_i = 2z
```

标准化后在 `z ∈ (1, 1.5]` 内用带区间保护的 Newton 求根，最多 28 次迭代。加上初始化/最终目标求值，至多 30 次等价评估。相同 S 使用解析的 `O²` 分配；零输出的纯生存兵种使用边界 KKT 分支；全零输出/生存也有合法结果。多起点结果与独立密网格参考已比较。连续算法只在最终 J 求值需要 sqrt，无固定 231 点 sqrt 缓存。

`localPeaks` 返回该模型的全局峰。R99/R98/R95 保存系数、峰值与真实 J 阈值；对每个坐标固定取值后优化其余两个坐标，再二分求 min/max。超水平集合是单个连通凸 basin，不把坐标展示包络当成矩形搜索区域。`ratioInRegion` 实际检查 J；扩展时允许向峰值移动限定百分点后进入超水平集。

| 风险 | 比例建议 |
| --- | --- |
| 稳定 | R99 + 5 个百分点 |
| 概率/周期近似 | R98 + 7 个百分点 |
| hardToStaticize | R95 + 10 个百分点 |
| bypass | 原完整比例网格 |

R0 全空间只求峰；成本较高的坐标区域仅为有界保留候选生成，Developer 的任意组合 R99/R98 按需计算。

## 联合保护与 C0/C1 行为

R0 逐 Head 扫描全部 Body。每个 Head 的有界池包含最高联合分、uncertainty、special、不同峰值结构、body structure diversity、固定种子探索以及当前/历史参考。重复身份合并，只保存整数 Head/Body ID 与少量数字。不会长期保存数百万个完整 JS 结果对象。

C0 优先使用保留联合候选的区域并集，另保留每 29 个旧网格点中的一个确定性探索点、整数百分点峰值、当前比例与历史参考。任何该 Head 的 bypass 建议都恢复完整网格。保留的联合峰值获得 C0 预算通道，避免先用 Head 单独分数删除车头再考虑 Body。

C1 继续评估原全部合法车身，不按 R0 低分删除 Body。联合峰值比例对应的车身加入 required 保留集合，然后继续原有边际评分、多通道选择、C2/C3 与正式筛选。R0 的区域是预算建议，后续真实候选预算筛选仍存在。

历史 11盾 / 3矛 / 11射、57/3/40、诺拉×2＋无名×2 保留原精确参考通道。该身份已在极小 C0/C3/Formal 配额回归中进入最终真实 1000 场；10 组 A/B 中的两组相关场景也进入 Final。历史 89.8% 观察缺少完整双方战报配置，本轮没有宣称复现该胜率。

## Worker 与性能

复用现有 optimizer candidate Worker 池，按连续 Head range 分为最多 4 片，每片扫描全部 Body。输入为数值 typed arrays，输出为有界联合候选，不传输完整英雄定义。按 Head/Body ID 合并；分片数量与完成顺序不会改变结果。Worker 不可用时使用同一个串行扫描函数。

本机 AMD Ryzen 7 5800H，Node v24.20.0，4 Workers；记录于 2026-10-14：

| 空间 | 串行扫描 | 4 Worker 扫描（含启动与通信） | 含签名与区域的串行 R0 | 含签名与区域的 Worker R0 |
| --- | ---: | ---: | ---: | ---: |
| 876×3368 = 2,950,368 | 1.294 s | 0.937 s | 2.678 s | 2.321 s |
| 当前实际 876×19488 = 17,071,488 | 8.594 s | 2.712 s | 约 9.978 s | 约 4.096 s |

平均每组合约 **6.70 次等价 J 评估**。295 万组合使用约 1.63 MB 数值签名，只保留 3,905 个联合候选；实际完整空间保留 3,920 个。两个空间的串行/Worker 候选完全一致。

当前 B0 池为 19,488 个，不将它报告成 3,368。295 万测试从当前合法 B0 中确定性等距取 3,368 个真实签名；另完整遍历当前 1,707 万组合。以上满池包含矛兵奇袭/目标重定向等机制，因此所有组合保守 bypass；区域生成成本很低，平均/p95 比例宽度为 100 个百分点。稳定 R99 的缩减行为另有专门集成测试，不能把该特殊机制 benchmark 的时间当作所有稳定区域生成时间。

## 10 组 A/B

所有场景用真实 BattleEngine 和最终 1000 场，采用相同 seeds。为可重复的小规模诊断，C0/C3/Formal 配额受限、Theory 为 8 回合；不是完整英雄池的发布质量评估。完整最终候选 JSON 保存在本地生成的 `artifacts/ratio-prior/ab-results.json`。

| 场景 | A/B 耗时 s | C2 A/B | Theory A/B | Formal A/B | 最终胜率 A/B |
| --- | ---: | ---: | ---: | ---: | ---: |
| 已知 11/Miya/11 身份，合成属性 | 25.9 / 24.6 | 17 / 17 | 13 / 13 | 7 / 7 | 100% / 100% |
| 同身份，不等对手属性 | 29.4 / 28.7 | 17 / 17 | 12 / 13 | 7 / 7 | 100% / 100% |
| S1/S11 联合车头，空车身 | 14.0 / 13.4 | 16 / 22 | 12 / 12 | 7 / 7 | 100% / 100% |
| S11 防守视角 | 10.3 / 9.9 | 16 / 22 | 12 / 12 | 7 / 7 | 100% / 100% |
| 固定 S11 车头 | 72.3 / 71.5 | 231 / 232 | 231 / 232 | 231 / 232 | 57.9% / 57.9% |
| 固定旧车头 | 20.1 / 20.0 | 231 / 232 | 231 / 232 | 231 / 232 | 0% / 0% |
| 最终战报，固定当前 | 55.9 / 54.9 | 231 / 233 | 231 / 233 | 232 / 233 | 12.8% / 12.8% |
| 空车头合法性 | 9.9 / 10.3 | 231 / 232 | 231 / 232 | 231 / 232 | 0% / 0% |
| 对手高盾比例 | 14.3 / 13.4 | 16 / 22 | 12 / 12 | 7 / 7 | 100% / 100% |
| 低专武固定配置 | 19.7 / 19.8 | 231 / 232 | 231 / 232 | 231 / 232 | 0% / 0% |

10/10 最终推荐身份一致；最终胜率无下降；两组包含已知强身份的测试均保留至 Final。中位 A/B 耗时比约 1.026，不能证明明显收益；B 的 C2 数量部分增加，原因是 bypass 保持旧网格，同时补充联合峰值。默认保持 false。

## 验证与复现

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run benchmark:ratio-prior
npm run benchmark:ratio-prior-ab
```

新增 16 项测试包含已知数值最优、双兵种 50%/54.545% 的前排无输出简化极限、不同起点、独立密网格比较、窄峰区域、零/近零输出、合法比例、正式 scoped S/O 对照、分片一致性、关闭开关恢复、稳定 C0/C2 区域接入、特殊/条件 scope 保护、固定 seed 的真实 1000 场一致性和历史强阵容 Final 保护。

全量测试：119 个测试文件、1395 项测试全部通过；typecheck、lint、生产 build 通过。构建保留已有的大 bundle 提示，没有构建错误。

生产 `dist-ui` 子路径中已验证真实 4 Worker 的 R0/正式优化：最终 1000 场及完整最终结果与串行一致，Developer 的 Head/Body 选择与开关可用，普通/高级界面没有 R0 内部入口，无浏览器错误或资源请求失败。

165 个 `src/pvp` 非 optimizer、非测试核心文件 SHA-256 与修改前一致；原固定 seed=721 的 1000 场 batch 完整 JSON 一致。BattleEngine、伤害公式、RNG、英雄/兵种技能与 resolver、BattleConfig 未修改。`jointSearch.ts` 只将预筛入口变成 `yield*`，正式 racing/refinement/Final 的代码没有改动。

本地产物在 `artifacts/ratio-prior/`，受 `.gitignore` 排除；测试截图与临时输出不进入源码提交。

## 本轮源码文件

- `src/pvp/optimizer/ratioPrior/{coefficients,peak,scan,recommendations}.ts`
- `src/pvp/optimizer/criterion/{jointPreFilter,jointSearch,searchTypes}.ts`
- `src/pvp/optimizer/{execution,index,profiling,types}.ts`
- `src/storage/configCodec.ts`
- `src/ui/{main,optimizerWorkerPool,optimizerPerformanceView,ratioPriorDebugView}.ts`
- `src/pvp/tests/ratioPrior.test.ts`
- `scripts/benchmark-ratio-prior.ts`、`scripts/benchmark-ratio-prior-ab.ts`、`scripts/ratio-prior-node-worker.mjs`
- `package.json`、`README.md`、本文档。

此前未提交的玩家 UI 改动继续保留。本轮新增的界面工作限于 Developer 的 R0 入口与统计。
