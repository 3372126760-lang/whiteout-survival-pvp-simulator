# S11 英雄技能规则迁移（2026-09-27）

本文记录用户最新确认的 S11 远征 PVP 口径及当前代码实现。S8～S10 的公共属性组、`DamageEvent`、生命周期、主攻击尝试与命中判定、kB 伤害和最终战报输入模式沿用现有引擎。**用户确认的规则、模拟器回归通过、真实游戏战报验证是不同的证据。**本文附带的 BattleTrace 是程序生成的合成战斗，不能据此声称已完成真实战报拟合。

## 通用判定与数学乘区

`mainAttackAttempt` 表示兵种实际发起一次主攻击，普通攻击随后被闪避仍成立；眩晕或跳过行动而未发起主攻击时不成立。`successfulNormalAttackHit` 还要求这次普通攻击没有被闪避。盾、矛、射的独立判定由各自主攻击驱动，额外伤害事件不增加主攻击次数。

基础量 `B_s=√N0×√n_s×C_damage,s×C_troopLevel,s`，其中 `N0` 为双方实际开战总兵数较小值，`n_s` 为回合开始快照中的出手兵种兵数。鲁弗斯二技能的 `0.6B` 从 `parentBaseDamage` 产生独立 `skillDamage/extraDamage`，然后经过攻击、穿透、实际目标防御、通用增伤、易伤、技能增伤及对应减伤乘区；不再从已结算的普通攻击伤害乘 `0.6`。

源码把用户文字中的 `baseDamageIncrease` 归入现用 `commonDamageIncrease` 组：同一 scope 下覆盖 `normalAttack`、`skillDamage` 和 `extraDamage`。同组先将幅度相加：例如盾兵索拉里斯方阵的承伤降低 10% 与腾焰飞芒的 25% 同时生效时，承伤分母为 `1+0.10+0.25=1.35`。劳埃德一技能的敌方穿透降低 20% 与二技能周期窗口内的 30% 同组，分母为 `1.50`；再对同一目标叠加鲁弗斯三技能的 50% 时，该目标分母为 `2.00`，其他目标仍按各自状态结算。

## 三名英雄（默认远征技能 Lv5）

| 英雄 | 技能 | 触发、生效与持续 | 数值、范围与现用组 | 实现 |
| --- | --- | --- | --- | --- |
| 埃莱奥诺拉（盾） | 烈日威光 | 常驻 | 全军生命 +25%，`heroLifeBonus`，影响单兵最大 HP / 兵堆 HP | `src/pvp/heroSkills/definitions/s11Heroes.ts` |
| 埃莱奥诺拉 | 索拉里斯方阵 | 常驻 | 盾兵承伤降低 10%，`receivedDamageReduction`；射手伤害 +10%，`commonDamageIncrease` | 同上 |
| 埃莱奥诺拉 | 腾焰飞芒 | 每完成第 5、10、15… 次盾兵主攻击尝试后预约；次轮开始生效，连续 2 回合；重触发覆盖刷新 | 全军伤害 +25%，`commonDamageIncrease`；全军承伤降低 25%，`receivedDamageReduction` | 同上及 `resolveHeroSkills.ts` |
| 劳埃德（矛） | 群鸟侵扰 | 常驻 | 敌军全体穿透降低 20%，`enemyPenetrationReduction` | `src/pvp/heroSkills/definitions/s11Heroes.ts` |
| 劳埃德 | 冰雾爆弹 | 自然回合 R3/R6/R9… 当轮生效，不按攻击次数计；只持续当前回合 | 矛兵伤害 +150%，`commonDamageIncrease`；敌军全体穿透再降低 30%，`enemyPenetrationReduction` | 同上 |
| 劳埃德 | 机巧万变 | 每自然回合开始独立 40% 判定；成功仅当前回合生效，下回合重新判定 | 全军穿透 +50%，`heroPenetrationBonus`，不叠层 | 同上及 `resolveHeroSkills.ts` |
| 鲁弗斯（射） | 火焰战团 | 常驻 | 全军攻击 +25%，`heroAttackBonus` | `src/pvp/heroSkills/definitions/s11Heroes.ts` |
| 鲁弗斯 | 碎甲一击 | 射手普通主攻击**成功命中**后，立即生成伤害，向本次目标预约次轮 1 回合易伤 | 对命中目标额外 `0.6B`，`skillDamage/extraDamage`；该目标次轮易伤 +25%，`vulnerability` | 同上及 `resolveHeroSkills.ts` |
| 鲁弗斯 | 暴烈震爆 | 每个盾、矛、射主攻击尝试分别独立 20% 判定；成功对本次 `currentTarget` 即时施加，持续 2 回合；同目标重触发替换并刷新 | 目标穿透降低 50%，`enemyPenetrationReduction`；不同目标独立维护 | 同上及 `resolveHeroSkills.ts` |

埃莱奥诺拉三技能与鲁弗斯三技能不受普通攻击闪避取消，但眩晕导致未出手则没有计数/判定。鲁弗斯二技能受闪避和眩晕取消：不生成 `0.6B`，也不预约易伤。鲁弗斯三技能沿用当前目标状态覆盖模板，同目标不叠成 100%；其即时生效时序保持原有定义。本次用户规则未另行指定其跨回合改为延后生效。

## 最终战报与专武

最终战报输入已经包含英雄静态属性、城镇、宠物、专家、专武属性或专武 Buff 等面板来源，运行时不再重复叠加埃莱奥诺拉专武生命、劳埃德专武攻击、鲁弗斯专武攻击及三人静态属性；仍独立加载上表未显示在战报面板中的远征战斗技能。预测模式根据基础面板另行构造属性。专武场景定义仍保留于 `S11_WEAPON_SKILL_DEFINITIONS`，供相应输入模式使用。

## 回归与 BattleTrace

专项测试位于 `src/pvp/tests/s11RuleUpdate.test.ts`，覆盖第 5 次盾主攻被闪避仍计数、眩晕不计数、R6/R7 生效窗口、生命与承伤组、劳埃德 R3/R6 周期和逐轮穿透判定、鲁弗斯二技能命中/闪避/眩晕、三技能闪避后判定/眩晕跳过/同目标刷新/不同目标独立、穿透减益同组以及最终战报去重。相关旧断言已在 `src/pvp/tests/s10ToS15Heroes.test.ts` 更新。

完整合成运行日志见 [s11_rule_trace.txt](s11_rule_trace.txt)，生成脚本为 [generate-s11-rule-trace.ts](scripts/generate-s11-rule-trace.ts)。日志有 7 个自然回合，记录双方行动、技能判定、伤害乘区、目标防御、取整、护盾/HP 与伤亡；其中 R5 盾主攻被闪避但计数达到 5，R6/R7 触发全军 Buff，R1 射手被闪避使碎甲一击不触发，暴烈震爆对目标刷新时显示 `refreshedExistingState=true`。日志里的若干闪避与技能成功由脚本定向注入，所以 `violentBlastRoll=n/a` 代表强制判定，并非漏做随机判定。

## 尚需外部验证

原始逐事件游戏战报仍需验证 S11 的具体数值拟合、同组边界、技能生效瞬间与伤亡取整。未收集的非 Lv5 数值保持未验证，不能按 Lv5 线性外推。T12 及 T12-FC1～FC5 常数继续标记 `RULE_UNKNOWN`。
