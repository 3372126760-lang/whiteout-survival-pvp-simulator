# 兵种等级、固定系数与混等兵结算（2026-09-28）

本说明按本轮用户确认规则更新，覆盖此前关于不存在等级、常数连乘和混兵余数分配的描述。英雄技能效果、英雄属性乘区及回合行动/结算顺序保持原规则。

## 1. 等级与类型分离

```ts
TroopLevelData { id: string; troopConstant: number }
TroopTypeData { damageCoefficient: number; lifeCoefficient: number }
```

等级数据只有 `id` 和 `Cn`，没有攻击、防御、生命、穿透面板。`TroopState` 的四属性仍是战报/英雄属性，与等级数据无关。

| 兵种 | 固定伤害系数 Cd | 固定生命系数 Cl |
| --- | ---: | ---: |
| 盾 | 1 | 300 |
| 矛 | 3 | 100 |
| 射 | 4 | 75 |

正式等级初始化强制读取兵种类型系数，即使旧程序输入提供其他系数也不会采用。非游戏等级如 `TEST` 的低层公式测试保留注入能力；不存在的 `T数字…` 等级不能通过自定义常数绕过校验。

```text
B = sqrt(N0) × sqrt(n_s) × Cd(type) × Cn(level)
基础伤害 = B × (1 + attack) × (1 + penetration)
单兵基础 HP = Cn(level) × Cl(type)
单兵有效 HP = 基础 HP × (1 + life)
```

防御、技能、减伤等既有乘区与计算顺序不变。T12 的 `Cd`、`Cl` 不乘 1.18；本轮全部 `Cn` 使用表内值，不执行推导或插值。

实现：`src/pvp/data/troopTypes.ts`、`troopDamageCoefficients.ts`、`troopHpCoefficients.ts`、`src/pvp/types/troop.ts`、`src/pvp/battle/createBattleState.ts`。DamageEvent 继续从初始化后的兵种栈读取 `Cd/Cn`，公式函数保持独立。

## 2. 完整常数表：32 个实际等级

T1～T10 与 T11-FC3～10 的数值沿用项目既有对照表中的四位小数检查点；T12 四项采用确认值。基础 T11 已按 2026-10-01 最新口径删除。

| 等级 | Cn | 等级 | Cn |
| --- | ---: | --- | ---: |
| T1 | 1 | T2 | 1.5 |
| T3 | 2.1 | T4 | 2.73 |
| T5 | 3.276 | T6 | 3.8657 |
| T7 | 4.5615 | T8 | 5.3826 |
| T9 | 6.3514 | T10 | 7.4947 |
| T10-FC1 | 7.7945 | T10-FC2 | 8.1842 |
| T10-FC3 | 8.5934 | T10-FC4 | 9.0231 |
| T10-FC5 | 9.4742 | T10-FC6 | 9.8532 |
| T10-FC7 | 10.3459 | T10-FC8 | 10.8632 |
| T10-FC9 | 11.4063 | T10-FC10 | 11.9766 |
| T11-FC3 | 10.1402 | T11-FC4 | 10.6472 |
| T11-FC5 | 11.1796 | T11-FC6 | 11.6268 |
| T11-FC7 | 12.2081 | T11-FC8 | 12.8185 |
| T11-FC9 | 13.4595 | T11-FC10 | 14.1324 |
| T12-FC7 | 14.4056 | T12-FC8 | 15.1259 |
| T12-FC9 | 15.8822 | T12-FC10 | 16.6763 |

基础 `T11`、`T11-FC1/2`、基础 `T12` 和 `T12-FC1～6` 不存在：从目录中删除，常数查询和配置导入明确拒绝。没有自动升级非法旧等级，也没有为非法等级生成近似常数。

唯一目录在 `src/pvp/data/troopConstants.ts`。UI、存储校验和兵种技能等级解析共用它。兵种技能的触发、效果数值及解锁阈值未改。

## 3. ServerStage 枚举限制

`src/pvp/progression/serverStage.ts` 为各阶段上限维护实际允许的等级列表，以成员检查决定可用等级。保留原服务器火晶上限，例如 S4 T11-FC5 阶段可用 T11-FC3/4/5，仍不能用基础 T11 或 T10-FC6。

`NEXT_AVAILABLE_TROOP_LEVEL` 从实际目录建立后继映射：

```text
T10-FC10 → T11-FC3
T11-FC10 → T12-FC7
T12-FC10 → null
```

UI 不显示不存在等级，S10 T12 及后续阶段允许 T12-FC7/8/9/10。英雄代数限制不变。

## 4. 混等兵：初始比例与独立向上取整

每个兵种栈新增 `initialLevelComposition`，保存开战初始等级人数。后续分配读取初始权重，不能重新使用上轮整数余数后的构成作为比例。

```text
p_g = 初始等级 g 人数 / 本兵种初始人数
等级 g 的类别明细 = ceil(该类别总数 × p_g)
类别 ∈ {损失、受伤、轻伤、生还}
```

用 BigInt 算有理数上取整，避免浮点误差把整人数多取整 1。单项不超过该等级初始人数；确已耗尽的等级生还为 0。各类别独立计算，轻伤不能用“该等级总退出 − 损失 − 受伤”倒推。

### 取整冲突的处理假设

用户要求的“每项独立向上取整”和“整数明细合计与总兵数严格守恒”不能同时普遍成立。例如 1 人按 40%/60% 分配得到 `1 + 1 = 2`。

本轮采用已经在对话中说明的处理口径：**报表保留独立向上取整，差额另记；内部实际兵数保持守恒。该差额处理是实现假设，不是已经获得真实战报验证的游戏余数规则。**

| 层 | 字段与行为 |
| --- | --- |
| 实际战斗人口 | `aliveCount`、`levelComposition`；整数且合计守恒；从初始权重投影到实际总数，容量限制保证等级不复活、不超扣 |
| 回合等级明细 | `ceilingDeaths`、`ceilingAliveCountAfter`；分别上取整；`roundingDifference` 记录等级明细合计减去实际总数 |
| 最终战报等级明细 | `byGrade` 四类分别按初始权重上取整；每行 `roundingDifference` 为四类合计减初始人数 |
| 最终战报兵种/总计 | `byTroop`、`total` 保持真实总兵数与原伤亡分类规则；`gradeRoundingDifference` 逐列记录明细差额 |

内部人口投影仍需整数对齐，使用容量约束的最大余数记账；它不替代上取整报表，也不被标为真实游戏已验证的分配细则。有效 `Cn` 按仍存在等级的**初始权重**计算，防止整数记账导致伤害/HP 比例逐轮漂移；某等级确实为 0 时剔除该等级。前排残血占最大 HP 的比例保留。

例：初始 T10/T11-FC3 为 4000/6000，实际生还总数 8333。等级生还明细为 `ceil(3333.2)=3334` 与 `ceil(4999.8)=5000`；合计 8334，明细差额 +1，战斗实际总生还仍为 8333。

实现：`strategies/mixedLevelCasualtyAllocation.ts`、`strategies/proportionalAllocation.ts`、`casualty/resolvePendingDamage.ts`、`casualty/rebaseTroopForLevelComposition.ts`、`postBattle/casualtyResolver.ts`。UI 和 BattleTrace 均展示取整差额。默认策略由旧 provisional 策略改为 `confirmed-initial-ratio-ceiling`；旧策略只保留为显式可选的兼容接口。

## 5. 验证

- 等级、混兵、阶段、最终分类与优化器 fast/full 专项最终回归：6 个测试文件、73 项通过，包含混兵输入不能绕过非法主等级校验。
- 新增 `src/pvp/tests/troopLevelRules.test.ts`：10 项通过，逐项检查所有合法等级和固定系数，另覆盖初始比例、多轮稳定性、耗尽等级、3333.2 上取整和模板隔离。
- 2026-10-01 全量测试：669 项中 668 通过，1 项既有失败。失败为 `rallyBodySkill.test.ts` 的四个相同手动车身槽，核心英雄唯一性检查拒绝。此前 2026-09-28 的运行输出见[历史测试日志](../examples/troop-rule-test-log.txt)。
- `npm run typecheck`、`npm run lint`、`npm run build` 通过。
- 全量回归包含英雄技能及优化器 fast/full 一致性用例。通过说明实现符合当前输入规则，不代表新增真实游戏战报证据。

本轮未修改英雄技能定义/触发效果、英雄属性系统、回合行动次序、伤害事件顺序、匹配规则或优化器搜索变量。
