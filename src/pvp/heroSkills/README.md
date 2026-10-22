# PVP 英雄远征数据与技能

英雄模块不建立独立战斗引擎。英雄技能编译为现有 `ActiveEffect`，并通过
`DamageEvent`、scope/group、注入式 RNG 和 `BattleTrace` 接入回合引擎。

## 数据边界

- `data/expeditionHeroes.ts` 只保存英雄所属兵种、远征攻/防/穿/血和远征技能元数据。
- S1～S9 专武基础穿透/生命按 Lv0-Lv10 线性计算；专武技能使用 Lv2/4/6/8/10 阶梯。
- 探险属性、护卫属性和探险技能不进入 PVP 数据。
- `combatRelevant: false` 的远征技能仅供展示，不生成运行状态、效果或战斗日志。
- 默认远征技能等级是 5；未确认的等级值不会补猜。

## 阵容与属性修正

- 盾/矛/射各允许一名车头，启用全部已确认的 `combatRelevant` 远征技能。
- 车身必须由调用方显式指定技能，且只能选择远征技能 1。
- 车身按精确英雄来源绑定一技能；专武等级固定为 0，不装载专武技能、二三技能，也不提供静态属性。
- 单方最多接受 4 个车身战斗技能。
- 最终战报模式直接采用战报四属性和实际兵数，不重算英雄静态、专武或城镇/宠物/专家 Buff。
- 预测模式才使用 `heroStatCorrection`，模拟阵容贡献只统计车头英雄及其专武：
  `sim = report - reportHeroAndWeaponContribution + simulationLeaderAndWeaponContribution`。

## 已确认机制

- 谢尔盖、巴希提、杰西的受到伤害降低使用 `receivedDamageReduction`。
- 谢尔盖/凌霜减攻与卢姆·波根减穿使用属性减益：同组先加算，再按
  `(1 + buffedAttribute) / (1 + groupSum)` 结算。
- 亨德里克减防使用独立 `defenseReduction`，不与
  `incomingDamageIncrease`（易伤）混用。
- 帕特里克生命效果在首回合快照前计算最大生命；不支持战斗中动态生命重算。
- 巴希提不稳定力场在每个存活兵种主攻击前独立判定一次；成功时产生基于主攻击基础伤害 B×50% 的独立 skillDamage/extraDamage。连射第二段不重新判定或追加巴希提子事件。
- S1～S9 场景专武技能显式匹配 `rallyAttack/rallyDefense/garrisonDefense`；
  `buffAttack/buffDefense/buffPenetration/buffLife` 与大药、宠物等同属性普通外部 Buff 同组相加，再统一作为外部 Buff 乘区构建预期属性；不在结果后加百分点，不将普通 Buff 与专武 Buff 乘乘。
- 赫罗尼莫周期增伤从第 5 回合开始，按每 4 回合中的前 2 回合生效。
- 娜塔莉亚、茉莉的全军回合减伤每回合只判定一次；茉莉冰雪领域按兵种独立判定。
- S1 的剑盾、同心、改装发射器、过载压力钉枪属于英雄本体/探索侧，不进入 PVP。
- 菲兰德强化药剂按每个兵种正常攻击独立判定；连射第二击不重复判定。
- 攻击触发且未写明“敌军全体”的 Debuff 默认挂到 `hitTargetTroop`。
- 阿隆索钢铁意志即时作用于命中目标栈，持续两回合并保持单份 50% 幅度。
- 所有刷新语义均为覆盖旧状态、不叠加幅度，并从本次触发重新计时。
- `buffAttack/buffDefense/buffPenetration/buffLife` 属于预测模式的外部 Buff 层；
  普通英雄远征技能属性属于 `heroAttackBonus/heroDefenseBonus/heroPenetrationBonus/heroLifeBonus`。
  防御在受击伤害分母，不进入 HP；生命进入 HP。
- 菲兰德强化药剂每兵种每次主攻击独立判定；琳恩攻击叠层无上限；赫克托衰减增伤属于 `commonDamageIncrease`。
- 加托临时护盾按 `X=100×Ct×√当前盾兵数×(1+A_report)` 计算；Lv5 取 `0.30X`，Lv4 取 `0.24X`，每次盾兵主攻击后触发、下一回合生效并覆盖刷新。
- S8 赏金诱惑的 `0.75B` 当轮结算、攻击 +25% 下一回合生效；激流冲击按自然 R5/10… 触发。亨德里克藤壶之铠按自然 R5/6、R9/10… 加入 `heroDefenseBonus`，大森之嗣按 R3/6/9… 逐存活目标结算 `0.40B`。
- S9 马格努斯、弗雷德、修拉的指定技能使用主攻尝试时点；闪避不回滚其判定和计数。马格努斯防御即时作用于当轮剩余阶段；弗雷德仅使敌盾易伤，弗雷德/修拉分别按 4/2 次尝试产生 `2B`/`1B` 并预约次轮效果。指定承伤降低统一进入 `receivedDamageReduction`。
- S10 芙蕾雅只在矛普攻命中后判定 `1B`；布兰琪二技能固定自然 R3/6/9…，三技能与韦恩二技能共用双目标效果生成器。格里高利与韦恩共用普通攻击暴击效果模板，触发时仅该次普攻 ×2，不创建技能伤害事件。
- S11 埃莱奥诺拉三技能按盾兵 `mainAttackAttempt` 每 5 次计数，闪避仍计、眩晕未出手不计，次轮起增伤与承伤降低持续 2 回合；二技能盾兵承伤降低归入 `receivedDamageReduction`。
- S11 劳埃德二技能按自然 R3/6/9… 生效，当轮矛兵 `commonDamageIncrease` +150% 且敌方全军穿透降低与一技能同组加算；三技能逐自然回合独立判定穿透属性加成。
- S11 鲁弗斯二技能仅射手普攻命中后生成 `0.6B` 技能额外伤害及本次目标次轮易伤；三技能按盾、矛、射主攻击尝试分别判定，目标穿透减益覆盖刷新、不叠幅。
- S3 罗根、米娅、格雷格及其场景专武已接入；米娅厄运缠身只对实际命中栈
  预约下一回合易伤。格雷格律令震慑完整复用鲁弗斯暴烈震爆：各兵种主攻击尝试独立20%判定，
  当前目标穿透降低10/20/30/40/50%，立即持续2回合、覆盖刷新；闪避保留，跳过行动不判定。
- S7～S9 已接入目标绑定 Poison、下一回合整次行动跳过、当回合即时防御、
  周期防御和每个存活敌军栈独立生成 `extraDamage` 的通用 Runtime 能力。
- `temporaryShieldHp` 是兵种栈的独立护盾层，按伤害事件顺序先于 troop HP 承伤；
  艾丽芙③直接复用加托②护盾模板。S12～S16 技能统一标记为 `inferredFromPriorGenerations` / `TENTATIVE`，待真实战报验证。

## Remaining RULE_UNKNOWN

仅保留以下规则占位：

1. `futureEffectActivationTiming`
2. `targetingOverrideConflictPrecedence`
3. `reservedTriggerScheduling`
4. `complexInitiativeOrdering`

兵种等级改为明确枚举；T12 仅支持 FC7～FC10。混等兵采用初始比例与独立向上取整，
等级明细取整差额和内部守恒记账的区别见 `docs/pvp-troop-level-rules.md`。

## S12～S16 TENTATIVE

2026-10-17：芮妮惊梦留痕重复来源的延迟伤害合并为 `m+1 B`（m≥1），
重复规则标记为 BATTLE_REPORT_SUPPORTED / PROVISIONAL。各 runtime 仍分别计数，
1500次有效矛攻的战报次数为 `750×m`；下一回合伤害结算不再另算一次施加技能。
条件标记不叠层，二、三技能仅判断标记存在。单来源2B、目标绑定、闪避与眩晕机制保持原样。
自动车身搜索仍最多同效果2份，手动配置可包含Head+四Body共5份。
详见 `docs/renee-duplicate-source-audit.md`。

- 艾丽芙·绫绮之幕：复用加托②；盾兵完成主攻击后预约下一回合护盾，Lv5 容量为 `30 × troopConstant × sqrt(当前盾兵数) × (1 + 战报盾兵攻击)`，覆盖刷新。
- 其余 S12～S16 技能、模板来源和证据边界见根目录 `S12_S16_RULE_MIGRATION_2026-09-27.md`。
