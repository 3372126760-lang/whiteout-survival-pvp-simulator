# PVP 乘区与属性组（2026-10-06）

本表以最新用户规则和当前运行代码为准。同一 group 在匹配 source、target、回合及 damageType 后先加算，不同 group 相乘；效果的**战报验证状态**另见 [全量技能报告](../hero_skill_inventory.md)。完整公式和旧名映射见 [规则迁移清单](../PVP_RULE_MIGRATION_2026-09-26.md)。

## 属性层

```text
P_x = (1 + R_x + S_x + A_x) × (1 + E_x + W_x) / (1 + D_x)
F_x = P_x × Π英雄技能组g(1 + Σg) / Π敌方英雄减益组h(1 + Σh)
x ∈ {attack, defense, penetration, life}
R_x=原始属性，S_x=阵容静态修正，A_x=当前官职，E_x=普通外部 Buff，W_x=场景专武 Buff；均为小数
```

| 层 | group 示例 | 作用 |
| --- | --- | --- |
| 报告/基础 | `1+reportAttribute` | 最终战报模式直接使用报告四属性 |
| 外部 Buff | 城镇、宠物、专家 | 预测模式中普通外部 Buff `E_x` 与专武 Buff `W_x` 先相加，`1+E_x+W_x` 乘原始/阵容/官职层；`D_x` 为外部减益 |
| 专武场景属性 | `buffAttack`、`buffDefense`、`buffPenetration`、`buffLife` | 匹配场景与属性后加入同一个外部 Buff 组；不是最终属性百分点加算，也不是独立乘区 |
| 普通英雄技能 | `heroAttackBonus`、`heroDefenseBonus`、`heroPenetrationBonus`、`heroLifeBonus` | 战斗中生效但不重复写入最终战报面板 |
| 敌方英雄属性减益 | `enemyAttackReduction`、`enemyDefenseReduction`、`enemyPenetrationReduction`、`enemyLifeReduction` | 对目标对应属性因子作除数 |

最终战报模式已含外部来源时不再重复叠加。普通攻击 Buff 30% 加专武攻击 Buff 15% 得到外部 Buff 总计 45%，对应外部乘区为 1.45；最终属性还需乘原始/阵容/官职层并除外部减益。

目标防御属性因子进入**每笔受击伤害的分母**，生命属性进入单兵最大 HP。钢铁守护只匹配盾兵受到矛兵攻击时的防御属性；津曼、菲兰德及其他普通防御提升使用 `heroDefenseBonus`。`skillDefenseBonus` 独立事件除数已废弃。`baseDefenseMultiplier` 是光铸之躯等“基础防御力”特殊效果，不合入普通防御属性组。

## 攻击侧和受击侧

| 概念 | group / effectKind | 适用事件与位置 |
| --- | --- | --- |
| 普通增伤 | `commonDamageIncrease` / `damageIncrease` | 按 scope 可覆盖普攻及技能；与普攻专属增伤分开 |
| 普攻专属增伤 | `normalAttackDamageIncrease` | 仅 `normalAttack`；玲奈、卡拉 |
| 技能专属增伤 | `skillDamageIncrease` | `skillDamage` 和 `extraDamage` |
| 易伤 | `vulnerability` / `incomingDamageIncrease` | 目标受击侧，同组加算 |
| 兵种克制 | `troopCounterDamage`、`troopVsTroopDamage` | 独立于普通增伤 |
| 防御削减事件增伤 | `defenseReduction` | 既有独立事件因子，仍需真实战报验证 |
| 目标承伤降低 | `receivedDamageReduction` | 全军与指定兵种 effect 先按目标筛选、再同组加算 |
| 攻击方造成伤害降低 | `enemyOutgoingDamageReduction` 等 | 与目标承伤降低分开相乘 |
| 普攻/技能免伤 | 各 reduction group 的 `damageType` scope | 只匹配对应 DamageEvent |
| 基础攻击特殊倍率 | `baseDamageMultiplier`，如 `flameImpactBaseAttack` | 进入基础量，Trace 列明 effect 来源 |
| 基础防御特殊倍率 | `baseDefenseMultiplier`，如 `lightforgedBaseDefense` | 额外除数，Trace 列明 effect 来源 |
| 兵种受到伤害降低 | `receivedDamageReduction` | 烈晶盾牌、炽红力场、巴希提按目标和触发状态筛选后同组加算；伤害除以 `1 + Σr` |
| 临时护盾 | `temporaryShield` | 取整后、扣 HP 前的容量吸收，不是乘区 |

`extraDamage` 是 `skillDamage` 子类型，不是 `additionalAttack`。同一主攻、同目标、同时点、同 `parentBaseDamage` 的技能额外系数在一个池里先相加再按技能乘区取整。例如炎晶战矛 `1B` 与芮妮 `2B` 合成 `3B`。射手火焰冲击的基础攻击 `×1.06` 与燃晶火药同一额外事件 `0.875B` 各有清晰来源。加托护盾刷新使用 replace；容量为 `100×Ct×√当前盾兵数×(1+A_report)×技能等级比例`（Lv5 为 30%，Lv4 为 24%）。
