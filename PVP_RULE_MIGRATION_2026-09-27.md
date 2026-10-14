# PVP 规则迁移：加托护盾与承伤降低（2026-09-27）

> 本文件中的加托护盾**容量公式**继续适用；其中“每次主攻击后立即生成并可当轮承伤”的旧时序已被 [S8 最新确认规则](S8_RULE_MIGRATION_2026-09-27.md) 覆盖。现行为 Rn 触发、R(n+1) 生效。

本文件记录最新用户确认口径，覆盖 [2026-09-26 历史迁移](PVP_RULE_MIGRATION_2026-09-26.md) 中加托护盾、烈晶盾牌和炽红力场的旧解释。**用户提供的 Sheet2/Sheet3 实验结论是规则依据；原始表格尚未保存在本仓库。自动化回归只验证代码与指定公式一致，不等同于独立复核实战数据。**

## 加托二技能

通用英雄远征技能默认 Lv5；复现 Sheet2/Sheet3 时显式选择实验中的 Lv4。盾兵每次完成主攻击后生成一回合护盾，第一发敌方先手攻击发生于加托首次主攻击之前时没有此盾。新护盾按本次生成值 **replace** 旧剩余值。

```text
Ct = 当前盾兵兵种等级常数
n = 本次生成护盾时的当前盾兵存活数量
A_report = 最终伤害 Attack 中非英雄远征技能的战报攻击加成（小数）
X = 100 × Ct × sqrt(n) × (1 + A_report)
S_Lv5 = 0.30 × X
S_Lv4 = 0.24 × X
```

`A_report` 已合并裸属性及战报层的城镇、宠物、专家、专武、其他外部 Buff，以及战报层的非英雄技能 Debuff，不得再逐项额外相乘。书允 +25% 等英雄远征技能攻击 Buff 和对方英雄技能减攻仍影响正常伤害，却不进入 `X`；穿透也不进入 `X`。例：`Ct=14.1324`、`n=1`、`A_report=6.519`，得到 `X=10626.15156`，Lv5 护盾 `3187.845468`，Lv4 护盾 `2550.2763744`。`n=4` 时 `X` 和护盾均加倍。

实现：[gatotShield.ts](src/pvp/heroSkills/gatotShield.ts)、[s8Heroes.ts](src/pvp/heroSkills/definitions/s8Heroes.ts)、[resolveHeroSkills.ts](src/pvp/heroSkills/resolveHeroSkills.ts)、[resolvePendingDamage.ts](src/pvp/casualty/resolvePendingDamage.ts)。艾丽芙的护盾仍为独立暂定模型。

## 受到伤害降低

烈晶盾牌触发时的 36%/46%/51%、炽红力场触发时的 50%，以及巴希提一技能的 20%，均按适用范围加入 `receivedDamageReduction`。先筛选目标兵种、伤害事件类型、触发状态和持续时间，再将有效来源加算：

```text
r_total = sum(每个有效来源的 r)
D_after = D_before / (1 + r_total)
```

| 有效来源 | 承伤分母 |
| --- | ---: |
| 烈晶盾牌 51% | 1.51 |
| 烈晶盾牌 51% + 巴希提 20% | 1.71 |
| 炽红力场 50% | 1.50 |
| 炽红力场 50% + 巴希提 20% | 1.70 |
| 三者均匹配同一事件时的算术检查 | 2.21 |
| 烈晶盾牌 51% + 攻击方独立减伤 30% | 分别除以 1.51 与 1.30 |

烈晶盾牌维持每个敌方兵种主攻击判定一次并覆盖整根攻击的范围；炽红力场维持每笔独立 incoming `DamageEvent` 判定一次的范围。连射内部段不另判。二者不再使用旧 `×0.49`、`×0.5` 或专属 direct cancellation group。引擎通用 `directDamageCancellation` 类型暂保留给其他潜在效果，当前这两个技能没有该类定义。

实现：[shield.ts](src/pvp/troopSkills/definitions/shield.ts)、[lancer.ts](src/pvp/troopSkills/definitions/lancer.ts)、[resolveTroopSkills.ts](src/pvp/troopSkills/resolveTroopSkills.ts)、[createDamageEvent.ts](src/pvp/damage/createDamageEvent.ts)。

## BattleTrace 和回归

护盾日志记录技能等级、`Ct`、当前盾兵数、平方根、`A_report`、战报攻击因子、`X`、护盾比例、生成值、旧值和刷新后值。承伤日志保留每个来源 ID 与数值、总和、分母和应用前后伤害。[battleTrace.ts](src/pvp/logging/battleTrace.ts) 与 [专项测试](src/pvp/tests/gatotAndReceivedReduction20260927.test.ts) 覆盖四项加托数值检查、首击时序、六组承伤算例及实际巴希提与烈晶盾牌联动。[hero_skill_inventory.md](hero_skill_inventory.md) 和 [底层模型与全量技能报告](PVP_MODEL_CORE_AND_HERO_SKILLS.md) 按新规则生成。
