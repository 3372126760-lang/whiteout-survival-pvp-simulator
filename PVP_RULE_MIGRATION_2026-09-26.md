# PVP 规则基线迁移：旧实现 → 新实现

> 本文记录 2026-09-26 的历史迁移。加托护盾与烈晶盾牌、炽红力场的结算口径已被 [2026-09-27 最新迁移](PVP_RULE_MIGRATION_2026-09-27.md) 覆盖；以下对应旧数值仅供回溯，不得用于当前模拟。

日期：2026-09-26。依据本次用户提供的最新确认规则。**本次“确认”指项目规则基线已指定；自动化测试验证的是代码行为，不能代替真实游戏战报。** 完整逐级英雄数据库见 [hero_skill_inventory.md](hero_skill_inventory.md)，数学推导和优先问题见 [PVP_MODEL_CORE_AND_HERO_SKILLS.md](PVP_MODEL_CORE_AND_HERO_SKILLS.md)。

## A. 完整伤害公式

```text
N0 = min(双方开战实际初始总兵数)                 // 整场固定
n_s,r = 回合 r 开始时攻击兵种 s 的存活兵数快照
B_s,r = sqrt(N0) × sqrt(n_s,r) × K_s × C_level,s
K_盾/矛/射 = 1 / 3 / 4
A_s = 攻击方 s 的最终攻击因子
P_s = 攻击方 s 的最终穿透因子
D_t = 实际受击目标 t 的最终防御因子

raw_normal = B_s,r × A_s × P_s × M_baseAttackSpecial
raw_skill  = k × B_s,r × A_s × P_s × M_baseAttackSpecial

modified = raw × M_common × M_vulnerability × M_counter × M_eventType
           × M_defenseReduction × M_directCancellation
           / (D_t × M_received × M_outgoing × M_eventTypeReduction
              × M_baseDefenseSpecial)
rounded = Math.round(modified)      // 每个独立事件或聚合后技能池取整一次
```

其中 `M_eventType` 对普攻为普攻专属增伤，对 `skillDamage/extraDamage` 为技能专属增伤。`M_baseAttackSpecial` 如火焰冲击的 `×1.06`，`M_baseDefenseSpecial` 如光铸之躯的 `/1.06`；这些是带 effect ID 的具体来源。`M_defenseReduction` 是引擎当前既有独立事件组，战报仍需检验。玩家防御只在其受击时作为 `D_t`；任何一方的防御均不进入自身输出，也不进入 HP。

## B. 正式 group 映射

| 功能 | 正式 group / effectKind | 聚合与适用范围 |
| --- | --- | --- |
| 通用普通增伤 | `commonDamageIncrease` / `damageIncrease`、`decayingDamageIncrease` | 同组加算，按 scope 可同时作用普攻与技能 |
| 普攻专属增伤 | `normalAttackDamageIncrease` | 只作用 `normalAttack` |
| 技能专属增伤 | `skillDamageIncrease` | 只作用 `skillDamage`，包括 `extraDamage` |
| 易伤 | `vulnerability`、其他有名 `incomingDamageIncrease` 组 | 目标 scope 后同组加算 |
| 兵种克制 | `troopCounterDamage`、`troopVsTroopDamage` | 与通用增伤异组相乘 |
| 目标承伤降低 | `receivedDamageReduction` / `damageReduction` | 全军与指定兵种先按目标筛选再同组加算 |
| 攻击方造成伤害降低 | `enemyOutgoingDamageReduction` 等 / `outgoingDamageReduction` | 与目标承伤组相乘 |
| 普攻/技能免伤 | effect scope 的 `damageType` | 只作用对应事件；具体 group 保留来源名 |
| 英雄攻防穿血属性 | `heroAttackBonus`、`heroDefenseBonus`、`heroPenetrationBonus`、`heroLifeBonus` | 各属性同组加算，异组相乘 |
| 敌方英雄属性减益 | `enemyAttackReduction` 等 | 同组加算后作为该属性因子的除数 |
| 外部属性 Buff | `buffAttack`、`buffDefense`、`buffPenetration`、`buffLife` | 预测模式计算；最终战报模式由输入值承担 |
| 基础攻/防特殊倍率 | `baseDamageMultiplier`、`baseDefenseMultiplier` | 特殊来源单列 BattleTrace |
| 直接抵消 | `directDamageCancellation` | 烈晶盾牌 `crystalShieldDirectCancellation` 与矛兵 `crimsonFieldDirectCancellation` 不合组 |
| 临时护盾 | `temporaryShield` | 取整后、HP 前吸收，不是减伤倍率 |

## C. 废弃的旧口径

| 旧实现或术语 | 新实现 |
| --- | --- |
| `HP_unit=C_hp×C_level×Defense×Life` | `HP_unit=C_hp×C_level×Life` |
| 伤害公式不含目标防御 | 每笔使用实际目标 `Defense_t` 作分母 |
| `skillDefenseBonus` / `defenseModifier` 作独立减伤除数 | 普通防御技能归 `heroDefenseBonus` 属性组；遗留 `defenseModifier` 输入会抛错 |
| `baseDamageIncrease` | `commonDamageIncrease`；在 Trace 接受旧名作为历史别名 |
| `normalAttackDamageIndependent` | `normalAttackDamageIncrease`；在 Trace 接受旧名作为历史别名 |
| 菲兰德二技能每回合仅判一次 | 每个存活兵种每次主攻击单独判定 |
| 琳恩三技能三层上限 | 无层数上限，持续到战斗结束 |
| 赫克托二技能只增普攻 | `commonDamageIncrease`，按范围覆盖普攻与技能事件，主攻后衰减 |
| 同目标同时点技能子事件各自走乘区并取整 | 相同父基础 B 的系数先汇总，一个技能事件结算 |
| 最终战报值再次叠英雄静态、城镇、宠物、专家、专武 | 最终战报模式直接用报告数值；预测模式才叠外部来源 |
| 容量 Buff 进入伤害倍率 | 容量只先改变实际入场人数 |

## D. 攻防穿血属性流程

`F_x=F_report,x×F_external,x×F_hero,x/F_enemyHeroDebuff,x`，四项对称。最终战报模式的 `F_external=1` 且英雄静态修正为零；预测模式计算阵容静态和外部 Buff。普通英雄远征技能不回写报告面板，仍在战斗事件解析时生效。生命用于单兵 HP；攻击与穿透用于出手基础量；防御用于受击事件分母。`heroDefenseBonus` 可带来袭兵种条件，例如钢铁守护只在盾受矛击时有效。

## E. 普攻、技能与时序

开战实际人数 → `N0` → 回合开始 `n_s` 快照 → 行动选中目标 → 基础 B、攻穿和基础攻击特殊修正 → `normalAttack` 主事件及技能额外草稿 → 符合池条件的技能系数合并 → 每事件目标防御、增伤/易伤/克制、承伤及输出降低、专属免伤、特殊系数和直接抵消 → 取整 → 回合末护盾/HP/伤亡。`additionalAttack` 意味着真正多一次出手；`extraDamage` 不增加主攻计数。韦恩 R4/8… 每个存活兵种按自己的当前目标独立一笔；韦恩二技能矛 `0.4B`、射 `0.2B` 分开。

## F. 护盾与直接抵消

烈晶盾牌 FC10 成功时事件伤害 `×0.49`；炽红力场成功时独立事件 `×0.5`，两者各有来源 group。取整后对临时护盾 `S` 应用 `absorb=min(S,D)`，`S'=S-absorb`，进入 HP 的伤害 `D-absorb`；后续事件可继续消耗剩余盾。加托盾兵每次主攻击产生的新盾按同一 layer ID **replace** 旧剩余量。其 `rawDamage×0.30` 容量仍为暂定拟合式。

## G. 最终战报模式输入

每方盾/矛/射实际初始兵数、等级或混级组成、战报最终攻击/防御/穿透/生命、上阵英雄及车头/车身位置、远征技能等级、适用场景和触发设置。城镇、宠物、专家、专武属性、英雄静态属性和容量 Buff 已包含在实际战报数值或兵数中，不再次输入或叠加。

## H. 预测模式输入

每方基础属性、基础兵数和等级组成、阵容、城镇/宠物/专家/专武属性 Buff/Debuff、出征或集结容量比例、集结配比、战斗场景。容量先按实际入场人数取整和分配，再计算 `N0`；专武属性归外部 Buff 层。

## I. 修改位置与技能

| 范围 | 本次迁移 |
| --- | --- |
| `src/pvp/formulas/hp.ts`、`damage/createDamageEvent.ts`、`effects/attributeModifiers.ts` | 移除防御计入 HP；受击目标防御进入事件分母；解析条件型属性效果 |
| `round/actionPhase.ts`、`logging/battleTrace.ts`、`types/damage.ts` | 同目标技能伤害池、系数与来源；扩展公式、属性、特殊系数、护盾/HP 追踪 |
| `scenario/pureTroopScenario.ts`、`validationUi/*`、`ui/*` | 最终战报/预测模式、人数容量、输入展示及避免属性重复计入 |
| `heroSkills/definitions/s1Heroes.ts`、`s2Heroes.ts`、`generationHeroBuilders.ts` | 津曼、菲兰德及后续英雄普通防御技能改入防御属性组 |
| `heroSkills/definitions/s2Heroes.ts`、`s4Heroes.ts`、`s5Heroes.ts`、`resolveHeroSkills.ts` | 菲兰德逐兵种主攻判定、琳恩无限层、赫克托通用增伤衰减、韦恩实际目标基础量、芮妮伤害池系数、加托护盾 replace |
| `troopSkills/definitions/shield.ts`、`resolveTroopSkills.ts` | 钢铁守护条件型防御属性；兵种技能额外伤害系数进入聚合信息 |
| `heroSkills/definitions/s1Heroes.ts`～`s15Heroes.ts`、`troopSkills/definitions/*` | 全面使用 `commonDamageIncrease`、`normalAttackDamageIncrease` 新组名 |
| `heroSkills/data/expeditionHeroes.ts`、生成脚本及 Markdown | 更新目录描述、全量技能报告和数学交接文档 |

## J. 真实战报待验证

优先验证完整攻穿防公式和四属性面板可见性；加托护盾容量及触发时点；技能伤害池可否跨不同技能共享同一结算；特殊基础攻防倍率的精确位置；菲兰德、琳恩、赫克托、韦恩周期时序；T12 缺失等级常数、T12 技能；混级伤亡分配与整场战报拟合。`hero_skill_inventory.md` 中严格 `confirmed/provisional/unverified` 标签按已有原始证据文字判定，不能把代码回归当外部实测。

## K. 回归检查索引

| 规则 | 现有测试 |
| --- | --- |
| 纯盾对战、目标防御进入分母、生命不含防御 | `latestRulesMigration.test.ts`；`battleEngine.test.ts` |
| 盾受矛击钢铁守护防御 +10% | `finalTroopRules.test.ts`；`confirmedTroopSkills.test.ts` |
| 全军承伤 20% + 盾 25%、矛 20%；攻击方降低另乘 | `latestRulesMigration.test.ts` |
| 玲奈普攻专属增伤不传给独立技能伤害 | `s4RuleUpdate.test.ts`；`s6RuleUpdate.test.ts` |
| 炎晶战矛 + 芮妮同目标 `k=3` | `latestRulesMigration.test.ts` |
| 菲兰德三兵种各 1500 次判定 | `attributeAndS1S2RuleSync.test.ts` |
| 琳恩超过三层、赫克托逐次 ×0.85 | `s4RuleUpdate.test.ts`；`s5RuleUpdate.test.ts` |
| 韦恩 R4/8 每存活兵种独立事件、二技能矛射分开 | `s6RuleUpdate.test.ts` |
| 火焰冲击 + 燃晶火药 `0.875B` 一事件 | `confirmedTroopSkills.test.ts`；`finalTroopRules.test.ts` |
| 加托临时护盾覆盖刷新与 HP 前吸收 | `s7ToS9Heroes.test.ts` |
| 最终战报不重复外部属性；容量只改变人数、N0、n | `latestRulesMigration.test.ts`；`validationUi.test.ts` |

执行：`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd test -- --testTimeout 15000`、`npm.cmd run build`。
