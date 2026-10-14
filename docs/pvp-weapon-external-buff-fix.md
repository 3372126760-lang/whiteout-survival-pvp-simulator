# 专武属性外部 Buff 乘区修复

日期：2026-10-06。本文覆盖旧文档中“场景专武在最终属性后加固定百分点”的规则。

## 1. 错误原因

旧 `validationUi/expectedReportAttribute.ts` 在普通 Buff / Debuff 计算完成后执行 `+ weaponModifier`。
旧 `effects/attributeModifiers.ts` 也将 `hero-weapon-skill.*` 属性效果解析为 `addToAttribute`，直接把专武数值加进面板。
`validationUi/adapter.ts` 再将解析前后的面板差作为“场景专武”列，导致这两个错误路径相互吻合，却不符合最新确认的外部 Buff 同组规则。

原始属性为 0 的旧回归恰好无法区分两种算法：普通 Buff 30% 与专武 15% 在两种错误/正确模型下都可能得到 45%。新增非零原始属性回归覆盖此差异。

## 2. 当前公式与单位

```text
currentExternalBuffBase = 普通当前外部 Buff 小数
currentWeaponBuff = 当前场景、兵种、属性匹配且未禁用的专武 Buff 小数之和
currentExternalBuffTotal = currentExternalBuffBase + currentWeaponBuff

R_expected = (100 + R_raw + formationDelta + currentAdditive)
             × (1 + currentExternalBuffTotal)
             ÷ (1 + currentDebuff)
             − 100
```

`R_raw`、`formationDelta`、`currentAdditive`、`R_expected` 为百分比点；Buff / Debuff 在计算入口为小数。官职仍为加数。专武静态属性的阵容差量仍归 `formationDelta`，不混入场景专武 Buff。

普通 Buff 30% 与专武 Buff 15% 合为 45%，乘区为 **1.45**。不使用 `1.30 × 1.15`，不在结果后加 15 个百分点。攻、防、穿、血四种属性统一执行本规则。

### 用户提供的 A 方盾兵攻击案例

```text
raw             = 2541.3
formationDelta  = 170.14
currentAdditive = 0
normalBuff      = 0.30
weaponBuff      = 0.15
debuff          = 0.20
totalBuff       = 0.45

expected = (100 + 2541.3 + 170.14) × 1.45 / 1.20 − 100
         = 3297.156666666667%
页面四位小数：3297.1567%

旧错误结果 = [(100 + 2541.3 + 170.14) × 1.30 / 1.20 − 100] + 15
           = 2960.726666666667%
```

## 3. 实现与数据链路

| 位置 | 修改 |
| --- | --- |
| `src/pvp/validationUi/expectedReportAttribute.ts` | canonical builder 只接收合计外部 Buff，删除结果后的专武加算；audit 验证来源之和、实际合计、表格值与引擎投影一致 |
| `src/pvp/scenario/pureTroopScenario.ts` | 保留每兵种、每属性的原始值、阵容差量、官职、普通 Buff、Debuff 构建上下文 |
| `src/pvp/types/troop.ts`、`battle/createBattleState.ts` | 保存/转交只读 `reportAttributeContext`；模板 clone 沿用只读上下文 |
| `src/pvp/effects/attributeModifiers.ts` | 已激活专武与匹配的外部属性 group 同组求和，再用原始上下文调用 canonical builder，随后按原有规则处理普通英雄属性乘区与属性减益 |
| `src/pvp/validationUi/adapter.ts` | 场景专武列读取 Buff 来源值，而不是最终属性差；UI、实际属性与 compiler 使用相同合计 |
| `src/ui/main.ts` | 保留普通 Buff 与场景专武列，增加“外部 Buff 合计”；更新公式提示与高级调试单位 |

不修改专武定义的值、等级、场景条件、触发/生效时机、scope；其他英雄技能分组不变。低层直接构造的测试状态没有构建上下文时，将面板视为原始属性、普通外部 Buff 为 0。正式预测配置均由场景提供完整上下文。

最终战报模式仍直接使用已包含专武等外部来源的最终属性，不再次叠加预测 Buff 或专武效果。

audit 的 `displayedTargetBuff` 是普通来源小数，`displayedWeaponModifier` 是专武百分比点，`actualTargetBuffUsed` 是实际传入 builder 的合计小数；新增三个 `currentExternalBuff*` / `currentWeaponBuff` 字段明确来源与合计。`weaponSemantics="sameExternalBuffGroup"`。

## 4. 回归与检查

测试：`expectedReportAttribute.test.ts`、`weaponExternalBuffRegression.test.ts`；已有 S1/S3 分组测试继续验证技能与普通外部来源的独立/同组关系。

| 条件（raw=200%，阵容修正/官职为 0） | 外部 Buff 合计 | 预期报告属性 |
| --- | --- | --- |
| 普通 Buff 30%，专武关闭 | 30% | 290% |
| 普通 Buff 0，专武 15% | 15% | 245% |
| 普通 Buff 30%，专武 15% | 45% | 335% |
| 普通 Buff 30%，专武 15%，Debuff 20% | 45% | 262.5% |

上述四组分别使用实际攻击、防御、穿透、生命专武，在盾/矛/射三个兵种上验证。额外覆盖：专武禁用、不匹配场景、两个专武来源合并、非零阵容差量与官职、最终战报不重算、UI 预期/audit 与 BattleTrace 属性一致、生命快照一致、快模式与完整战斗结果一致、重复快模式试验不累加 Buff。

本轮结果：

- `npm.cmd run typecheck`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd run build`：通过；保留现有 UI chunk 大小提示。
- `npm.cmd test`：**70 个测试文件、830 项测试全部通过**。

上述为代码和数据链路回归，没有把合成测试当作新的真实游戏战报验证，也没有宣称进行了连接浏览器后的视觉检查。没有启动额外开发服务器。

未修改 BattleEngine / DamageEngine 伤害公式、HP 公式、三队列调度、已确认英雄技能规则及专武数值。更新模型公式、技能说明和旧报告的覆盖提示，保持最新交接文档与运行代码一致。
