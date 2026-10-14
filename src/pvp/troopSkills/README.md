# PVP 兵种技能

兵种技能通过 `TroopSkillDefinition`、`TroopSkillRuntimeState`、注入式 RNG、
`ActiveEffect` 和 `DamageEvent` 接入统一回合引擎。所有事件仍在回合末统一结算伤亡。

已实现触发点：`passive`、`roundStart`、`beforeAttack`、`beforeDamage`、
`afterNormalAttack`。连射第二段保留原目标，作为同次主攻击的内部伤害段，
不新增独立 DamageEvent、主攻击计数或事件型技能判定，并复用首次攻击已完成的防御判定。

炎晶战矛仍在 `beforeAttack` 进行一次概率判定；成功后在主普通攻击完成时生成一笔以
`parentBaseDamage` 为基准的 100% `skillDamage/extraDamage` 子事件，不放大普通攻击本体。

火晶技能等级由兵种 FC 等级自动决定：FC3～4 为第一技能 Lv1，FC5～7 为 Lv2；
FC8/9 增加第二技能 Lv1，FC10 升为 Lv2。燃晶火药在 FC8/10 与火焰冲击联动，
同一笔 `skillDamage/extraDamage` 的系数分别为 75%/87.5%，仅取整、归因一次。
火焰冲击的基础攻击力倍率进入射手基础伤害 B，主攻击、连射与从 B 派生的伤害继承。

光铸之躯的基础防御力特殊倍率与钢铁守护的条件型 `heroDefenseBonus` 防御属性分开；
二者都影响受击事件，防御不进入 HP。烈晶盾牌每个敌方兵种
主攻击判定一次，成功后整根攻击及派生伤害使用单份 36%/46%/51% 的 `receivedDamageReduction`。
炽红力场对每笔独立 incoming DamageEvent 分别判定，成功提供同组 50% 承伤降低；
连射内部段不产生额外判定。
两者与巴希提的 20% 按适用范围同组加算，伤害除以 `1 + Σr`。

T12 矛兵前五回合同时提供盾兵承伤降低（`1/(1+x)`）和射手造成伤害增加；
分别进入 `receivedDamageReduction` 与 `commonDamageIncrease` 组。
射手 T12 在 R6 起每五回合永久增加一层普通增伤，当前层数为
`floor((round-1)/5)`，每层为最终 T12 等级的 0.5%。平台直接输入最终等级 0～24。

## Remaining RULE_UNKNOWN

1. `futureEffectActivationTiming`
2. `targetingOverrideConflictPrecedence`
3. `reservedTriggerScheduling`
4. `complexInitiativeOrdering`
5. `troopConstantMissing`（T12、T12-FC1～FC5）
