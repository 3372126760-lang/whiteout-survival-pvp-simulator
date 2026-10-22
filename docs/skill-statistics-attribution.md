# 技能退出与击败统计口径

更新：2026-10-21。范围仅为统计采集、汇总和展示，未更改战斗规则。

## 修正的数据链

```text
技能触发与 extraDamage 草稿
  → 原有 actionPhase 合并，保留 skillPoolComponents
  → 原有 DamageEvent 取整、护盾、HP、溢出、退出结算
  → attributeResolvedDamage 只读实际事件与 TargetCasualtyResolution
  → 按来源记录伤害贡献、退出归因、普通攻击和未归因项
  → projectSkillDefeats 读取正式战后分类，换算技能击败估算
  → 单场 / 批量 / 各模式统计表 / 技能统计 JSON
```

旧问题出现在 `resolveRoundCompact`：仅使用结算事件的顶层 `sourceSkillId`，把合并事件的所有退出归给第一个技能。单场 `summarizeBattleSkills` 的额外伤害事件数也只识别顶层来源。`actionPhase` 已保留完整组成，来源并未在实际伤害池中丢失。

现在单场完整模式和批量 compact 模式都调用同一个纯统计函数。保留原有合并事件及其中每个组件的 ID、技能 ID、系数、baseDamage；没有为了统计拆分事件、重新执行伤害或重新消耗 RNG。

## 精确结算与来源估算

必须区分三种数据：

1. **实际模型结算**：原始事件及其整数伤害、实际护盾吸收、HP 扣除、丢弃溢出、整数退出人数、最终兵力和正式战后分类。
2. **技能伤害贡献**：独立事件直接使用事件数值；合并事件按组成分摊。组件没有各自独立的取整和结算结果。
3. **技能击败估算**：来源归因的退出人数按目标正式战后分类换算，始终不是已确认的游戏真实技能击败。

独立单一来源事件的 `exactExited` 是模型在该事件结算时记录的退出数。它仍不证明该技能独自造成这些人的全部 HP 损失：前序攻击可能已削减其 HP。合并来源的 `estimatedExited` 为小数估算。某技能汇总行可以同时含有两类退出，UI 只要含比例分摊就标记“比例估算”，导出分别保留两类数值。

## 合并池公式

对于完整 canonical 合并池，组件 `i` 的份额为：

```text
w_i = component_i.baseDamage / Σ component.baseDamage
归因退出_i = 该事件实际退出人数 × w_i
HP 伤害贡献_i = 该事件实际 HP 扣除 × w_i
护盾吸收贡献_i = 该事件实际护盾吸收 × w_i
丢弃溢出贡献_i = 该事件实际丢弃溢出 × w_i
```

原始伤害与取整后伤害也记录各自分摊值；分摊值没有被当作新伤害送回引擎。

- 仅丽姬娅二、三技能的 `1B + 1B`：各占 `1/2`。
- 燃晶火药、二技能、三技能的 `0.875B + 1B + 1B`：分别占 `7/23、8/23、8/23`。顶层 ID 仍可为燃晶火药，但不再决定整笔伤亡归属。
- 同一技能在一个池中出现多次：累计其组件份额，事件数只计一次。
- 连射 `internalSegments`：使用已有内部段取整后伤害占完整事件取整后伤害的比例，剩余部分归普通攻击；原始伤害份额则用原始段伤害计算。没有再次取整内部段。

份额用于实际结算后的 HP、护盾、退出和丢弃溢出。不会用未被目标承受的溢出来虚增退出；全护盾吸收或目标已死亡后的事件不会制造退出。报告不改变护盾消耗顺序或目标选择。

所有已知技能、普通攻击和未归因项合计等于实际总数（允许浮点运算误差）。技能贡献不能再次加到总伤害或总退出中。原有 `skillCasualtiesBySide` / `meanSkillCasualties` 兼容字段保留，改为读取统一报告的退出归因，合并池下可以为小数；两者继续保留原来对芮妮惊梦留痕的显式排除。新 `damageAttribution` / `skillDamageStatistics` 则完整记录其已知事件来源，现行 UI 和新导出都使用完整报告，不因旧字段排除而漏掉来源。芮妮触发、标记和伤害机制未改。

## 击败换算与取整

规则唯一来源是 `postBattle/casualtyResolver.ts`，本次未修改该文件。

| 战后模式 | 损失 | 受伤 | 轻伤 | 正式击败定义 |
| --- | ---: | ---: | ---: | --- |
| NORMAL | 0% | 35% | 65% | 损失 + 受伤，约为退出的 35% |
| FURNACE | 35% | 10% | 55% | 损失 + 受伤，约为退出的 45% |

正式 resolver 先在**总退出人数**上做带容量约束的最大余数整数分配，再向兵种分配损失及受伤。因此小样本和各兵种的实际比例不一定恰好等于 35% 或 45%。分兵阶展示的独立向上取整列不能作为额外退出或击败加进技能统计。

对于来源方 `S`、技能 `k`、目标方 `T` 和目标兵种 `t`：

```text
E_T,t = 正式战后分类中该目标兵种的退出人数
D_T,t = 正式战后分类中该目标兵种的 defeated（loss + injured）
X_k,t = 该技能对该目标兵种的归因退出人数

技能击败估算_k = Σ_t [ E_T,t > 0 ? X_k,t × D_T,t / E_T,t : 0 ]
```

不逐技能取整，不直接在所有模式硬编码 `退出 × 35%`。保留报告原始浮点值；UI 最多显示三位小数，仅作显示格式化，显示行相加可能有末位误差。实际总退出和正式总击败仍使用原来的整数结算结果。

每场批量试验先计算自己的正式整数分类、换算自己的来源击败，再累计取均值；不是先平均退出后重新做一次整数分类。批量触发次数显示每场均值，原概率判定统计另外保留。

当前 canonical 战后模式只有 NORMAL、FURNACE。未知/缺失的战后分类不推断规则，`defeatedEstimate = null`，UI 显示“未确认”。战斗场景、模拟随机方式和战后伤亡模式是不同字段，不凭场景名称猜比例。

## 展示与导出

- Developer 单场技能详情与批量统计。
- 高级模式单场抽屉、批量统计和完整统计抽屉。
- 普通模式已有的批量详细统计抽屉。

这些入口共同使用 `skillStatisticsView.ts`：技能名称、触发次数、HP 伤害贡献、**退出战斗人数、击败（估算）**、退出归因。保留退出列并在其后新增击败列。纯属性、控场或护盾技能没有直接伤害归因时显示“—”，不把其间接战斗价值伪装成零贡献或反事实击败。

每张表提供“导出技能统计 JSON”，包含未格式化的完整汇总、来源 ID、精确/估算退出拆分、护盾/HP/溢出、目标兵种退出、正式总击败、模式、种子范围和口径说明。只在点击下载时 stringify；不包含完整战斗轨迹。原 Developer Raw BattleResult 导出继续保留真实事件和组件，同时自然包含新的原始归因报告。

公开 HTML 使用技能名称，不嵌入技能内部 ID。导出数据保留 ID 方便审计。

## 缺失数据与边界

- 有 `skillPoolComponents` 时，以它为准；不会回退到顶层 ID 吞掉整个事件。空池、无效份额、缺失来源进入“未归因”。部分组件只有已知部分得到归因，剩余份额保留未归因。
- 多事件共用一份结算记录时，按各事件取整后伤害再分摊并标记估算；当前正式 resolver 通常一条结算对应一条事件。
- 旧报告若完全丢失池字段、但仍保留一个看似合法的顶层 ID，不能从剩余数据反推出历史池组成；需要原始完整事件或重新运行。旧批量结果缺少新报告时保留其退出记录并提示来源未校验，击败为“未确认”。
- 三队批量模式原来没有逐技能来源统计，本轮没有重构三队调度与统计采集；界面明确提示“不推断技能退出或击败”。单次交锋的底层完整 BattleResult 已携带原始归因，但三队跨场汇总未接入。
- 未进行 Buff、减防、控场等技能的反事实因果分配；没有声称已还原游戏官方技能击败算法。

## 本轮文件与函数

| 文件 | 作用 |
| --- | --- |
| `src/pvp/statistics/skillDamageAttribution.ts` | `attributeResolvedDamage`、`projectSkillDefeats`、合并/均值、来源与触发计数公共函数 |
| `src/pvp/round/resolveRound.ts` | `resolveRoundCompact` 在已有结算后采集报告，替换顶层 ID 归因 |
| `src/pvp/battle/simulateBattle.ts` | `simulateBattle` 完整/compact 汇总；none 标记未采集 |
| `src/pvp/validationUi/adapter.ts` | `runValidationBattle` 投影；编译批量试验按需开启临时技能 trace，运行后重置 |
| `src/pvp/validationUi/batchSimulation.ts` | `runBatchSimulation` 逐场分类、投影、流式累计；不保留完整 trace |
| `src/pvp/validationUi/skillSummary.ts` | `summarizeBattleSkills` 识别全部池组件；统一触发次数口径 |
| `src/pvp/validationUi/types.ts` | 单场报告和技能行统计类型 |
| `src/ui/skillStatisticsView.ts` | 共用表格及结构化技能统计导出 |
| `src/ui/main.ts` | Developer 入口及导出点击处理 |
| `src/ui/advancedModeView.ts`、`src/ui/simpleModeView.ts` | 共用统计表接入及三队数据限制提示 |
| `src/pvp/tests/fixtures/skillDamagePool.ts` | 可复现丽姬娅/燃晶火药合并池测试输入 |
| `src/pvp/tests/skillDamageAttribution.test.ts` | 合并池、取整、护盾、溢出、死亡、来源缺失、模式、单场/批量与 1000 场一致性 |
| `src/ui/skillStatisticsView.test.ts` | 各入口列顺序、估算提示、旧数据及 JSON 导出 |
| `src/pvp/tests/batchSimulation.test.ts`、`s4RuleUpdate.test.ts` | 原静态 UI 接线断言改为检查共用统计入口，保留其余断言 |
| `src/pvp/tests/s6RuleUpdate.test.ts` | 继续验证芮妮旧字段排除，增加完整报告来源及战斗状态一致性断言 |
| `benchmarks/optimizer/formal-engine-integrity.json` | 仅更新 `simulateBattle.ts`、`resolveRound.ts` 两处已审阅统计接线的哈希，其他基线条目不变 |

## 验证记录

修改前重新运行全量测试：133 个文件、1659 个测试全部通过。新增测试覆盖丽姬娅双技能与三来源合并池，以及同种子 1000 场逐场结果和批量均值的一致性。

另外，修改前后保存的 24 组实际战斗执行指纹一致，比较原始事件、rounds、HP、护盾、兵力、正式伤亡、RNG trace 和 FastBattle 输出。24 条指纹记录含重复输入，实际有 12 组不同配置，燃晶火药均为强制不触发；不能把它声称为粉药开启/关闭的完整 A/B 覆盖。正确枚举强制开启的粉药三来源案例由新的正式回归测试覆盖，并核对 Full / Summary / FastBattle 的兵力一致性。

最终验证：`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd test`、`npm.cmd run build` 全部通过。Test Files：135/135 passed；Tests：1687/1687 passed；零失败、零跳过。新增 23 项统计测试及 5 项 UI/导出测试；1000 场逐场/批量一致性测试在全量运行中约耗时 2.96 秒。生产页面输出位于 `dist-ui/`。
