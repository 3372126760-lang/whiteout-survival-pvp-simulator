# S9/S10 英雄技能规则迁移（2026-09-27）

本文件记录用户本次确认的《无尽冬日》PVP S9/S10 规则及当前实现。以下“已确认”指**用户给定规则**；除马格努斯的 1500 次盾主攻、604 次触发统计外，仓库没有附上可逐笔核查的原始游戏战报。`src/pvp/tests/s9S10RuleUpdate.test.ts` 和 `s9_s10_rule_trace.txt` 是引擎合成回归，不等于实测拟合。

## 公共计算口径

每轮先固定双方兵数快照。兵种 `s` 的基础量为：

```text
B_s = √min(双方开战初始总兵数) × √(本轮开始时 s 存活兵数)
    × s 的伤害系数(盾1/矛3/射4) × 兵种等级常数
```

S9/S10 新确认的 `kB` 技能先取 `parentBaseDamage × k`，再按各自目标重新结算防御、普通增伤、易伤、克制、技能增伤、承伤降低、攻击方造成伤害降低、技能免伤和取整。普通主攻击被闪避时，`parentBaseDamage` 仍保留可复用的基础量；普通攻击最终伤害为零，不会让独立的尝试型技能伤害变成零。韦恩二技能与布兰琪三技能分别对敌矛、敌射建事件，重新解析每个目标的攻穿及目标乘区，缺失目标不转移系数。同源、同目标、同结算点、同后续乘区的 `parentBaseDamage` 技能草稿由 `round/actionPhase.ts` 合池。

公共主攻顺序：目标选择 → `mainAttackAttempt` 技能判定与计数 → 普攻闪避 → `successfulNormalAttackHit` 技能判定 → 普通伤害及技能草稿 → 合池及逐事件结算 → 回合末护盾、HP、伤亡。眩晕或其他跳过行动在目标选择之前终止，因此不产生主攻尝试。马格努斯当轮防御 Buff 从盾主攻判定成功时起生效，不能回溯此前伤害，次轮失效。最终战报模式已包含静态英雄、专武、城镇、宠物、专家等面板属性，运行时只附加未进入面板的英雄战斗技能。

引擎普通增伤统一使用 `commonDamageIncrease`，对应用户规则中的 `baseDamageIncrease`；它覆盖符合 scope 的普通攻击和技能伤害。所有“受到伤害降低”统一使用 `receivedDamageReduction`：同一目标的数值相加后用 `1+总值` 作分母。比如马格努斯盾 10% 加修拉全军 20%，盾伤害除以 `1.30`；格里高利盾 20% 加烈晶盾牌 51%，盾伤害除以 `1.71`。弗雷德下一回合的敌军造成伤害降低使用独立 `enemyOutgoingDamageReduction`，与目标承伤分母分别相乘。

## 逐英雄规则

| 代数 | 英雄 | 技能 1 | 技能 2 | 技能 3 |
| --- | --- | --- | --- | --- |
| S9 | 马格努斯（盾） | 全军 `heroAttackBonus +25%` | 每次盾主攻尝试独立 40% 判定；成功时全军 `heroDefenseBonus +50%`，立即生效至当轮结束，闪避仍判定 | 盾 `receivedDamageReduction +10%`；射手 `commonDamageIncrease +10%` |
| S9 | 弗雷德（矛） | 敌全军穿透属性因子 `/1.20` | **仅敌盾** `vulnerability +20%` | 第 4/8/12… 次矛主攻尝试，当轮原目标 `2B`；敌全军下一回合 `enemyOutgoingDamageReduction +20%`；闪避仍计数与触发 |
| S9 | 修拉（射） | 全军 `receivedDamageReduction +20%` | 第 2/4/6… 次射手主攻尝试，当轮原目标 `1B`；原目标下一回合 `vulnerability +25%`；闪避仍计数与触发 | 射手 `receivedDamageReduction +15%`、`commonDamageIncrease +10%` |
| S10 | 格里高利（盾） | 全军 `heroAttackBonus +15%`、`heroDefenseBonus +10%` | 各兵种每次主普攻通过闪避后独立 25% 判定；触发仅该次 `normalAttack ×2` | 盾 `receivedDamageReduction +20%` |
| S10 | 芙蕾雅（矛） | 敌全军攻击属性因子 `/1.20` | 仅矛普通主攻**成功命中后**独立 50% 判定；成功对原目标 `1B`；闪避时不判定 | 盾/射各 `receivedDamageReduction +15%`、`commonDamageIncrease +15%`；矛不受此伤害增益 |
| S10 | 布兰琪（射） | 全军 `heroPenetrationBonus +25%` | 自然 R3/R6/R9… 射手对当前目标 `0.75B`；先前闪避不改变周期 | 每 2 次射手主攻尝试，敌矛 `0.40B`、敌射 `0.20B`；两目标独立结算，缺目标取消对应事件 |

这些 `kB` 均是 `skillDamage/extraDamage`；不增加主攻击次数，不生成 `additionalAttack`。格里高利暴击是普通攻击事件的倍率，不生成独立伤害事件。S6 韦恩“电光石火”原代码与本次“复用韦恩普通攻击暴击模板”的新口径冲突，已统一为普通攻击暴击；韦恩与格里高利共用 `normalAttackCritical` 效果模板。韦恩二技能与布兰琪三技能共用 `wayneFlankingDamage` 双目标效果模板及同一个闪避前计数/派生事件运行路径。这项 S6 行为变更需要后续原始战报复核。

## 实现位置与验证

- 定义及数据：`src/pvp/heroSkills/definitions/s9Heroes.ts`、`s10Heroes.ts`、`s6Heroes.ts`、`generationHeroBuilders.ts`、`data/expeditionHeroes.ts`。
- 公共攻击钩子和技能运行时：`src/pvp/round/actionPhase.ts`、`src/pvp/heroSkills/resolveHeroSkills.ts`、`types.ts`。
- 技能事件和乘区：`src/pvp/damage/createDamageEvent.ts`、`src/pvp/effects/`；最终战报输入：`src/pvp/scenario/pureTroopScenario.ts`。
- `HeroSkillTraceEntry` 记录尝试、命中、闪避、技能专属计数与触发；普通 `DamageEvent` 记录 `B`、k、目标、分母、增减伤、取整及伤亡。示例由 `scripts/generate-s9-s10-rule-trace.ts` 生成至 `s9_s10_rule_trace.txt`。
- 回归包含马格努斯 100 次盾主攻中 20 次闪避仍有 100 次资格判定、弗雷德第 4 次与修拉第 2 次攻击被闪避仍产生 kB、芙蕾雅闪避后零判定、布兰琪自然周期和双目标拆分、S9/S10 六英雄最终战报专武不重复叠加。另有 S6 韦恩模板及 S8 全量回归。

后续优先收集带逐笔伤害与触发的原始战报，核对技能目标、取整、R3 周期被闪避时的独立伤害及韦恩暴击归类。现有测试验证代码遵循本次口径，不能推定真实游戏所有机制已经拟合。
