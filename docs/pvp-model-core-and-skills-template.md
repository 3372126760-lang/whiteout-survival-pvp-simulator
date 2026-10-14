# 《无尽冬日》PVP 底层模型与英雄技能数据库

更新日期：2026-10-06（本次仅更新专武外部 Buff 乘区）。本文按最新用户确认的规则整理；后面的全量英雄条目由当前源码生成。**规则已确认**、**代码回归通过**与**真实战报验证**是三种不同证据。历史库存的 `confirmed` 标签不自动证明每一级、时序和新公式已由原始战报复核。百分比在公式中均写为小数。

## 第一部分：PVP 底层数学模型

### 1. 初始兵数、回合快照和基础量

```text
N0 = min(A 方开战初始盾+矛+射兵数, B 方开战初始盾+矛+射兵数)  // 全场固定
n_s,r = 攻击兵种 s 在自然回合 r 开始时的存活兵数快照
K_s = 盾 1，矛 3，射 4
C_s = 对应兵种等级常数；混级时按仍存活等级的初始人数比例加权
B_s,r = sqrt(N0) × sqrt(n_s,r) × K_s × C_s
```

默认行动顺序为 A盾、B盾、A矛、B矛、A射、B射。同回合各行动读取回合开始快照，伤害事件排队，回合末才按顺序抵盾、扣血和结算伤亡。容量增益只在开战前改变实际兵数，继而改变 `N0`、`n_s,r` 和总 HP；**没有容量伤害乘区**。等级常数使用 32 个实际等级的显式表，基础 T11 已按 2026-10-01 口径删除，T12 仅支持 FC7～FC10。混兵四类明细按初始比例独立向上取整，差额与实际人口守恒的处理见 [兵种模型规则](pvp-troop-level-rules.md)。[createBattleState.ts](../src/pvp/battle/createBattleState.ts)、[actionPhase.ts](../src/pvp/round/actionPhase.ts)、[troopConstants.ts](../src/pvp/data/troopConstants.ts)。

### 2. 攻、防、穿、血四属性

令 `R_x` 为反推原始/基础层的百分比小数，`S_x` 为阵容静态修正，`A_x` 为当前官职加算，`E_x` 为城镇、宠物等普通外部 Buff，`D_x` 为外部 Debuff，`W_x` 为匹配场景的专武属性 Buff 小数，`H_x,g` 为其余英雄远征技能组，`Q_x,h` 为敌方英雄技能属性减益组。`x` 可以是攻、防、穿、血。同组先求 `Σ(value×stacks)`：

```text
ExternalBuffTotal_x = E_x + W_x
P_x = (1 + R_x + S_x + A_x) × (1 + ExternalBuffTotal_x) / (1 + D_x)
ExpectedReport_x = P_x − 1
F_x = P_x × Π其余英雄技能组g (1 + Σg) / Π敌方技能减益组h (1 + Σh)
普通 Buff 30% + 专武 Buff 15% = 外部 Buff 45%，对应乘区为 1.45
只有原始属性/修正/官职/减益均为 0 时，最终报告属性才恰好等于 45%
```

目标防御 `F_defense,target` 是**实际被命中的目标兵种**的防御因子；攻击方自己的防御不会进入其出手伤害。普通防御技能（津曼、菲兰德、加托、钢铁守护、马格努斯等）进入 `heroDefenseBonus` 防御属性组，并按目标及来袭兵种 scope 匹配。`skillDefenseBonus` 独立事件分母已废弃。`baseDefenseMultiplier` 只为明确的“基础防御力倍率”保留独立特殊除数。[attributeModifiers.ts](../src/pvp/effects/attributeModifiers.ts)、[createDamageEvent.ts](../src/pvp/damage/createDamageEvent.ts)。

**最终战报模式**默认采用最终战报四属性和实际初始兵数，令已体现在战报的城镇、宠物、专家、专武属性 Buff、英雄静态属性的额外修正为零；英雄配置只加载未显示在面板的动态战斗技能。**预测模式**从基础面板、阵容静态修正、外部 Buff/Debuff 和容量加成构造战斗输入。专武场景属性 `W_x` 与普通外部 Buff `E_x` 同组先加，再形成一个乘区；不能在报告结果后加百分点，也不能让普通 Buff 与专武 Buff 乘乘。静态专武属性差量仍单独归入 `S_x`。最终战报模式不再运行时重加。若预测输入本身已是最终战报值，也不能再叠加这些来源。[pureTroopScenario.ts](../src/pvp/scenario/pureTroopScenario.ts)、[adapter.ts](../src/pvp/validationUi/adapter.ts)。

加托二技能中的 `A_report` 精确指最终攻击因子中**非英雄远征技能部分**：最终战报模式直接读取盾兵的战报攻击加成；预测模式读取外部 Buff/Debuff 与阵容静态修正后的报告层值。书允攻击 +25% 和敌方英雄远征技能减攻仍作用正常伤害，但不进入加托护盾的自身攻击力 `X`。城镇、宠物、专家、专武等外部来源既已在 `A_report` 中，不额外再乘一次。

### 3. 最终伤害、事件分类与计算顺序

令 `A_s=F_attack,s`、`P_s=F_penetration,s`、`D_t=F_defense,t`。`M_common` 是 `commonDamageIncrease`；`M_counter` 是兵种克制；`M_vuln` 是目标易伤；`M_normal` 只覆盖 `normalAttack`；`M_skill` 只覆盖 `skillDamage`（包括 `extraDamage`）；`M_received` 是目标受到伤害降低；`M_outgoing` 是攻击方造成伤害降低；`M_typeReduction` 是普攻或技能专属免伤；`M_special` 为逐来源记录的特殊系数；`M_cancel` 为直接抵消。

```text
D_normal* = B_s × A_s × P_s / D_t
          × M_common × M_vuln × M_counter × M_normal
          / (M_received × M_outgoing × M_normalReduction)
          × M_special × M_cancel

D_skill*  = k × B_s × A_s × P_s / D_t
          × M_common × M_vuln × M_counter × M_skill
          / (M_received × M_outgoing × M_skillReduction)
          × M_special × M_cancel

D_event = Math.round(D_event*)
```

上述是规则结构。引擎另保留已有 `defenseReduction` 事件增伤组、`baseDamageMultiplier` 基础攻击修正及 `baseDefenseMultiplier` 基础防御特殊除数；它们各自带来源，**不能写成无来源的 `specialCoefficient`**。这些分组与真实游戏是否完全一致仍待战报拟合。执行顺序：开战属性/容量 → 回合快照 → 选中目标并确认主攻尝试 → 尝试型技能判定 → 普通攻击闪避判定 → 命中型技能判定 → `B` 与攻穿和基础攻击特殊修正 → 普攻及技能子事件草稿 → 同源、同目标、同时点、同基准技能系数汇总 → 逐事件按 scope 解析目标防御和增减伤 → 直接抵消 → 逐事件取整 → 回合末按事件顺序临时护盾吸收 → HP/伤亡。[multipliers.ts](../src/pvp/effects/multipliers.ts)、[createDamageEvent.ts](../src/pvp/damage/createDamageEvent.ts)。

`normalAttack` 是主攻击；`skillDamage/extraDamage` 是独立技能伤害事件，不增加主攻击次数；`additionalAttack` 只有真正额外出手时才成立；连射内部第二段仍属于同一主攻击。伤害池只合并同一主攻击来源、相同目标、结算时点和 `parentBaseDamage` 基准的技能额外伤害，例如炎晶战矛 `1B` + 芮妮梦痕 `2B` → 一笔 `k=3` 的技能事件，再统一走技能增伤/免伤和一次取整。目标或时序不同仍独立结算。[actionPhase.ts](../src/pvp/round/actionPhase.ts)。

S9/S10 最新口径：马格努斯、弗雷德、修拉按 `mainAttackAttempt` 判定或计数，普通攻击被闪避仍生效；芙蕾雅只在矛兵 `successfulNormalAttackHit` 后判定；布兰琪二技能按自然 R3/R6/R9…，与先前命中次数无关。格里高利和韦恩使用同一普通攻击暴击效果模板，触发时仅该次 `normalAttack ×2`。详细规则和回归见 [S9/S10 迁移说明](../S9_S10_RULE_MIGRATION_2026-09-27.md)。

S11 最新口径：埃莱奥诺拉腾焰飞芒按盾兵 `mainAttackAttempt` 每 5 次计数，闪避不取消，次轮起持续 2 回合；劳埃德冰雾爆弹按自然 R3/R6/R9… 生效，群鸟侵扰和冰雾爆弹的敌方穿透降低先同组加算；鲁弗斯碎甲一击只在射手 `successfulNormalAttackHit` 后生成 `0.6B` 及次轮目标易伤，暴烈震爆则逐兵种主攻击尝试独立判定，对各自目标施加可刷新但不叠幅的穿透减益。这里的通用伤害提升在代码中为 `commonDamageIncrease`，对应规则文字的 `baseDamageIncrease`。详细公式、时序和回归见 [S11 迁移说明](../S11_RULE_MIGRATION_2026-09-27.md)。

### 4. 血量、减伤、直接抵消与护盾

```text
HP_unit,t = C_hp,t × C_level,t × F_life,t
C_hp: 盾 300，矛 100，射 75
HP_total,t = 当前兵数 × HP_unit,t
```

**防御不计入 HP**；它只在该兵种受击时作为事件伤害分母。生命属性变化可重算单兵最大 HP，防御变化不会。所有文字为“受到伤害降低”的 effect 按目标 scope 加入同一个 `receivedDamageReduction` 组：全军 20% 加盾 25% 得盾分母 1.45，加矛 20% 得矛 1.40，射 1.20。攻击方造成伤害降低是独立的 `enemyOutgoingDamageReduction` 等组，和前者相乘。普攻/技能专属免伤仅匹配对应事件。[hp.ts](../src/pvp/formulas/hp.ts)、[resolvePendingDamage.ts](../src/pvp/casualty/resolvePendingDamage.ts)。

烈晶盾牌 FC10 触发时提供**受到伤害降低 51%**，单独分母 `1.51`；巴希提一技能 20% 同时生效时分母 `1+0.51+0.20=1.71`。炽红力场“伤害减半”按新确认口径记为同组承伤降低 50%，单独分母 `1.50`，与巴希提叠加为 `1.70`。三项若共同匹配同一事件，统一分母为 `2.21`。攻击方造成伤害降低 30% 属于另一组，与烈晶盾牌构成 `/1.51/1.30`。光铸之躯 FC10 的基础防御特殊 `/1.06` 与射手火焰冲击基础攻击特殊 `×1.06` 单列来源；燃晶火药与火焰冲击的追加系数仍是同一笔 `0.875B`。[shield.ts](../src/pvp/troopSkills/definitions/shield.ts)、[lancer.ts](../src/pvp/troopSkills/definitions/lancer.ts)。

临时护盾：`S'=max(0,S-D)`，`HPDamage=max(0,D-S)`；剩余护盾可挡同回合后续事件。加托二技能在每次盾兵主攻击后**触发、下一回合生效**，按新生成值覆盖上一层，不叠加。正式计算：`X=100×Ct×√n_shield,current×(1+A_report)`；Lv5 `S=0.30X`，Lv4 `S=0.24X`。默认英雄远征技能 Lv5，Sheet2/Sheet3 的实验复现显式设 Lv4。R1 无加托盾，R1 主攻产生 R2 护盾；若 R2 被眩晕而没有主攻，则不会排队 R3 新盾。艾丽芙三技能现复用同一护盾公式与时序，但其 S14 战报状态仍为 provisional。[gatotShield.ts](../src/pvp/heroSkills/gatotShield.ts)、[resolveHeroSkills.ts](../src/pvp/heroSkills/resolveHeroSkills.ts)、[resolvePendingDamage.ts](../src/pvp/casualty/resolvePendingDamage.ts)。

### 5. 正式乘区与旧名

| 现用 group / 机制 | 位置与适用范围 | 旧名或说明 |
| --- | --- | --- |
| `commonDamageIncrease` | 攻击侧，按 scope 覆盖普攻和技能 | 旧 `baseDamageIncrease`；“普通增伤”并非“普攻增伤” |
| `normalAttackDamageIncrease` | 攻击侧，仅 `normalAttack` | 旧 `normalAttackDamageIndependent` |
| `skillDamageIncrease` | 攻击侧，仅 `skillDamage/extraDamage` | 不作用普通攻击 |
| `vulnerability` / `incomingDamageIncrease` | 受击侧易伤 | 同组加算 |
| `troopCounterDamage`、`troopVsTroopDamage` | 兵种克制或特定兵种对兵种 | 与通用增伤异组相乘 |
| `receivedDamageReduction` | 受击侧通用承伤降低，按目标 scope | 巴希提、烈晶盾牌、炽红力场及指定兵种来源同组相加，再以 `1+总值` 作分母 |
| `enemyOutgoingDamageReduction` 等 | 攻击侧造成伤害降低 | 与目标承伤降低相乘 |
| 普攻/技能专属 reduction | 对应 DamageEvent 类型 | 适用范围由 effect scope 给出 |
| `heroAttackBonus/heroDefenseBonus/heroPenetrationBonus/heroLifeBonus` | 英雄技能属性层 | 防御旧 `skillDefenseBonus` 并入 `heroDefenseBonus` |
| `enemy*Reduction` | 敌方英雄技能属性减益 | 先同组加算，再作为属性除数 |
| `buffAttack/buffDefense/buffPenetration/buffLife` | 外部 Buff 属性层，预测模式 | 最终战报模式已含其值 |
| `baseDamageMultiplier`、`baseDefenseMultiplier` | 可溯源基础攻击/防御特殊系数 | 分别在基础伤害与特殊除数阶段 |
| `directDamageCancellation` | 引擎保留的通用机制，无当前烈晶/炽红定义 | 这两项旧直接抵消逻辑已移除 |
| `temporaryShield` | 伤害取整后的 HP 前容量层 | 不属于减伤乘区 |

## 第二部分：英雄技能数据库（全部已录入等级）

以下逐代数、英雄、技能展开：目录描述、等级原数值、完整 effect JSON、触发/时序/持续、范围、类型、乘区、代码位置和验证状态均保留。✅ 仅指库存文字有真实战报依据；⚠️ 为暂定或未验证。旧库存中尚未迁移的文字证据应以现用 effect 数据和本节规则为准。

<!-- HERO_DATABASE -->

## 第三部分：战报验证与证据边界

项目历史库存记有：阿隆索·钢铁意志约 20% 触发率及下回合穿透减益；玲奈·迅影舞步闪避主攻击；玲奈·影刃产生独立额外伤害；芮妮·惊梦留痕延时 `2B` 额外事件且不吃玲奈普通攻击专属增伤；韦恩·惊雷奇袭四回合周期独立事件。加托 `X=100×Ct×√n×(1+A_report)`、Lv4/5 系数、书允不进入 `X`、烈晶盾牌/炽红力场与巴希提同组，属于 2026-09-27 用户指定的实验结论，并已加回归测试。S9 马格努斯约 1500 次盾主攻中 604 次触发的统计由用户提供，原始战报未随仓库附上。韦恩暴击旧库存文字记为独立技能伤害，与本次 S10 复用韦恩普通攻击暴击模板的规则冲突；当前代码执行后者，旧证据不能再标成当前规则已验证。S11 新口径已按用户确认规则录入并通过代码回归，合成日志不能替代真实游戏战报。原始 Sheet2/Sheet3 表格未随当前仓库存档，后续仍应复核更广泛的实战条件。严格证据标签见全量表及 [技能库存](../hero_skill_inventory.md)。

## 第四部分：当前未解决问题（按优先级）

1. **高**：用真实逐事件战报拟合攻穿防、四属性来源分层、同组/异组边界与取整；当前通过的是模拟器回归，不等于游戏外部验证。
2. **高**：加托新护盾公式与承伤降低同组结算已按确认口径实现；仍需更多原始逐事件战报复核边界、首轮顺序和残盾。
3. **高**：T12 兵种技能继续进行真实战报拟合验证；实际等级与常数已按最新明确表修正，不存在等级不再作为待补常数。
4. **中**：周期、首轮、主攻击尝试与完成的时序边界；菲兰德、琳恩、赫克托、韦恩和 S8～S16 技能需逐回合战报核对，尤其韦恩暴击的新旧证据冲突。S12～S16 尚无可用 PVP 战报，全部标为 provisional。
5. **中**：S1～S16 部分目录仅录入 Lv5，缺失等级不插值；S16 专武数据未录入，专武阶梯、作用场景和英雄全量技能需继续收集原始数据。
6. **中**：预测模式外部 Buff 与游戏战报最终面板的映射、集结人数分配、混级兵堆伤亡及真实战报拟合误差。

S12～S16 的 provisional 数据、模板来源和 kB 边界见 [S12–S16 迁移](../S12_S16_RULE_MIGRATION_2026-09-27.md)；S11 的主攻尝试、命中、kB 与目标状态见 [S11 迁移](../S11_RULE_MIGRATION_2026-09-27.md)；S9/S10 规则见 [S9/S10 迁移](../S9_S10_RULE_MIGRATION_2026-09-27.md)；S8 时序与属性分组见 [S8 最新迁移](../S8_RULE_MIGRATION_2026-09-27.md)；加托容量、承伤降低与专项回归见 [2026-09-27 迁移](../PVP_RULE_MIGRATION_2026-09-27.md)；此前完整底层迁移见 [2026-09-26 历史记录](../PVP_RULE_MIGRATION_2026-09-26.md)。
