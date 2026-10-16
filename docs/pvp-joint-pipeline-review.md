# Head × Body × Ratio 本地验收

> 历史版本：本文件记录上一轮流水线与 S11 实测，保留原始数据。当前 S12 canonical Body、Criterion 1% 和两阶段 Formal Ratio 规则及实测见 [本轮验收报告](pvp-canonical-body-gen12-review.md)。下文旧预算与旧性能结论不代表当前版本。

2026-10-15，v0.2.0-beta。未执行 push、tag、Pages deploy。

`useSimpleRatioPrior=false` 保留旧 C0 → C1 → C2 → C3；`true` 进入本次新流水线。遵守此前性能门槛，本地开发默认继续 false：当前同输入测量尚未提速，尚无跨对局质量证据。高级模式 `?mode=advanced&dev=1` → Developer → J Debug 勾选开关即可验收。新流程的内部默认预算为 Criterion 2000、Theory 500、正式 20/50/100/300、比例复核 100、Final 至少 1000；不是旧 R0 的配兵预算分配。

## 实现与 28 项结果

1. 自动 Head 仅 SSR，按兵种位置、阶段、Owned/Optimization pool、专武配置及原合法组合规则生成；手动 R/SR、固定/空 Head 保留。
2. n 取本次 enabled owned eligible optimization heroes 的最高 S 代，不取 serverGeneration。
3. R/SR 在所有代数都从自动候选和自动选择 UI 排除；n≥3 至少一名 n/n−1/n−2；n=1/2 无额外近期限制。
4. Body 对 typed effect 建 canonical key，规范字段顺序、默认 scope、旧 attribute operation 别名；同 canonical effect 总计最多两个，跨英雄 ID 累计。完整多效果技能的每个效果都参与限制。手工四重 Body 不受该自动策略限制；固定手工 Body 作为常量。
5. 在枚举前，完整效果、group、scope、context、时序可比的线性概率技能满足 p*r≤同族稳定值即移除；p*r 更高、不同属性/作用域或有额外效果的不移除。不因第一个效果而误删多效果技能。
6. S_i = C_hp_i × C_n_i × LifeFactor_i × DefenseFactor_i × SkillReductionCoefficient_i。
7. O_i = C_damage_i × C_n_i × AttackFactor_i × PenetrationFactor_i × SkillDamageCoefficient_i。
8. 使用正式 troop data 的 1/3/4 和 300/100/75。
9. C_n 显式保留，各兵阶独立，包括 11/3/11；不用敌方 unit damage/HP 替代 S/O 基数。
10. 线性增伤 p*r 加入原同组，同组相加、不同组相乘。间隔、duration、cooldown、probability、scope 均取 typed definitions；周期窗口不重复除 interval。额外伤害形成独立输出通道。
11. 同组免伤精确枚举触发状态，求 M=E[1/(1+R0+ΣRi)]，生存因子为 1/M；同一 runtime trigger 的效果保留关联，四 Body runtime 独立，不用 p*r 直接作免伤分母。
12. 伤害固定窗口 20 回合；免伤固定窗口 40 回合。先积分实际承伤，再反推等效常驻免伤。
13. J=(ΣS_i x_i)(ΣO_i sqrt(x_i))。log J 的 KKT 条件化为单调标量根，用带区间保护的 Newton 求解；处理零输出与 simplex 边界，无随机初值、无逐套 231 网格。
14. 2,950,368 套 microbenchmark：串行 1.166 s，4 Worker 0.475 s（含该阶段传输/归并，不含 Worker 预热 1.069 s）。吞吐 2,530,280 / 6,206,213 套/s。
15. 每套实际 J 求值 1.0 次；KKT 残差/导数平均 6.512 次，二者分开记录。
16. 当前完整池 876 Head × 39,408 Body = 34,521,408，流式取严格 Top10000；cutoff J = 11310324928.299505。按 Jmax 后 HeadKey、BodyKey 固定排序；没有每 Head、uncertainty、diversity、random lane 保底。current/reference 单独 Final 比较。保留的是 compact 有界堆，未构造数千万个 RallyCandidate。
17. 三轴各 ±10pp 与 simplex 相交，0 锚定 5% lattice，平均每套 10.4999 个合法比例。废弃 13 点和 hard-combo 全局网格回退。
18. Criterion：10,000 对、104,999 个完整 Head×Body×Ratio，按每对最优 Criterion 全局留 2,000 对。
19. Theory：Criterion 最优 ±5pp、1% lattice，并限制在 J 搜索域；93,961 次，留 500 对。
20. Formal：500→200→80→30→10；Top30 在 300 场之前复核整数 ±1pp（可设 ±2pp），本次 210 个邻居/原点共用 100 场。最终比例均有真实引擎样本。Final 优化名额 10，独立比较 3，统一 1000 场。
21. 正式 BattleEngine 调用 54,000；请求 71,000，复用 17,000，缓存 23.94%，平均执行 10.382 ms/场。每级复用配置+seed prefix。
22. 新总耗时 447.970 s；旧同输入 402.931 s；speedup=0.899。新流程本轮未提速，主要增加 Theory 局部比例和正式比例复核工作。
23. 历史 408.0538 s 只保留在 [历史基线](../benchmarks/optimizer/legacy-408s-history.json)，当前新耗时与它的比值为 0.911；缺少原始输入，绝不标注为同输入 A/B。
24. 玩家推荐卡显示三 Head、各专武等级、完整 Body 压缩名称、兵阶、比例、正式胜率/场次。
25. 推荐 DTO 带 Body levels、tiers；应用经 candidateToInput 生成四独立 runtime，Head/Body/Ratio/Weapon/tiers 全部映射。生产 Worker 1000 场结果与串行一致，浏览器完成应用检查。
26. 核心修改：optimizer/jointPipeline 的 types/bodyPolicy/coefficients/peakScan/ratioGrid/workflow；optimizer 的 candidateGenerator、heroPools、heroSearchPolicy、singleWaveSearch、execution、types、profiling；criterion/bodyEnumeration；UI 进度/推荐/Worker pool、main；storage/configCodec；benchmark 脚本、fixture、报告及专项测试。之前 R0 与玩家 UI 的未提交修改均保留。
27. 新增优化器专项 81 项；高级 UI/导入/历史迁移专项 26 项。完整测试 1502/1502 通过；typecheck、lint、build 及 production Edge 浏览器检查通过。
28. 正式 BattleEngine、技能定义/时序、伤害公式、RNG 未改。124 个受保护 engine 文件 hash 不变；已有固定 seed/输入的 1000 场批量结果逐项相同。新历史加成数据修正仅改输入反推/存储/UI 边界。

## 同输入 A/B 与复现

输入完整保存于 [joint-rally-gen11-input.json](../benchmarks/optimizer/joint-rally-gen11-input.json)，项目当前 S11 canonical 默认面板衍生的可复现 fixture；不是 408 秒那次丢失输入。A/B 输入哈希、英雄池、武器、兵阶、面板/Buff、目标、firstSeed 和 Final1000 相同，仅切换 flag。旧流程保留原默认阶段，不人为加重它的第一阶段。Final 都用 screening prefix 300 + 独立 700 seed。

- 旧/新完整profile仅归档到被Git忽略的 `artifacts/benchmarks/optimizer/archive-staged/`；下方A/B摘要保留输入哈希、环境、耗时、场数及精简推荐结果。旧流程已删除，当前代码不能重跑旧profile。
- [A/B 汇总](../benchmarks/optimizer/joint-rally-gen11-ab-summary.json)
- [J microbenchmark](../benchmarks/optimizer/joint-peak-microbenchmark.json)

旧第一推荐：hero.s11.eleonora / hero.s11.lloyd / hero.s11.rufus；Body hero-skill.miya.doom-entanglement, hero-skill.ahemosi.viper-phalanx, hero-skill.nuola.multi-troop-combat, hero-skill.gregory.blazing-sun-army；比例 34/43/23；1000/1000 胜。

新第一推荐：hero.s11.eleonora / hero.s11.lloyd / hero.s11.rufus；Body hero-skill.patelike.life, hero-skill.feilande.fitness-secret, hero-skill.nuola.multi-troop-combat, hero-skill.s8.hengdelike.defense-reduction；比例 54/10/36；1000/1000 胜。

两者首名均 1000/1000，精确 baseline 同为 999/1000。本 fixture 接近稳赢，不能据此证明跨对局的推荐质量。全部推荐及区间保留在 JSON。

```sh
npm run benchmark:joint-rally
npm run benchmark:joint-peak
# 使用已保存的同一输入
npm run benchmark:joint-rally -- --reuse
```

2.95M microbenchmark 从当前真实池确定性选取 3368 个 Body 签名；完整优化不采用该子集。process lifetime maxRSS 1147.0 MiB 包括 B0、签名预计算与 Worker，不是单独 J 扫描的 heap peak；观测到 coordinator GC 1.177 ms，未计 Worker-local GC。当前 B0/签名仍占较多内存，此次未靠删候选降低占用。

简单 J 会对 target-bound、cross-target、control、stack 等作静态近似；范围/通道取 typed data，空间结构由 Criterion/Theory 修正。J 不是正式战斗数学等价式，也不承诺全局真实胜率最优；没有因此增加隐藏保底通道。

## 新流程实际 profiling

| 阶段 | 墙钟耗时 | 完成/总量 | 正式执行 | 复用 |
| --- | ---: | ---: | ---: | ---: |
| H0 · 合法车头生成 | 0.131 s | 1/1 | 0 | 0 |
| B0 · 合法车身与概率支配剪枝 | 2.189 s | 1/1 | 0 | 0 |
| J · 静态签名与免伤状态预计算 | 2.497 s | 40,284/40,284 | 0 | 0 |
| J · Head×Body 峰值搜索 | 4.163 s | 34,521,408/34,521,408 | 0 | 0 |
| Top10000 · 全局 J 峰值截断 | 0.002 s | 10,000/10,000 | 0 | 0 |
| Criterion · 局部 5% 粗筛 | 10.860 s | 10,000/10,000 | 0 | 0 |
| Theory · 局部 1% 细筛 | 126.287 s | 2,000/2,000 | 0 | 0 |
| Formal 20 · 累计正式战斗 | 59.165 s | 10,000/10,000 | 10,000 | 0 |
| Formal 50 · 累计正式战斗 | 32.352 s | 6,000/6,000 | 6,000 | 4,000 |
| Formal 100 · 累计正式战斗 | 18.169 s | 4,000/4,000 | 4,000 | 4,000 |
| Formal Ratio · 正式引擎整数比例复核 | 84.987 s | 18,000/18,000 | 18,000 | 3,000 |
| Formal 300 · 累计正式战斗 | 38.242 s | 6,000/6,000 | 6,000 | 3,000 |
| Final 1000 · common seeds 复验 | 67.699 s | 10,000/10,000 | 10,000 | 3,000 |

进度使用阶段实际工作量与墙钟 ETA；Formal 显示剩余待执行 battle 数，已复用样本不会虚增 ETA。Developer 另有 throughput、candidateCount、BattleEngineCalls、avgBattleMs、cacheHitRate 和 J 计数/cutoff。
