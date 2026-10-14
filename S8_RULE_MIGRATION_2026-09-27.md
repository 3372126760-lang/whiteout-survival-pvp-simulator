# S8 英雄技能确认规则与实现（2026-09-27）

本次用户规则覆盖此前 S8 的 provisional/tentative 时序及伤害解释。英雄远征技能默认 Lv5；战报明确为 Lv4 时按实际等级复现。下文的 **规则确认** 指用户给定的模型口径；原始 Sheet2/Sheet3 和 257 回合战报未保存在仓库，故不能将自动化回归当作独立实战复核。

## 共同伤害基础

```text
B_s = sqrt(N0) × sqrt(n_s) × C_damage,s × C_troopLevel,s
D_skill = k × B_s × Attack_s × Penetration_s / Defense_target
          × 适用的普通增伤、易伤、兵种克制、技能增伤和各独立减伤乘区
```

S8 所有 `extraDamage` 使用 `parentBaseDamage`，即主攻同一基础 `B×Attack×Penetration`，再乘技能系数 `k` 并按各目标重新进行防御及后续技能伤害结算。对其他目标重算有目标 scope 的攻穿属性。同源同目标同一时点的额外系数先合并：索妮娅 R10 的 `0.75B+2.50B=3.25B` 只生成一笔池化技能伤害；BattleTrace 保留两项来源。引擎中的 `baseDamage` 字段表示**尚未除目标防御、未经过后续伤害组**的 `B×Attack×Penetration`，因此其数值不是裸 `B`。

## 加托（盾）

| 技能 | Lv5 规则 | 代码位置 |
| --- | --- | --- |
| 黄金近卫 | 盾兵 `heroDefenseBonus+30%`，进入防御属性因子，不进入承伤降低或 HP | `src/pvp/heroSkills/definitions/s8Heroes.ts` |
| 列王恩赐 | 每次完成盾兵主攻击后触发；`X=100×Ct×√当前盾兵数×(1+A_report)`，Lv5 `S=0.30X`、Lv4 `S=0.24X`；**下一回合**生效 1 回合，同一来源按新值替换旧盾；眩晕跳过主攻时不触发 | `src/pvp/heroSkills/gatotShield.ts`、`src/pvp/heroSkills/resolveHeroSkills.ts`、`src/pvp/casualty/resolvePendingDamage.ts` |
| 王者之师 | 敌全军攻击属性按 `enemyAttackReduction+25%` 作为英雄技能层分母；不改变加托护盾使用的 `A_report` | `src/pvp/heroSkills/definitions/s8Heroes.ts` |

R1 开始无加托护盾；R1 主攻产生 R2 待生效盾。R2 承伤时仍使用 R1 生成的盾；R2 主攻另排队 R3 的新盾，两层不会在同一事件叠加。R2 结束时旧盾过期，R3 新盾生效。`A_report` 已含战报层外部 Buff/Debuff，不再重复乘城镇、宠物、专家、专武，且不含书允或索妮娅的英雄技能攻击层。

## 索妮娅（矛）

| 技能 | Lv5 规则 | 代码位置 |
| --- | --- | --- |
| 宝藏猎人 | 全军普通增伤 `commonDamageIncrease+20%`，按 scope 作用于普攻和技能伤害 | `src/pvp/heroSkills/definitions/s8Heroes.ts` |
| 赏金诱惑 | 每完成 2 次矛兵主攻击触发；当前攻击立即产生 `0.75B` 的 `skillDamage/extraDamage`；全军 `heroAttackBonus+25%` 在**下一回合**生效 1 回合，本次 `0.75B` 不吃刚触发的加成 | `src/pvp/heroSkills/definitions/s8Heroes.ts`、`src/pvp/heroSkills/resolveHeroSkills.ts` |
| 激流冲击 | 按自然回合 R5/10/15…，完成当轮矛主攻后对实际命中栈造成 `2.50B`；目标下一回合 `skipNextRoundAction`，仅该兵种栈跳过主攻 | 同上 |

攻击被控制时，赏金诱惑的两次主攻计数延后；激流冲击仍按自然回合判定。用户提供的长回合计数 `257-51=206` 已纳入回归：51 次激流冲击让加托盾兵少完成 51 次主攻击，故加托二技能触发 206 次。

## 亨德里克（射）

| 技能 | Lv5 规则 | 代码位置 |
| --- | --- | --- |
| 蝙虫之噬 | 敌军全军防御属性 `enemyDefenseReduction+25%`，防御因子除以 1.25；不作为易伤或独立伤害增益 | `src/pvp/heroSkills/definitions/s8Heroes.ts` |
| 藤壶之铠 | 自然回合 R5/6、R9/10、R13/14… 全军 `heroDefenseBonus+30%`；与加托黄金近卫在盾目标上同组加算为 `1+0.30+0.30=1.60` | 同上 |
| 大森之嗣 | 自然回合 R3/6/9…，射手完成主攻击后向每个仍存活的敌军兵种栈各生成 `0.40B` 的 `skillDamage/extraDamage`，各自计算目标防御和减伤 | 同上 |

## 最终战报模式与日志

`finalReport` 直接使用已含英雄静态属性与外部 Buff 的战报四属性。构造该模式的阵容时将专武运行等级设为 0，避免加托、索妮娅、亨德里克场景专武效果再次叠加；远征战斗技能仍启用。预测模式继续按配置加载专武。

BattleTrace 输出加托的触发回合、生效回合与完整 `X` 输入；索妮娅的完成矛主攻计数、赏金系数及攻击 Buff 生效回合、激流触发回合与目标眩晕回合；亨德里克的自然周期、多目标系数，以及每笔受击事件的 `heroDefenseBonus` 来源。[S8 合成运行日志](s8_rule_trace.txt) 展示 R10 的 `0.75B+2.50B` 池化；专项回归位于 `src/pvp/tests/s7ToS9Heroes.test.ts`；全量技能数据见 [hero_skill_inventory.md](hero_skill_inventory.md)。
