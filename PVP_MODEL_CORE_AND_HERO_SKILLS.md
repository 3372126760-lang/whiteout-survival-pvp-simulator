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

默认行动顺序为 A盾、B盾、A矛、B矛、A射、B射。同回合各行动读取回合开始快照，伤害事件排队，回合末才按顺序抵盾、扣血和结算伤亡。容量增益只在开战前改变实际兵数，继而改变 `N0`、`n_s,r` 和总 HP；**没有容量伤害乘区**。等级常数使用 32 个实际等级的显式表，基础 T11 已按 2026-10-01 口径删除，T12 仅支持 FC7～FC10。混兵四类明细按初始比例独立向上取整，差额与实际人口守恒的处理见 [兵种模型规则](docs/pvp-troop-level-rules.md)。[createBattleState.ts](src/pvp/battle/createBattleState.ts)、[actionPhase.ts](src/pvp/round/actionPhase.ts)、[troopConstants.ts](src/pvp/data/troopConstants.ts)。

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

目标防御 `F_defense,target` 是**实际被命中的目标兵种**的防御因子；攻击方自己的防御不会进入其出手伤害。普通防御技能（津曼、菲兰德、加托、钢铁守护、马格努斯等）进入 `heroDefenseBonus` 防御属性组，并按目标及来袭兵种 scope 匹配。`skillDefenseBonus` 独立事件分母已废弃。`baseDefenseMultiplier` 只为明确的“基础防御力倍率”保留独立特殊除数。[attributeModifiers.ts](src/pvp/effects/attributeModifiers.ts)、[createDamageEvent.ts](src/pvp/damage/createDamageEvent.ts)。

**最终战报模式**默认采用最终战报四属性和实际初始兵数，令已体现在战报的城镇、宠物、专家、专武属性 Buff、英雄静态属性的额外修正为零；英雄配置只加载未显示在面板的动态战斗技能。**预测模式**从基础面板、阵容静态修正、外部 Buff/Debuff 和容量加成构造战斗输入。专武场景属性 `W_x` 与普通外部 Buff `E_x` 同组先加，再形成一个乘区；不能在报告结果后加百分点，也不能让普通 Buff 与专武 Buff 乘乘。静态专武属性差量仍单独归入 `S_x`。最终战报模式不再运行时重加。若预测输入本身已是最终战报值，也不能再叠加这些来源。[pureTroopScenario.ts](src/pvp/scenario/pureTroopScenario.ts)、[adapter.ts](src/pvp/validationUi/adapter.ts)。

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

上述是规则结构。引擎另保留已有 `defenseReduction` 事件增伤组、`baseDamageMultiplier` 基础攻击修正及 `baseDefenseMultiplier` 基础防御特殊除数；它们各自带来源，**不能写成无来源的 `specialCoefficient`**。这些分组与真实游戏是否完全一致仍待战报拟合。执行顺序：开战属性/容量 → 回合快照 → 选中目标并确认主攻尝试 → 尝试型技能判定 → 普通攻击闪避判定 → 命中型技能判定 → `B` 与攻穿和基础攻击特殊修正 → 普攻及技能子事件草稿 → 同源、同目标、同时点、同基准技能系数汇总 → 逐事件按 scope 解析目标防御和增减伤 → 直接抵消 → 逐事件取整 → 回合末按事件顺序临时护盾吸收 → HP/伤亡。[multipliers.ts](src/pvp/effects/multipliers.ts)、[createDamageEvent.ts](src/pvp/damage/createDamageEvent.ts)。

`normalAttack` 是主攻击；`skillDamage/extraDamage` 是独立技能伤害事件，不增加主攻击次数；`additionalAttack` 只有真正额外出手时才成立；连射内部第二段仍属于同一主攻击。伤害池只合并同一主攻击来源、相同目标、结算时点和 `parentBaseDamage` 基准的技能额外伤害，例如炎晶战矛 `1B` + 芮妮梦痕 `2B` → 一笔 `k=3` 的技能事件，再统一走技能增伤/免伤和一次取整。目标或时序不同仍独立结算。[actionPhase.ts](src/pvp/round/actionPhase.ts)。

S9/S10 最新口径：马格努斯、弗雷德、修拉按 `mainAttackAttempt` 判定或计数，普通攻击被闪避仍生效；芙蕾雅只在矛兵 `successfulNormalAttackHit` 后判定；布兰琪二技能按自然 R3/R6/R9…，与先前命中次数无关。格里高利和韦恩使用同一普通攻击暴击效果模板，触发时仅该次 `normalAttack ×2`。详细规则和回归见 [S9/S10 迁移说明](S9_S10_RULE_MIGRATION_2026-09-27.md)。

S11 最新口径：埃莱奥诺拉腾焰飞芒按盾兵 `mainAttackAttempt` 每 5 次计数，闪避不取消，次轮起持续 2 回合；劳埃德冰雾爆弹按自然 R3/R6/R9… 生效，群鸟侵扰和冰雾爆弹的敌方穿透降低先同组加算；鲁弗斯碎甲一击只在射手 `successfulNormalAttackHit` 后生成 `0.6B` 及次轮目标易伤，暴烈震爆则逐兵种主攻击尝试独立判定，对各自目标施加可刷新但不叠幅的穿透减益。这里的通用伤害提升在代码中为 `commonDamageIncrease`，对应规则文字的 `baseDamageIncrease`。详细公式、时序和回归见 [S11 迁移说明](S11_RULE_MIGRATION_2026-09-27.md)。

### 4. 血量、减伤、直接抵消与护盾

```text
HP_unit,t = C_hp,t × C_level,t × F_life,t
C_hp: 盾 300，矛 100，射 75
HP_total,t = 当前兵数 × HP_unit,t
```

**防御不计入 HP**；它只在该兵种受击时作为事件伤害分母。生命属性变化可重算单兵最大 HP，防御变化不会。所有文字为“受到伤害降低”的 effect 按目标 scope 加入同一个 `receivedDamageReduction` 组：全军 20% 加盾 25% 得盾分母 1.45，加矛 20% 得矛 1.40，射 1.20。攻击方造成伤害降低是独立的 `enemyOutgoingDamageReduction` 等组，和前者相乘。普攻/技能专属免伤仅匹配对应事件。[hp.ts](src/pvp/formulas/hp.ts)、[resolvePendingDamage.ts](src/pvp/casualty/resolvePendingDamage.ts)。

烈晶盾牌 FC10 触发时提供**受到伤害降低 51%**，单独分母 `1.51`；巴希提一技能 20% 同时生效时分母 `1+0.51+0.20=1.71`。炽红力场“伤害减半”按新确认口径记为同组承伤降低 50%，单独分母 `1.50`，与巴希提叠加为 `1.70`。三项若共同匹配同一事件，统一分母为 `2.21`。攻击方造成伤害降低 30% 属于另一组，与烈晶盾牌构成 `/1.51/1.30`。光铸之躯 FC10 的基础防御特殊 `/1.06` 与射手火焰冲击基础攻击特殊 `×1.06` 单列来源；燃晶火药与火焰冲击的追加系数仍是同一笔 `0.875B`。[shield.ts](src/pvp/troopSkills/definitions/shield.ts)、[lancer.ts](src/pvp/troopSkills/definitions/lancer.ts)。

临时护盾：`S'=max(0,S-D)`，`HPDamage=max(0,D-S)`；剩余护盾可挡同回合后续事件。加托二技能在每次盾兵主攻击后**触发、下一回合生效**，按新生成值覆盖上一层，不叠加。正式计算：`X=100×Ct×√n_shield,current×(1+A_report)`；Lv5 `S=0.30X`，Lv4 `S=0.24X`。默认英雄远征技能 Lv5，Sheet2/Sheet3 的实验复现显式设 Lv4。R1 无加托盾，R1 主攻产生 R2 护盾；若 R2 被眩晕而没有主攻，则不会排队 R3 新盾。艾丽芙三技能现复用同一护盾公式与时序，但其 S14 战报状态仍为 provisional。[gatotShield.ts](src/pvp/heroSkills/gatotShield.ts)、[resolveHeroSkills.ts](src/pvp/heroSkills/resolveHeroSkills.ts)、[resolvePendingDamage.ts](src/pvp/casualty/resolvePendingDamage.ts)。

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

### 口径与注意事项

- `confirmed` 在本报告中特指**库存文字明确记录真实战报/实战验证**且该技能所有效果均有此依据；若原始战报未随仓库存档，仍需外部复核。`provisional` 指代码或乘区规则暂定；其余为 `unverified`。项目原有 `ruleStatus=supported`、库存 `confirmationStatus=confirmed` 另行保留，不能直接当成战报验证。
- 目录等级数值和 effect 数值均为小数：`0.25` 表示 25%；缺失等级保持缺失，不插值。代际英雄多数仅录入 Lv5；专武的技能等级 1～5 是武器阶梯，不等于武器本体 Lv1～Lv5。
- `activationTiming` 的引擎枚举是 `immediate/nextAction/roundEnd/nextRound`；`startBattle` 不是枚举值。开场被动会在首回合快照前应用。effect 自身 `lifecycle` 可以覆盖定义级时机与持续。
- `extraDamage` 在此引擎产生独立 `skillDamage/extraDamage` 事件；它不代表 `additionalAttack`。报告只在代码实际增加主攻击时才使用 `additionalAttack`，当前注册英雄定义没有此类效果。`normalAttackDamage` 表示只匹配普通攻击的伤害修正。
- `target=all` 对属性或减伤效果表示对应军队范围；对多目标 `extraDamage` 则由运行时按存活目标栈展开。`currentTarget` 指该次主攻击选中的目标栈，即使普通攻击随后被闪避。
- 车头默认启用战斗远征技能 1～3；车身只允许显式选择远征技能 1。专武场景技能需武器阶梯及匹配 `battleContexts`，见 `src/pvp/heroSkills/loadout.ts`。

最新规则说明：最终战报模式直接采用战报四属性与实际初始兵数；专武属性归外部 Buff 层，不重复叠加。目标防御进入每笔伤害分母，生命公式不含防御。同来源、同目标、同结算时点、同伤害基准的技能额外伤害系数先汇总再取整。S12～S16 全部为 inferredFromPriorGenerations / TENTATIVE，尚无可用 PVP 战报；复用 S1～S11 模板仅确认代码语义继承，不表示新代数获得战报验证。`mainAttackAttempt` 与 `successfulNormalAttackHit` 明确分离，新录 kB 事件使用 `parentBaseDamage`。目录文字与项目内部旧库存的证据标签若仍沿用旧口径，以本说明及当前 effect 数据为准。

### 完整性统计

目录英雄 62 名；PVP 注册技能定义 204 项；孤立定义 0 项；目录中战斗技能缺实现 0 项。

按本报告严格战报口径：confirmed 9 项、provisional 63 项、unverified 132 项。项目内部库存的 `confirmed` 数量另见原始 JSON，两者定义不同。

| 代数 | 英雄数 | 注册 PVP 技能数 |
| --- | ---: | ---: |
| R/SR（非代际） | 13 | 12 |
| S1 | 4 | 15 |
| S2 | 3 | 12 |
| S3 | 3 | 12 |
| S4 | 3 | 12 |
| S5 | 3 | 12 |
| S6 | 3 | 12 |
| S7 | 3 | 12 |
| S8 | 3 | 12 |
| S9 | 3 | 12 |
| S10 | 3 | 12 |
| S11 | 3 | 12 |
| S12 | 3 | 12 |
| S13 | 3 | 12 |
| S14 | 3 | 12 |
| S15 | 3 | 12 |
| S16 | 3 | 9 |

### S8 专题：完整描述、当前逻辑与机制假设

S8 注册加托、索妮娅、亨德里克各 3 个远征战斗技能和 1 个场景专武技能。下表使用远征目录原描述；所有逐级原始数据仍在后面的 S8 全量条目。

| 英雄/定位 | 技能与完整目录描述 | 当前实现逻辑 | 用户规则口径 | 原始战报口径 |
| --- | --- | --- | --- | --- |
| 加托/盾 | **加托·黄金近卫**（`hero-skill.jiatuo.golden-guard`）<br>盾兵防御提升30%。 | 首回合快照前给盾兵 defense 属性 +30%，属于 heroDefenseBonus；仅影响盾兵受击时的 Defense 分母，不提高最大 HP。 | confirmed | unverified |
| 加托/盾 | **加托·列王恩赐**（`hero-skill.jiatuo.kings-gift`）<br>盾兵每次完成主攻击后触发，下一回合护盾生效并覆盖旧盾：X=100×当前盾兵常数×√当前盾兵数×(1+战报攻击加成)；Lv4=0.24X，Lv5=0.30X。英雄远征技能攻击增减不进入X。 | 每次完成盾兵主攻击后按 X=100×Ct×√当前盾兵数×(1+战报攻击加成) 生成待生效护盾，Lv4=0.24X、Lv5=0.30X；仅读取战报攻击层，不吃英雄远征技能攻击层；下一回合生效并覆盖上一层，伤害取整后、HP 前吸收。Sheet2/Sheet3 原始表格未随仓库存档。 | confirmed | unverified |
| 加托/盾 | **加托·王者之师**（`hero-skill.jiatuo.kings-army`）<br>敌军全军攻击降低25%。 | 开场对敌全军攻击属性施加 25% enemyAttackReduction；同组先加算，再除以 1+组和。 | confirmed | unverified |
| 加托/盾 | **加托专武·不灭之城**（`hero-weapon-skill.jiatuo.defense-defense`）<br>专武远征场景效果：defense Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。 | 仅 rallyDefense/garrisonDefense 生效，属于外部 Buff 属性层；最终战报模式已含该值，不再运行时重复叠加。 | confirmed | unverified |
| 索妮娅/矛 | **索妮娅·宝藏猎人**（`hero-skill.suoniya.treasure-hunter`）<br>全军伤害提升20%。 | 开场给我军全伤害 commonDamageIncrease +20%；与同组来源加算。 | confirmed | unverified |
| 索妮娅/矛 | **索妮娅·赏金诱惑**（`hero-skill.suoniya.bounty-temptation`）<br>每完成2次矛兵主攻击立即造成0.75B技能额外伤害；全军攻击+25%从下一回合起持续1回合。 | 每完成2次矛兵主攻击，当回合向命中栈追加0.75B的 skillDamage/extraDamage；全军 heroAttackBonus +25% 从下一回合生效1回合，本次0.75B不吃该新加成。 | confirmed | unverified |
| 索妮娅/矛 | **索妮娅·激流冲击**（`hero-skill.suoniya.torrent-impact`）<br>每5个自然回合（R5/10/15…）对实际命中目标造成2.50B技能额外伤害；该目标下一回合跳过行动。 | 按自然回合 R5/10/15… 判定，完成矛兵主攻击后向命中栈追加2.50B skillDamage/extraDamage；实际目标下一回合跳过行动。与赏金诱惑同一时点时系数先合并。 | confirmed | unverified |
| 索妮娅/矛 | **索妮娅专武·涡流炮台**（`hero-weapon-skill.suoniya.defense-penetration`）<br>专武远征场景效果：penetration Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。 | 仅 rallyDefense/garrisonDefense 生效，buffPenetration 与普通外部穿透 Buff 同组先加，再形成一个外部 Buff 乘区。 | confirmed | unverified |
| 亨德里克/射 | **亨德里克·蝙虫之噬**（`hero-skill.s8.hengdelike.defense-reduction`）<br>敌军全军防御属性降低25%，进入enemyDefenseReduction属性组。 | 开场给敌全军 defense 属性施加 enemyDefenseReduction +25%（防御因子除以1.25），不作为易伤或伤害增益。 | confirmed | unverified |
| 亨德里克/射 | **亨德里克·藤壶之铠**（`hero-skill.s8.hengdelike.barnacle-armor`）<br>每4个自然回合连续生效2回合（R5/6、R9/10…），全军heroDefenseBonus+30%。 | 从 R5 起每 4 回合前 2 回合（R5/6、9/10…）全军 heroDefenseBonus +30%，进入受击目标防御属性，重复状态 replace。 | confirmed | unverified |
| 亨德里克/射 | **亨德里克·大森之嗣**（`hero-skill.s8.hengdelike.heir-of-forest`）<br>每3个自然回合（R3/6/9…）由射手对每个存活敌军兵种栈分别造成0.40B技能额外伤害。 | 按自然回合 R3/6/9…判定，射手完成主攻击后对每个仍存活敌军兵种栈分别生成0.40B skillDamage/extraDamage；各目标独立使用自身防御与减伤。 | confirmed | unverified |
| 亨德里克/射 | **亨德里克专武·深渊之佑**（`hero-weapon-skill.s8.hengdelike.rally-attack`）<br>专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。 | 仅 rallyAttack 生效，buffAttack 与普通外部攻击 Buff 同组先加，再形成一个外部 Buff 乘区。 | confirmed | unverified |

S8 主要交互点：`resolveHeroSkills.ts` 的 `prepareRound`、主攻击计数、技能追加 `DamageEvent`、加托护盾、次回合跳过行动；`gatotShield.ts` 负责只读战报攻击层的 X 计算；`round/actionPhase.ts` 负责同一快照出手；`damage/createDamageEvent.ts` 处理乘区；`casualty/resolvePendingDamage.ts` 在回合末先用临时护盾承伤再扣兵。S14 艾丽芙护盾仍采用独立的暂定 parentRawDamage 公式，不能沿用加托的新公式。

S8 规则已由用户本次确认并覆盖旧时序和旧乘区。原始证据缺口：

1. Sheet2/Sheet3 原始表格与 257 回合战报未随仓库存档，需后续逐事件复核数值、取整和命中目标。
2. 三个专武的场景匹配和属性乘区仍可用原始游戏战报复核；final-report 模式已关闭重复叠加。

### S9/S10 最新确认规则摘要

用户确认的机制与真实战报验证状态分别记录；详细逐技能等级/effect 数据在下方全量条目。`commonDamageIncrease` 是当前引擎对普通增伤（需求文字 `baseDamageIncrease`）使用的同组键。

| 代数 | 英雄 | 技能 | 当前触发与完整 Lv5 结算 |
| --- | --- | --- | --- |
| S9 | 马格努斯 | 马格努斯·怒海狂涛 | 常驻全军 heroAttackBonus +25%。 |
| S9 | 马格努斯 | 马格努斯·钢铁方阵 | 每次盾主攻尝试独立40%判定；闪避不取消；成功后全军 heroDefenseBonus +50%，触发点起当轮生效，次轮失效。 |
| S9 | 马格努斯 | 马格努斯·冰海战法 | 盾承伤降低10%进入 receivedDamageReduction；射手所有伤害普通增伤10%进入 commonDamageIncrease。 |
| S9 | 弗雷德 | 弗雷德·水炮压制 | 敌全军穿透属性因子除以1.20。 |
| S9 | 弗雷德 | 弗雷德·酸性溶液 | 仅敌方盾兵 vulnerability +20%。 |
| S9 | 弗雷德 | 弗雷德·攻势如潮 | 每4次矛主攻尝试，闪避仍计数；当轮原目标2B skillDamage/extraDamage，敌全军次轮造成伤害降低20%。 |
| S9 | 修拉 | 修拉·迷雾孢子 | 全军 receivedDamageReduction +20%。 |
| S9 | 修拉 | 修拉·贯穿之矢 | 每2次射手主攻尝试，闪避仍计数；当轮原目标1B skillDamage/extraDamage，原目标次轮 vulnerability +25%。 |
| S9 | 修拉 | 修拉·波云诡谲 | 射手 receivedDamageReduction +15%，与一技能同组加算；射手普通增伤 +10%。 |
| S10 | 格里高利 | 格里高利·炽阳之师 | 全军 heroAttackBonus +15%、heroDefenseBonus +10%。 |
| S10 | 格里高利 | 格里高利·钢铁方阵 | 盾/矛/射各自主普攻通过闪避后独立25%判定；触发只将本次 normalAttack ×2，不生成额外事件。共用韦恩普通攻击暴击效果模板。 |
| S10 | 格里高利 | 格里高利·钢铁防线 | 盾 receivedDamageReduction +20%，与烈晶盾牌等同组加算。 |
| S10 | 芙蕾雅 | 芙蕾雅·暮色迷雾 | 敌全军攻击属性因子除以1.20。 |
| S10 | 芙蕾雅 | 芙蕾雅·新月之镰 | 仅矛普通攻击成功命中后独立50%判定；触发对原目标1B skillDamage/extraDamage；闪避时不判定。 |
| S10 | 芙蕾雅 | 芙蕾雅·灵动一击 | 盾/射 receivedDamageReduction 各+15%，盾/射普通增伤各+15%；矛不受三技能增伤。 |
| S10 | 布兰琪 | 布兰琪·真红猎刃 | 全军 heroPenetrationBonus +25%。 |
| S10 | 布兰琪 | 布兰琪·炽红爆裂 | 自然 R3/R6/R9… 的射手主攻尝试对当前目标造成0.75B；闪避不改变周期。 |
| S10 | 布兰琪 | 布兰琪·曙红狙刺 | 共用韦恩二技能分目标模板；每2次射手主攻尝试，敌矛0.40B、敌射0.20B，各自防御与减伤结算，缺目标不转移。 |

实现与证据说明见 `S9_S10_RULE_MIGRATION_2026-09-27.md`。S9 马格努斯 1500 次主攻、604 次钢铁方阵触发的比例由用户提供；原始战报未随仓库附上，故严格战报状态仍按库存证据字段单列。

### S11 最新确认规则摘要

S11 使用既有主攻尝试、命中、自然回合、同组乘区和 kB 系统；本表为用户确认规则摘要，完整已录等级/effect 字段见下方全量条目。

| 英雄 | 技能 | 当前 Lv5 触发与效果 |
| --- | --- | --- |
| 埃莱奥诺拉 | 埃莱奥诺拉·烈日威光 | 全军 heroLifeBonus +25%，独立于最终战报已包含的静态与专武属性。 |
| 埃莱奥诺拉 | 埃莱奥诺拉·索拉里斯方阵 | 盾 receivedDamageReduction +10%；射手 commonDamageIncrease +10%，覆盖普攻和技能伤害。 |
| 埃莱奥诺拉 | 埃莱奥诺拉·腾焰飞芒 | 第5/10/15…次盾主攻尝试触发，闪避仍计数、跳过不计数；下两回合全军 commonDamageIncrease +25%、receivedDamageReduction +25%。 |
| 劳埃德 | 劳埃德·群鸟侵扰 | 敌全军穿透属性降低20%，进入 enemyPenetrationReduction。 |
| 劳埃德 | 劳埃德·冰雾爆弹 | 自然R3/R6/R9…当轮矛普通增伤150%、敌全军穿透降低30%；与一技能20%同组为50%，属性分母1.50。 |
| 劳埃德 | 劳埃德·机巧万变 | 每自然回合开始独立40%判定，成功则全军当轮 heroPenetrationBonus +50%，下轮重新判定。 |
| 鲁弗斯 | 鲁弗斯·火焰战团 | 全军 heroAttackBonus +25%。 |
| 鲁弗斯 | 鲁弗斯·碎甲一击 | 仅射手普通主攻击成功命中后，对原目标0.60B skillDamage/extraDamage，并预约该目标次轮 vulnerability +25%；闪避或跳过则无。 |
| 鲁弗斯 | 鲁弗斯·暴烈震爆 | 盾/矛/射每次主攻尝试分别20%判定，闪避仍判定、跳过不判定；成功使选中目标穿透降低50%，即时生效2回合，同目标覆盖刷新。 |

S11 实现与证据边界见 `S11_RULE_MIGRATION_2026-09-27.md`；完整合成运行日志为 `s11_rule_trace.txt`。旧库存中 S11 provisional/confirmed 标签不直接证明新时序已有真实战报复核。

### 全量英雄与技能

### R/SR（非代际）

#### 尤金（盾，R，`hero.r.youjin`）

远征静态属性（小数）：attack=0.9007；defense=0.9007；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 祖传技艺（`expedition.youjin.ancestral-craft`） | 伐木收益+25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | 非战斗，仅展示 |
| 2 | 伐木大师（`expedition.youjin.logging-master`） | 木材采集速度+25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | 非战斗，仅展示 |

PVP 注册技能 0 项。

#### 史密斯（盾，R，`hero.r.shimisi`）

远征静态属性（小数）：attack=0.9007；defense=0.9007；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 趁热打铁（`expedition.shimisi.strike-while-hot`） | 铁矿厂收益+25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | 非战斗，仅展示 |
| 2 | 铁匠精神（`expedition.shimisi.blacksmith-spirit`） | 铁矿采集速度+25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | 非战斗，仅展示 |

PVP 注册技能 0 项。

#### 查理（矛，R，`hero.r.chali`）

远征静态属性（小数）：attack=0.9007；defense=0.9007；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 爆破专精（`expedition.chali.blasting`） | 煤矿厂收益+25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | 非战斗，仅展示 |
| 2 | 煤矿开采（`expedition.chali.coal-mining`） | 煤矿采集速度+25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | 非战斗，仅展示 |

PVP 注册技能 0 项。

#### 克劳瑞斯（射，R，`hero.r.kelaoruisi`）

远征静态属性（小数）：attack=0.9007；defense=0.9007；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 王牌猎人（`expedition.kelaoruisi.ace-hunter`） | 狩猎收益+25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | 非战斗，仅展示 |
| 2 | 肉食者（`expedition.kelaoruisi.carnivore`） | 生肉采集速度+25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | 非战斗，仅展示 |

PVP 注册技能 0 项。

#### 谢尔盖（盾，SR，`hero.sr.xieergai`）

远征静态属性（小数）：attack=1.4011；defense=1.4011；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 守护之力（`expedition.xieergai.guardian-power`） | 全军受到伤害降低20%。 | `{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}` | `hero-skill.xieergai.guardian-power` |
| 2 | 虚弱打击（`expedition.xieergai.weakening-strike`） | 敌军攻击力降低20%。 | `{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}` | `hero-skill.xieergai.weakening-strike` |

PVP 注册技能 2 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 守护之力（`hero-skill.xieergai.guardian-power`）

- **实现名/原文**：Sergei Guardian Power；全军受到伤害降低20%。
- **等级原数值**：`{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.guardian-power","name":"hero-effect.xieergai.guardian-power","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.04,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.guardian-power","name":"hero-effect.xieergai.guardian-power","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.08,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.guardian-power","name":"hero-effect.xieergai.guardian-power","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.12,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.guardian-power","name":"hero-effect.xieergai.guardian-power","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.16,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.guardian-power","name":"hero-effect.xieergai.guardian-power","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.xieergai.guardian-power` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 2. 虚弱打击（`hero-skill.xieergai.weakening-strike`）

- **实现名/原文**：Sergei Weakening Strike；敌军攻击力降低20%。
- **等级原数值**：`{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.weakening-strike","name":"hero-effect.xieergai.weakening-strike","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.04,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.weakening-strike","name":"hero-effect.xieergai.weakening-strike","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.08,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.weakening-strike","name":"hero-effect.xieergai.weakening-strike","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.12,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.weakening-strike","name":"hero-effect.xieergai.weakening-strike","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.16,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xieergai.weakening-strike","name":"hero-effect.xieergai.weakening-strike","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.xieergai.weakening-strike` | unverified | confirmed | 独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyAttackReduction 为战报攻击属性除法削减组，同组先加算。 |

#### 帕特里克（矛，SR，`hero.sr.patelike`）

远征静态属性（小数）：attack=1.4011；defense=1.4011；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 美食功效（`expedition.patelike.food-effect`） | 全军生命值提升25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | `hero-skill.patelike.life` |
| 2 | 能量摄入（`expedition.patelike.energy-intake`） | 全军攻击力提升25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | `hero-skill.patelike.attack` |

PVP 注册技能 2 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 美食功效（`hero-skill.patelike.life`）

- **实现名/原文**：Patrick Food Effect；全军生命值提升25%。
- **等级原数值**：`{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.life","name":"hero-effect.patelike.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.life","name":"hero-effect.patelike.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.life","name":"hero-effect.patelike.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.life","name":"hero-effect.patelike.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.life","name":"hero-effect.patelike.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.patelike.life` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 能量摄入（`hero-skill.patelike.attack`）

- **实现名/原文**：Patrick Energy Intake；全军攻击力提升25%。
- **等级原数值**：`{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.attack","name":"hero-effect.patelike.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.attack","name":"hero-effect.patelike.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.attack","name":"hero-effect.patelike.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.attack","name":"hero-effect.patelike.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.patelike.attack","name":"hero-effect.patelike.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.patelike.attack` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

#### 巴希提（射，SR，`hero.sr.baxiti`）

远征静态属性（小数）：attack=1.4011；defense=1.4011；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 危险感知（`expedition.baxiti.danger-sense`） | 全军受到伤害降低20%。 | `{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}` | `hero-skill.baxiti.danger-sense` |
| 2 | 不稳定力场（`expedition.baxiti.unstable-field`） | 每个兵种主攻击时独立50%概率，触发后追加基于本次基础伤害B的50%额外技能伤害。 | `{"5":0.5}` | `hero-skill.baxiti.unstable-field` |

PVP 注册技能 2 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 危险感知（`hero-skill.baxiti.danger-sense`）

- **实现名/原文**：Bahiti Danger Sense；全军受到伤害降低20%。
- **等级原数值**：`{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.baxiti.danger-sense","name":"hero-effect.baxiti.danger-sense","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.04,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.baxiti.danger-sense","name":"hero-effect.baxiti.danger-sense","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.08,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.baxiti.danger-sense","name":"hero-effect.baxiti.danger-sense","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.12,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.baxiti.danger-sense","name":"hero-effect.baxiti.danger-sense","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.16,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.baxiti.danger-sense","name":"hero-effect.baxiti.danger-sense","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.baxiti.danger-sense` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 2. 不稳定力场（`hero-skill.baxiti.unstable-field`）

- **实现名/原文**：Bahiti Unstable Field；每个兵种主攻击时独立50%概率，触发后追加基于本次基础伤害B的50%额外技能伤害。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.5`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 50% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.baxiti.unstable-field","name":"hero-effect.baxiti.unstable-field","kind":"extraDamage","recipient":"selfArmy","coefficient":0.5,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.baxiti.unstable-field` | confirmed | confirmed | 独立证据：真实战报多次对照确认每个兵种主攻击独立50%判定，并产生基于基础伤害B的50%独立 extraDamage；玲奈普攻增伤不作用于该子事件。 |

#### 杰西（矛，SR，`hero.body.jiexi`）

远征静态属性（小数）：attack=1.4011；defense=1.4011；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 全副武装（`expedition.jiexi.fully-armed`） | 全军穿透力提升25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | `hero-skill.jiexi.penetration` |
| 2 | 机械屏障（`expedition.jiexi.mechanical-barrier`） | 全军受到伤害降低20%。 | `{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}` | `hero-skill.jiexi.mechanical-barrier` |

PVP 注册技能 2 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 全副武装（`hero-skill.jiexi.penetration`）

- **实现名/原文**：Jessie Fully Armed；全军穿透力提升25%。
- **等级原数值**：`{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.penetration","name":"hero-effect.jiexi.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.penetration","name":"hero-effect.jiexi.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.penetration","name":"hero-effect.jiexi.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.penetration","name":"hero-effect.jiexi.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.penetration","name":"hero-effect.jiexi.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.jiexi.penetration` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 机械屏障（`hero-skill.jiexi.mechanical-barrier`）

- **实现名/原文**：Jessie Mechanical Barrier；全军受到伤害降低20%。
- **等级原数值**：`{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.mechanical-barrier","name":"hero-effect.jiexi.mechanical-barrier","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.04,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.mechanical-barrier","name":"hero-effect.jiexi.mechanical-barrier","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.08,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.mechanical-barrier","name":"hero-effect.jiexi.mechanical-barrier","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.12,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.mechanical-barrier","name":"hero-effect.jiexi.mechanical-barrier","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.16,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiexi.mechanical-barrier","name":"hero-effect.jiexi.mechanical-barrier","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.jiexi.mechanical-barrier` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

#### 书允（射，SR，`hero.body.shuyun`）

远征静态属性（小数）：attack=1.4011；defense=1.4011；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 征伐的战鼓（`expedition.shuyun.war-drum`） | 全军攻击力提升25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | `hero-skill.shuyun.attack` |
| 2 | 疗愈之舞（`expedition.shuyun.healing-dance`） | 军医所治疗速度+50%。 | `{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}` | 非战斗，仅展示 |

PVP 注册技能 1 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 征伐的战鼓（`hero-skill.shuyun.attack`）

- **实现名/原文**：Seo-yoon War Drum；全军攻击力提升25%。
- **等级原数值**：`{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.shuyun.attack","name":"hero-effect.shuyun.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.shuyun.attack","name":"hero-effect.shuyun.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.shuyun.attack","name":"hero-effect.shuyun.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.shuyun.attack","name":"hero-effect.shuyun.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.shuyun.attack","name":"hero-effect.shuyun.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.shuyun.attack` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

#### 杰塞尔（射，SR，`hero.body.jiesaier`）

远征静态属性（小数）：attack=1.4011；defense=1.4011；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 战术推演（`expedition.jiesaier.tactical-deduction`） | 全军穿透力提升25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | `hero-skill.jiesaier.penetration` |
| 2 | 博学多闻（`expedition.jiesaier.erudition`） | 科技研究速度+15%。 | `{"1":0.03,"2":0.06,"3":0.09,"4":0.12,"5":0.15}` | 非战斗，仅展示 |

PVP 注册技能 1 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 战术推演（`hero-skill.jiesaier.penetration`）

- **实现名/原文**：Jasser Tactical Deduction；全军穿透力提升25%。
- **等级原数值**：`{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiesaier.penetration","name":"hero-effect.jiesaier.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiesaier.penetration","name":"hero-effect.jiesaier.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiesaier.penetration","name":"hero-effect.jiesaier.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiesaier.penetration","name":"hero-effect.jiesaier.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiesaier.penetration","name":"hero-effect.jiesaier.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.jiesaier.penetration` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

#### 卢姆·波根（矛，SR，`hero.sr.lumubogen`）

远征静态属性（小数）：attack=1.4011；defense=1.4011；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 惑敌战术（`expedition.lumubogen.deception`） | 敌军穿透力降低20%。 | `{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}` | `hero-skill.lumubogen.penetration-reduction` |
| 2 | 翡翠勇士（`expedition.lumubogen.emerald-warrior`） | 打怪出征速度+100%。 | `{"1":0.2,"2":0.4,"3":0.6,"4":0.8,"5":1}` | 非战斗，仅展示 |

PVP 注册技能 1 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 惑敌战术（`hero-skill.lumubogen.penetration-reduction`）

- **实现名/原文**：Lum Pogen Deception；敌军穿透力降低20%。
- **等级原数值**：`{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`、`penetration`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lumubogen.penetration-reduction","name":"hero-effect.lumubogen.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.04,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lumubogen.penetration-reduction","name":"hero-effect.lumubogen.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.08,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lumubogen.penetration-reduction","name":"hero-effect.lumubogen.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.12,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lumubogen.penetration-reduction","name":"hero-effect.lumubogen.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.16,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lumubogen.penetration-reduction","name":"hero-effect.lumubogen.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.lumubogen.penetration-reduction` | unverified | confirmed | 独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyPenetrationReduction 为战报穿透属性除法削减组，同组先加算。 |

#### 凌霜（矛，SR，`hero.sr.lingshuang`）

远征静态属性（小数）：attack=1.4011；defense=1.4011；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 威风八面（`expedition.lingshuang.commanding-presence`） | 敌军攻击力降低20%。 | `{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}` | `hero-skill.lingshuang.attack-reduction` |
| 2 | 治兵振旅（`expedition.lingshuang.troop-training`） | 训练速度+20%。 | `{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}` | 非战斗，仅展示 |

PVP 注册技能 1 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 威风八面（`hero-skill.lingshuang.attack-reduction`）

- **实现名/原文**：Ling Shuang Commanding Presence；敌军攻击力降低20%。
- **等级原数值**：`{"1":0.04,"2":0.08,"3":0.12,"4":0.16,"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/simpleHeroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["confirmed","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lingshuang.attack-reduction","name":"hero-effect.lingshuang.attack-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.04,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lingshuang.attack-reduction","name":"hero-effect.lingshuang.attack-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.08,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lingshuang.attack-reduction","name":"hero-effect.lingshuang.attack-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.12,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lingshuang.attack-reduction","name":"hero-effect.lingshuang.attack-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.16,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lingshuang.attack-reduction","name":"hero-effect.lingshuang.attack-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.lingshuang.attack-reduction` | unverified | confirmed | 独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyAttackReduction 为战报攻击属性除法削减组，同组先加算。 |

#### 吉娜（射，SR，`hero.sr.jina`）

远征静态属性（小数）：attack=1.1008；defense=1.1008；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 强劲体魄（`expedition.jina.strong-physique`） | 领主体力消耗减少20%。 | `{"1":0.1,"2":0.12,"3":0.15,"4":0.18,"5":0.2}` | 非战斗，仅展示 |
| 2 | 迅捷行动（`expedition.jina.swift-action`） | 打怪出征速度+100%。 | `{"1":0.2,"2":0.4,"3":0.6,"4":0.8,"5":1}` | 非战斗，仅展示 |

PVP 注册技能 0 项。

### S1

#### 赫罗尼莫（盾，SSR，`hero.s1.heluonimo`）

远征静态属性（小数）：attack=2.602；defense=2.602；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 战前宣言（`expedition.heluonimo.prebattle-declaration`） | 全军穿透+25%。 | `{"5":0.25}` | `hero-skill.heluonimo.penetration` |
| 2 | 剑术指导（`expedition.heluonimo.swordsmanship-guidance`） | 全军攻击+25%。 | `{"5":0.25}` | `hero-skill.heluonimo.attack` |
| 3 | 精湛剑术（`expedition.heluonimo.masterful-swordsmanship`） | 从第5回合起，每4回合生效2回合，全军造成伤害+30%。 | `{"5":0.3}` | `hero-skill.heluonimo.periodic-damage` |

专武目录：基础属性上限 penetration=0.625、life=0.625；技能ID=`hero-weapon-skill.heluonimo.rally-attack`；已录入阶梯数值=`{"hero-weapon-skill.heluonimo.rally-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 战前宣言（`hero-skill.heluonimo.penetration`）

- **实现名/原文**：赫罗尼莫·战前宣言；全军穿透+25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.heluonimo.penetration","name":"hero-effect.heluonimo.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.heluonimo.penetration` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 剑术指导（`hero-skill.heluonimo.attack`）

- **实现名/原文**：赫罗尼莫·剑术指导；全军攻击+25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.heluonimo.attack","name":"hero-effect.heluonimo.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.heluonimo.attack` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 3. 精湛剑术（`hero-skill.heluonimo.periodic-damage`）

- **实现名/原文**：赫罗尼莫·精湛剑术；从第5回合起，每4回合生效2回合，全军造成伤害+30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.heluonimo.periodic-damage","name":"hero-effect.heluonimo.periodic-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"periodRounds":4,"firstActiveRound":5,"activeWindowRounds":2}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.heluonimo.periodic-damage` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 赫罗尼莫专武·集结进攻攻击（`hero-weapon-skill.heluonimo.rally-attack`）

- **实现名/原文**：赫罗尼莫专武·集结进攻攻击；专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heluonimo.rally-attack","name":"hero-weapon-effect.heluonimo.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heluonimo.rally-attack","name":"hero-weapon-effect.heluonimo.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heluonimo.rally-attack","name":"hero-weapon-effect.heluonimo.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heluonimo.rally-attack","name":"hero-weapon-effect.heluonimo.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heluonimo.rally-attack","name":"hero-weapon-effect.heluonimo.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.heluonimo.rally-attack` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 娜塔莉亚（盾，SSR，`hero.s1.nataliya`）

远征静态属性（小数）：attack=2.0016；defense=2.0016；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 野性咆哮（`expedition.nataliya.wild-roar`） | 每回合40%概率使全军本回合受到伤害降低50%。 | `{"5":0.5}` | `hero-skill.nataliya.wild-roar` |
| 2 | 兽群领袖（`expedition.nataliya.pack-leader`） | 全军攻击+25%。 | `{"5":0.25}` | `hero-skill.nataliya.attack` |
| 3 | 狂野呼唤（`expedition.nataliya.wild-call`） | 全军穿透+25%。 | `{"5":0.25}` | `hero-skill.nataliya.penetration` |

专武目录：基础属性上限 penetration=0.55、life=0.55；技能ID=`hero-weapon-skill.nataliya.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.nataliya.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 野性咆哮（`hero-skill.nataliya.wild-roar`）

- **实现名/原文**：娜塔莉亚·野性咆哮；每回合40%概率使全军本回合受到伤害降低50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.nataliya.wild-roar","name":"hero-effect.nataliya.wild-roar","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.nataliya.wild-roar` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 2. 兽群领袖（`hero-skill.nataliya.attack`）

- **实现名/原文**：娜塔莉亚·兽群领袖；全军攻击+25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.nataliya.attack","name":"hero-effect.nataliya.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.nataliya.attack` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 3. 狂野呼唤（`hero-skill.nataliya.penetration`）

- **实现名/原文**：娜塔莉亚·狂野呼唤；全军穿透+25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.nataliya.penetration","name":"hero-effect.nataliya.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.nataliya.penetration` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 娜塔莉亚专武·集结进攻穿透（`hero-weapon-skill.nataliya.rally-penetration`）

- **实现名/原文**：娜塔莉亚专武·集结进攻穿透；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nataliya.rally-penetration","name":"hero-weapon-effect.nataliya.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nataliya.rally-penetration","name":"hero-weapon-effect.nataliya.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nataliya.rally-penetration","name":"hero-weapon-effect.nataliya.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nataliya.rally-penetration","name":"hero-weapon-effect.nataliya.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nataliya.rally-penetration","name":"hero-weapon-effect.nataliya.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.nataliya.rally-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

#### 茉莉（矛，SSR，`hero.s1.moli`）

远征静态属性（小数）：attack=2.0016；defense=2.0016；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 雪之号令（`expedition.moli.snow-command`） | 每回合40%概率使全军本回合受到伤害降低50%。 | `{"5":0.5}` | `hero-skill.moli.snow-command` |
| 2 | 冰雪领域（`expedition.moli.ice-field`） | 每个兵种主攻击前独立50%判定，触发后产生基于基础伤害B的50%额外技能伤害。 | `{"5":0.5}` | `hero-skill.moli.ice-field` |
| 3 | 少女之怒（`expedition.moli.maiden-fury`） | 全军穿透+25%。 | `{"5":0.25}` | `hero-skill.moli.penetration` |

专武目录：基础属性上限 penetration=0.55、life=0.55；技能ID=`hero-weapon-skill.moli.defense-penetration`；已录入阶梯数值=`{"hero-weapon-skill.moli.defense-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 雪之号令（`hero-skill.moli.snow-command`）

- **实现名/原文**：茉莉·雪之号令；每回合40%概率使全军本回合受到伤害降低50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.moli.snow-command","name":"hero-effect.moli.snow-command","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.moli.snow-command` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 2. 冰雪领域（`hero-skill.moli.ice-field`）

- **实现名/原文**：茉莉·冰雪领域；每个兵种主攻击前独立50%判定，触发后产生基于基础伤害B的50%额外技能伤害。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.5`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 50% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.moli.ice-field","name":"hero-effect.moli.ice-field","kind":"extraDamage","recipient":"selfArmy","coefficient":0.5,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.moli.ice-field` | unverified | confirmed | 本轮最终确认：每个存活兵种主攻击独立判定，成功产生 parentBaseDamage 系数的独立 skillDamage/extraDamage 子事件；不继承普通攻击专属增伤。 |

##### 3. 少女之怒（`hero-skill.moli.penetration`）

- **实现名/原文**：茉莉·少女之怒；全军穿透+25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.moli.penetration","name":"hero-effect.moli.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.moli.penetration` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 茉莉专武·守城穿透（`hero-weapon-skill.moli.defense-penetration`）

- **实现名/原文**：茉莉专武·守城穿透；专武远征场景效果：penetration Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.moli.defense-penetration","name":"hero-weapon-effect.moli.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.moli.defense-penetration","name":"hero-weapon-effect.moli.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.moli.defense-penetration","name":"hero-weapon-effect.moli.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.moli.defense-penetration","name":"hero-weapon-effect.moli.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.moli.defense-penetration","name":"hero-weapon-effect.moli.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.moli.defense-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

#### 津曼（射，SSR，`hero.s1.jinman`）

远征静态属性（小数）：attack=2.0016；defense=2.0016；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 固若金汤（`expedition.jinman.impregnable`） | 全军防御与生命+10%。 | `{"5":0.1}` | `hero-skill.jinman.defense-life` |
| 2 | 建筑艺术（`expedition.jinman.architectural-art`） | 非战斗远征技能。 | `{"5":0.1}` | 非战斗，仅展示 |
| 3 | 阵地战强者（`expedition.jinman.positional-warfare`） | 全军穿透+25%。 | `{"5":0.25}` | `hero-skill.jinman.penetration` |

专武目录：基础属性上限 penetration=0.55、life=0.55；技能ID=`hero-weapon-skill.jinman.defense-attack`；已录入阶梯数值=`{"hero-weapon-skill.jinman.defense-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 3 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 固若金汤（`hero-skill.jinman.defense-life`）

- **实现名/原文**：津曼·固若金汤；全军防御与生命+10%。
- **等级原数值**：`{"5":0.1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jinman.defense","name":"hero-effect.jinman.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.jinman.life","name":"hero-effect.jinman.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"heroLifeBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.jinman.defense` | unverified | confirmed | 本轮最终确认：与盾兵钢铁守护同属 skillDefenseBonus，组内先相加，整组作为当前命中伤害的除数；不回写战报防御面板。 |
| `hero-effect.jinman.life` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 阵地战强者（`hero-skill.jinman.penetration`）

- **实现名/原文**：津曼·阵地战强者；全军穿透+25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jinman.penetration","name":"hero-effect.jinman.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.jinman.penetration` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 3. 津曼专武·守城攻击（`hero-weapon-skill.jinman.defense-attack`）

- **实现名/原文**：津曼专武·守城攻击；专武远征场景效果：attack Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s1Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S1 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S1","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jinman.defense-attack","name":"hero-weapon-effect.jinman.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jinman.defense-attack","name":"hero-weapon-effect.jinman.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jinman.defense-attack","name":"hero-weapon-effect.jinman.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jinman.defense-attack","name":"hero-weapon-effect.jinman.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jinman.defense-attack","name":"hero-weapon-effect.jinman.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.jinman.defense-attack` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

### S2

#### 弗林特（盾，SSR，`hero.head.fulinte`）

远征静态属性（小数）：attack=2.4019；defense=2.4019；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 野火燎原（`expedition.fulinte.wildfire`） | 盾兵造成伤害提升100%。 | `{"1":0.2,"2":0.4,"3":0.6,"4":0.8,"5":1}` | `hero-skill.fulinte.wildfire` |
| 2 | 燃烧意志（`expedition.fulinte.burning-will`） | 全军攻击提升25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | `hero-skill.fulinte.burning-will` |
| 3 | 无尽烈火（`expedition.fulinte.endless-fire`） | 全军穿透提升25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | `hero-skill.fulinte.endless-fire` |

专武目录：基础属性上限 penetration=0.6、life=0.6；技能ID=`hero-weapon-skill.fulinte.defense-attack`；已录入阶梯数值=`{"hero-weapon-skill.fulinte.defense-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 野火燎原（`hero-skill.fulinte.wildfire`）

- **实现名/原文**：弗林特·野火燎原；盾兵造成伤害提升100%。
- **等级原数值**：`{"1":0.2,"2":0.4,"3":0.6,"4":0.8,"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=—；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.wildfire.shield-damage","name":"hero-effect.fulinte.wildfire.shield-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.2,"scope":{"source":"shield","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.wildfire.shield-damage","name":"hero-effect.fulinte.wildfire.shield-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.4,"scope":{"source":"shield","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.wildfire.shield-damage","name":"hero-effect.fulinte.wildfire.shield-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.6,"scope":{"source":"shield","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.wildfire.shield-damage","name":"hero-effect.fulinte.wildfire.shield-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.8,"scope":{"source":"shield","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.wildfire.shield-damage","name":"hero-effect.fulinte.wildfire.shield-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":1,"scope":{"source":"shield","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.fulinte.wildfire.shield-damage` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 2. 燃烧意志（`hero-skill.fulinte.burning-will`）

- **实现名/原文**：弗林特·燃烧意志；全军攻击提升25%。
- **等级原数值**：`{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=—；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.burning-will.attack","name":"hero-effect.fulinte.burning-will.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.burning-will.attack","name":"hero-effect.fulinte.burning-will.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.burning-will.attack","name":"hero-effect.fulinte.burning-will.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.burning-will.attack","name":"hero-effect.fulinte.burning-will.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.burning-will.attack","name":"hero-effect.fulinte.burning-will.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.fulinte.burning-will.attack` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 3. 无尽烈火（`hero-skill.fulinte.endless-fire`）

- **实现名/原文**：弗林特·无尽烈火；全军穿透提升25%。
- **等级原数值**：`{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=—；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.endless-fire.penetration","name":"hero-effect.fulinte.endless-fire.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.endless-fire.penetration","name":"hero-effect.fulinte.endless-fire.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.endless-fire.penetration","name":"hero-effect.fulinte.endless-fire.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.endless-fire.penetration","name":"hero-effect.fulinte.endless-fire.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fulinte.endless-fire.penetration","name":"hero-effect.fulinte.endless-fire.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.fulinte.endless-fire.penetration` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 弗林特专武·龙之吐息（`hero-weapon-skill.fulinte.defense-attack`）

- **实现名/原文**：弗林特专武·龙之吐息；专武远征场景效果：attack Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fulinte.defense-attack","name":"hero-weapon-effect.fulinte.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fulinte.defense-attack","name":"hero-weapon-effect.fulinte.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fulinte.defense-attack","name":"hero-weapon-effect.fulinte.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fulinte.defense-attack","name":"hero-weapon-effect.fulinte.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fulinte.defense-attack","name":"hero-weapon-effect.fulinte.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.fulinte.defense-attack` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 菲兰德（矛，SSR，`hero.s2.feilande`）

远征静态属性（小数）：attack=2.4019；defense=2.4019；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 健身秘诀（`expedition.feilande.fitness-secret`） | 全军攻击提升15%、防御提升10%。 | `{"1":0.03,"2":0.06,"3":0.09,"4":0.12,"5":0.15}` | `hero-skill.feilande.fitness-secret` |
| 2 | 强化药剂（`expedition.feilande.strengthening-potion`） | 盾、矛、射每次主攻击各独立判定25%；成功后暂按该次主攻击 parentRawDamage 基准产生额外技能伤害（载体待战报验证），连射内部第二段不重判。 | `{"1":0.2,"2":0.4,"3":0.6,"4":0.8,"5":1}` | `hero-skill.feilande.strengthening-potion` |
| 3 | 提神针剂（`expedition.feilande.stimulant`） | 每回合40%概率使全军受到伤害降低50%。 | `{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}` | `hero-skill.feilande.stimulant` |

专武目录：基础属性上限 penetration=0.6、life=0.6；技能ID=`hero-weapon-skill.feilande.defense-life`；已录入阶梯数值=`{"hero-weapon-skill.feilande.defense-life":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 健身秘诀（`hero-skill.feilande.fitness-secret`）

- **实现名/原文**：菲兰德·健身秘诀；全军攻击提升15%、防御提升10%。
- **等级原数值**：`{"1":0.03,"2":0.06,"3":0.09,"4":0.12,"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=—；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.fitness-secret.attack","name":"hero-effect.feilande.fitness-secret.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.03,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.feilande.fitness-secret.defense","name":"hero-effect.feilande.fitness-secret.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.02,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.fitness-secret.attack","name":"hero-effect.feilande.fitness-secret.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.06,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.feilande.fitness-secret.defense","name":"hero-effect.feilande.fitness-secret.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.04,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.fitness-secret.attack","name":"hero-effect.feilande.fitness-secret.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.09,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.feilande.fitness-secret.defense","name":"hero-effect.feilande.fitness-secret.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.06,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.fitness-secret.attack","name":"hero-effect.feilande.fitness-secret.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.12,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.feilande.fitness-secret.defense","name":"hero-effect.feilande.fitness-secret.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.08,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.fitness-secret.attack","name":"hero-effect.feilande.fitness-secret.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroAttackBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.feilande.fitness-secret.defense","name":"hero-effect.feilande.fitness-secret.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.feilande.fitness-secret.attack` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |
| `hero-effect.feilande.fitness-secret.defense` | unverified | confirmed | 本轮最终确认：与盾兵钢铁守护同属 skillDefenseBonus，组内先相加，整组作为当前命中伤害的除数；不回写战报防御面板。 |

##### 2. 强化药剂（`hero-skill.feilande.strengthening-potion`）

- **实现名/原文**：菲兰德·强化药剂；盾、矛、射每次主攻击各独立判定25%；成功后暂按该次主攻击 parentRawDamage 基准产生额外技能伤害（载体待战报验证），连射内部第二段不重判。
- **等级原数值**：`{"1":0.2,"2":0.4,"3":0.6,"4":0.8,"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.25`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=—；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot2","perTroopMainAttackProc","noRapidFireReproc"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.strengthening-potion.extra","name":"hero-effect.feilande.strengthening-potion.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.2,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 2 | Expedition Lv.2 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.strengthening-potion.extra","name":"hero-effect.feilande.strengthening-potion.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.4,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 3 | Expedition Lv.3 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.strengthening-potion.extra","name":"hero-effect.feilande.strengthening-potion.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.6,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 4 | Expedition Lv.4 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.strengthening-potion.extra","name":"hero-effect.feilande.strengthening-potion.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.8,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 5 | Expedition Lv.5 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.strengthening-potion.extra","name":"hero-effect.feilande.strengthening-potion.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.feilande.strengthening-potion.extra` | provisional | provisional | 每回合一次25%判定和独立额外伤害已确认；成功后由哪些兵种主攻击承载子事件尚缺独立战报证据。当前保留每个存活兵种 parentRawDamage 载体实现，待验证。 |

##### 3. 提神针剂（`hero-skill.feilande.stimulant`）

- **实现名/原文**：菲兰德·提神针剂；每回合40%概率使全军受到伤害降低50%。
- **等级原数值**：`{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=—；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.stimulant","name":"hero-effect.feilande.stimulant","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |
| 2 | Expedition Lv.2 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.stimulant","name":"hero-effect.feilande.stimulant","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |
| 3 | Expedition Lv.3 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.stimulant","name":"hero-effect.feilande.stimulant","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |
| 4 | Expedition Lv.4 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.stimulant","name":"hero-effect.feilande.stimulant","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.4,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.feilande.stimulant","name":"hero-effect.feilande.stimulant","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.feilande.stimulant` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 4. 菲兰德专武·急救训练（`hero-weapon-skill.feilande.defense-life`）

- **实现名/原文**：菲兰德专武·急救训练；专武远征场景效果：life Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.feilande.defense-life","name":"hero-weapon-effect.feilande.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.feilande.defense-life","name":"hero-weapon-effect.feilande.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.feilande.defense-life","name":"hero-weapon-effect.feilande.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.feilande.defense-life","name":"hero-weapon-effect.feilande.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.feilande.defense-life","name":"hero-weapon-effect.feilande.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.feilande.defense-life` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffLife，生命按 (1+life)(1+buffLifeGroup)，组内来源先加算。 |

#### 阿隆索（射，SSR，`hero.s2.alongsuo`）

远征静态属性（小数）：attack=2.4019；defense=2.4019；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 惊涛骇浪（`expedition.alongsuo.stormy-waves`） | 每回合40%概率使全军当回合穿透提升50%。 | `{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}` | `hero-skill.alongsuo.stormy-waves` |
| 2 | 钢铁意志（`expedition.alongsuo.steel-will`） | 各存活兵种主攻击独立20%判定；命中目标栈从下一回合起穿透降低，持续2回合，重复触发覆盖并重新计时。 | `{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}` | `hero-skill.alongsuo.steel-will` |
| 3 | 锋锐鱼叉（`expedition.alongsuo.sharp-harpoon`） | 各兵种主攻击时独立50%判定，成功后按等级产生基于基础伤害B的额外技能伤害。 | `{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}` | `hero-skill.alongsuo.sharp-harpoon` |

专武目录：基础属性上限 penetration=0.6、life=0.6；技能ID=`hero-weapon-skill.alongsuo.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.alongsuo.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 惊涛骇浪（`hero-skill.alongsuo.stormy-waves`）

- **实现名/原文**：阿隆索·惊涛骇浪；每回合40%概率使全军当回合穿透提升50%。
- **等级原数值**：`{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=—；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.stormy-waves","name":"hero-effect.alongsuo.stormy-waves","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |
| 2 | Expedition Lv.2 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.stormy-waves","name":"hero-effect.alongsuo.stormy-waves","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |
| 3 | Expedition Lv.3 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.stormy-waves","name":"hero-effect.alongsuo.stormy-waves","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |
| 4 | Expedition Lv.4 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.stormy-waves","name":"hero-effect.alongsuo.stormy-waves","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.4,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.stormy-waves","name":"hero-effect.alongsuo.stormy-waves","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.alongsuo.stormy-waves` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 钢铁意志（`hero-skill.alongsuo.steel-will`）

- **实现名/原文**：阿隆索·钢铁意志；各存活兵种主攻击独立20%判定；命中目标栈从下一回合起穿透降低，持续2回合，重复触发覆盖并重新计时。
- **等级原数值**：`{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.2`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"nextRound"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`、`penetration`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot2","hitTargetTroop"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.steel-will.penetration-reduction","name":"hero-effect.alongsuo.steel-will.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.1,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}` |
| 2 | Expedition Lv.2 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.steel-will.penetration-reduction","name":"hero-effect.alongsuo.steel-will.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.2,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}` |
| 3 | Expedition Lv.3 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.steel-will.penetration-reduction","name":"hero-effect.alongsuo.steel-will.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.3,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}` |
| 4 | Expedition Lv.4 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.steel-will.penetration-reduction","name":"hero-effect.alongsuo.steel-will.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.4,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}` |
| 5 | Expedition Lv.5 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.steel-will.penetration-reduction","name":"hero-effect.alongsuo.steel-will.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.5,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.alongsuo.steel-will.penetration-reduction` | confirmed | confirmed | 最新真实战报验证：盾+矛存活1500回合约3000次判定、617次成功（20.57%）；效果只落在实际命中目标栈，属于穿透属性减益，同组相加后除以(1+Σ)，从下一回合起持续2回合，重复触发覆盖重新计时。 |

##### 3. 锋锐鱼叉（`hero-skill.alongsuo.sharp-harpoon`）

- **实现名/原文**：阿隆索·锋锐鱼叉；各兵种主攻击时独立50%判定，成功后按等级产生基于基础伤害B的额外技能伤害。
- **等级原数值**：`{"1":0.1,"2":0.2,"3":0.3,"4":0.4,"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.5`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=—；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | 50% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.sharp-harpoon","name":"hero-effect.alongsuo.sharp-harpoon","kind":"extraDamage","recipient":"selfArmy","coefficient":0.1,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 2 | Expedition Lv.2 | 50% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.sharp-harpoon","name":"hero-effect.alongsuo.sharp-harpoon","kind":"extraDamage","recipient":"selfArmy","coefficient":0.2,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 3 | Expedition Lv.3 | 50% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.sharp-harpoon","name":"hero-effect.alongsuo.sharp-harpoon","kind":"extraDamage","recipient":"selfArmy","coefficient":0.3,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 4 | Expedition Lv.4 | 50% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.sharp-harpoon","name":"hero-effect.alongsuo.sharp-harpoon","kind":"extraDamage","recipient":"selfArmy","coefficient":0.4,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 5 | Expedition Lv.5 | 50% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.alongsuo.sharp-harpoon","name":"hero-effect.alongsuo.sharp-harpoon","kind":"extraDamage","recipient":"selfArmy","coefficient":0.5,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.alongsuo.sharp-harpoon` | unverified | confirmed | 本轮最终确认：每个存活兵种主攻击独立判定，成功产生 parentBaseDamage 系数的独立 skillDamage/extraDamage 子事件；不继承普通攻击专属增伤。 |

##### 4. 阿隆索专武·鱼叉强化（`hero-weapon-skill.alongsuo.rally-penetration`）

- **实现名/原文**：阿隆索专武·鱼叉强化；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s2Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S2 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S2","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.alongsuo.rally-penetration","name":"hero-weapon-effect.alongsuo.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.alongsuo.rally-penetration","name":"hero-weapon-effect.alongsuo.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.alongsuo.rally-penetration","name":"hero-weapon-effect.alongsuo.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.alongsuo.rally-penetration","name":"hero-weapon-effect.alongsuo.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.alongsuo.rally-penetration","name":"hero-weapon-effect.alongsuo.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.alongsuo.rally-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

### S3

#### 罗根（盾，SSR，`hero.s3.luogen`）

远征静态属性（小数）：attack=2.9023；defense=2.9023；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 怒狮强袭（`expedition.luogen.angry-lion-assault`） | 敌军全体攻击力降低20%。 | `{"5":0.2}` | `hero-skill.luogen.angry-lion-assault` |
| 2 | 猛狮恫吓（`expedition.luogen.lion-intimidation`） | 我军全体受到伤害降低20%。 | `{"5":0.2}` | `hero-skill.luogen.lion-intimidation` |
| 3 | 烈火焚身（`expedition.luogen.burning-body`） | 全军生命提升25%，开场生效。 | `{"5":0.25}` | `hero-skill.luogen.burning-body` |

专武目录：基础属性上限 penetration=0.7、life=0.7；技能ID=`hero-weapon-skill.luogen.defense-defense`；已录入阶梯数值=`{"hero-weapon-skill.luogen.defense-defense":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 怒狮强袭（`hero-skill.luogen.angry-lion-assault`）

- **实现名/原文**：罗根·怒狮强袭；敌军全体攻击力降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.luogen.angry-lion-assault","name":"hero-effect.luogen.angry-lion-assault","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.luogen.angry-lion-assault` | unverified | confirmed | 独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyAttackReduction 为战报攻击属性除法削减组，同组先加算。 |

##### 2. 猛狮恫吓（`hero-skill.luogen.lion-intimidation`）

- **实现名/原文**：罗根·猛狮恫吓；我军全体受到伤害降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.luogen.lion-intimidation","name":"hero-effect.luogen.lion-intimidation","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.luogen.lion-intimidation` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 3. 烈火焚身（`hero-skill.luogen.burning-body`）

- **实现名/原文**：罗根·烈火焚身；全军生命提升25%，开场生效。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.luogen.burning-body","name":"hero-effect.luogen.burning-body","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.luogen.burning-body` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 罗根专武·铁壁守护（`hero-weapon-skill.luogen.defense-defense`）

- **实现名/原文**：罗根专武·铁壁守护；专武远征场景效果：defense Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.luogen.defense-defense","name":"hero-weapon-effect.luogen.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.luogen.defense-defense","name":"hero-weapon-effect.luogen.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.luogen.defense-defense","name":"hero-weapon-effect.luogen.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.luogen.defense-defense","name":"hero-weapon-effect.luogen.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.luogen.defense-defense","name":"hero-weapon-effect.luogen.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.luogen.defense-defense` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffDefense，组内来源先加算，并与普通 defenseBonus 分开。 |

#### 米娅（矛，SSR，`hero.s3.miya`）

远征静态属性（小数）：attack=2.9023；defense=2.9023；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 厄运缠身（`expedition.miya.doom-entanglement`） | 三兵种每回合各一次普通攻击，每次50%独立触发；仅命中目标栈在下一回合易伤50%，持续1回合。 | `{"5":0.5}` | `hero-skill.miya.doom-entanglement` |
| 2 | 幸运加护（`expedition.miya.lucky-blessing`） | 每回合一次50%判定，触发时全军当回合造成伤害提升50%。 | `{"5":0.5}` | `hero-skill.miya.lucky-blessing` |
| 3 | 秘义解读（`expedition.miya.secret-interpretation`） | 每回合一次40%判定，触发时全军当回合受到伤害降低50%。 | `{"5":0.5}` | `hero-skill.miya.secret-interpretation` |

专武目录：基础属性上限 penetration=0.7、life=0.7；技能ID=`hero-weapon-skill.miya.rally-attack`；已录入阶梯数值=`{"hero-weapon-skill.miya.rally-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 厄运缠身（`hero-skill.miya.doom-entanglement`）

- **实现名/原文**：米娅·厄运缠身；三兵种每回合各一次普通攻击，每次50%独立触发；仅命中目标栈在下一回合易伤50%，持续1回合。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.5`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"nextRound"`；durationRounds=`1`；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`vulnerability`；代码 effect kind=incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot1","hitTargetTroop","perTroopAttack","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 50% | duration=1；cooldown=— | period=—；start=— | `{"id":"hero-effect.miya.doom-entanglement","name":"hero-effect.miya.doom-entanglement","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.5,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.miya.doom-entanglement` | unverified | confirmed | 独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 2. 幸运加护（`hero-skill.miya.lucky-blessing`）

- **实现名/原文**：米娅·幸运加护；每回合一次50%判定，触发时全军当回合造成伤害提升50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.5`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=`1`；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot2","oncePerRound","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 50% | duration=1；cooldown=— | period=—；start=— | `{"id":"hero-effect.miya.lucky-blessing","name":"hero-effect.miya.lucky-blessing","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.miya.lucky-blessing` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 3. 秘义解读（`hero-skill.miya.secret-interpretation`）

- **实现名/原文**：米娅·秘义解读；每回合一次40%判定，触发时全军当回合受到伤害降低50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=`1`；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot3","oncePerRound"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=1；cooldown=— | period=—；start=— | `{"id":"hero-effect.miya.secret-interpretation","name":"hero-effect.miya.secret-interpretation","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.miya.secret-interpretation` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 4. 米娅专武·宿命的集结（`hero-weapon-skill.miya.rally-attack`）

- **实现名/原文**：米娅专武·宿命的集结；专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.miya.rally-attack","name":"hero-weapon-effect.miya.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.miya.rally-attack","name":"hero-weapon-effect.miya.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.miya.rally-attack","name":"hero-weapon-effect.miya.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.miya.rally-attack","name":"hero-weapon-effect.miya.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.miya.rally-attack","name":"hero-weapon-effect.miya.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.miya.rally-attack` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 格雷格（射，SSR，`hero.s3.gelaige`）

远征静态属性（小数）：attack=2.9023；defense=2.9023；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 正义之剑（`expedition.gelaige.sword-of-justice`） | 每回合一次20%判定；触发当回合全军伤害提升40%，持续3回合，重复触发覆盖并重新计时。 | `{"5":0.4}` | `hero-skill.gelaige.sword-of-justice` |
| 2 | 律令威慑（`expedition.gelaige.law-deterrence`） | 各兵种攻击时独立20%判定；命中目标栈造成伤害降低50%，立即生效2回合，重复触发覆盖。 | `{"5":0.5}` | `hero-skill.gelaige.law-deterrence` |
| 3 | 秩序庇护（`expedition.gelaige.order-protection`） | 全军生命提升25%，开场生效。 | `{"5":0.25}` | `hero-skill.gelaige.order-protection` |

专武目录：基础属性上限 penetration=0.7、life=0.7；技能ID=`hero-weapon-skill.gelaige.rally-life`；已录入阶梯数值=`{"hero-weapon-skill.gelaige.rally-life":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 正义之剑（`hero-skill.gelaige.sword-of-justice`）

- **实现名/原文**：格雷格·正义之剑；每回合一次20%判定；触发当回合全军伤害提升40%，持续3回合，重复触发覆盖并重新计时。
- **等级原数值**：`{"5":0.4}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.2`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=`3`；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot1","oncePerRound","bearModelSemantic","replaceOnRetrigger"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 20% | duration=3；cooldown=— | period=—；start=— | `{"id":"hero-effect.gelaige.sword-of-justice","name":"hero-effect.gelaige.sword-of-justice","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.4,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":3,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gelaige.sword-of-justice` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 2. 律令威慑（`hero-skill.gelaige.law-deterrence`）

- **实现名/原文**：格雷格·律令威慑；各兵种攻击时独立20%判定；命中目标栈造成伤害降低50%，立即生效2回合，重复触发覆盖。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.2`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=`2`；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot2","hitTargetTroop","perTroopAttack","replaceOnRetrigger"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 20% | duration=2；cooldown=— | period=—；start=— | `{"id":"hero-effect.gelaige.law-deterrence","name":"hero-effect.gelaige.law-deterrence","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"enemyOutgoingDamageReduction","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gelaige.law-deterrence` | unverified | confirmed | 独立证据：兵种及格雷格规则明确该类为 enemy outgoing damage reduction，区别于直接抵消；阿隆索钢铁意志属于穿透属性减益，不在本组。 |

##### 3. 秩序庇护（`hero-skill.gelaige.order-protection`）

- **实现名/原文**：格雷格·秩序庇护；全军生命提升25%，开场生效。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gelaige.order-protection","name":"hero-effect.gelaige.order-protection","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gelaige.order-protection` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 格雷格专武·正义的号角（`hero-weapon-skill.gelaige.rally-life`）

- **实现名/原文**：格雷格专武·正义的号角；专武远征场景效果：life Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s3Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S3 expedition PVP rules, synchronized 2026-09-20"`；templateSource=—；tags=`["S3","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gelaige.rally-life","name":"hero-weapon-effect.gelaige.rally-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gelaige.rally-life","name":"hero-weapon-effect.gelaige.rally-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gelaige.rally-life","name":"hero-weapon-effect.gelaige.rally-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gelaige.rally-life","name":"hero-weapon-effect.gelaige.rally-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gelaige.rally-life","name":"hero-weapon-effect.gelaige.rally-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.gelaige.rally-life` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffLife，生命按 (1+life)(1+buffLifeGroup)，组内来源先加算。 |

### S4

#### 阿赫莫斯（盾，SSR，`hero.s4.ahemosi`）

远征静态属性（小数）：attack=3.7029；defense=3.7029；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 腹蛇方阵（`expedition.ahemosi.viper-phalanx`） | 盾兵每完成4次主攻击后跳过下一次；跳过回合及下一回合盾兵减伤70%、矛兵/射手减伤30%。 | `{"5":0.7}` | `hero-skill.ahemosi.viper-phalanx` |
| 2 | 火之祝祷（`expedition.ahemosi.fire-blessing`） | 盾兵造成伤害提升100%。 | `{"5":1}` | `hero-skill.ahemosi.fire-blessing` |
| 3 | 光铸之刃（`expedition.ahemosi.light-forged-blade`） | 盾兵主攻击附加60% extraDamage，并使命中目标下一回合易伤25%。 | `{"5":0.6}` | `hero-skill.ahemosi.light-forged-blade` |

专武目录：基础属性上限 penetration=0.925、life=0.925；技能ID=`hero-weapon-skill.ahemosi.defense-life`；已录入阶梯数值=`{"hero-weapon-skill.ahemosi.defense-life":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 腹蛇方阵（`hero-skill.ahemosi.viper-phalanx`）

- **实现名/原文**：阿赫莫斯·腹蛇方阵；盾兵每完成4次主攻击后跳过下一次；跳过回合及下一回合盾兵减伤70%、矛兵/射手减伤30%。
- **等级原数值**：`{"5":0.7}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"skipMainAttack","sourceTroop":"shield","afterCompletedAttacks":4}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"lancer","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"marksman","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional、provisional、provisional。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot1","usesAttackCount","skipMainAttack"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ahemosi.viper-phalanx.shield-reduction","name":"hero-effect.ahemosi.viper-phalanx.shield-reduction","kind":"damageReduction","recipient":"selfArmy","group":"viperPhalanxShieldReduction","value":0.7,"scope":{"source":"army","target":"shield","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.ahemosi.viper-phalanx.lancer-reduction","name":"hero-effect.ahemosi.viper-phalanx.lancer-reduction","kind":"damageReduction","recipient":"selfArmy","group":"viperPhalanxOtherReduction","value":0.3,"scope":{"source":"army","target":"lancer","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.ahemosi.viper-phalanx.marksman-reduction","name":"hero-effect.ahemosi.viper-phalanx.marksman-reduction","kind":"damageReduction","recipient":"selfArmy","group":"viperPhalanxOtherReduction","value":0.3,"scope":{"source":"army","target":"marksman","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ahemosi.viper-phalanx.shield-reduction` | provisional | provisional | 技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.ahemosi.viper-phalanx.lancer-reduction` | provisional | provisional | 技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.ahemosi.viper-phalanx.marksman-reduction` | provisional | provisional | 技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 2. 火之祝祷（`hero-skill.ahemosi.fire-blessing`）

- **实现名/原文**：阿赫莫斯·火之祝祷；盾兵造成伤害提升100%。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot2","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ahemosi.fire-blessing","name":"hero-effect.ahemosi.fire-blessing","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":1,"scope":{"source":"shield","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ahemosi.fire-blessing` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 3. 光铸之刃（`hero-skill.ahemosi.light-forged-blade`）

- **实现名/原文**：阿赫莫斯·光铸之刃；盾兵主攻击附加60% extraDamage，并使命中目标下一回合易伤25%。
- **等级原数值**：`{"5":0.6}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`vulnerability`；代码 effect kind=extraDamage、incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot3","hitTargetTroop","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ahemosi.light-forged-blade.extra","name":"hero-effect.ahemosi.light-forged-blade.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.6,"basis":"parentRawDamage","scope":{"source":"shield","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.ahemosi.light-forged-blade.vulnerability","name":"hero-effect.ahemosi.light-forged-blade.vulnerability","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.25,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ahemosi.light-forged-blade.extra` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.ahemosi.light-forged-blade.vulnerability` | unverified | confirmed | 独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 4. 阿赫莫斯专武·守城生命（`hero-weapon-skill.ahemosi.defense-life`）

- **实现名/原文**：阿赫莫斯专武·守城生命；专武远征场景效果：life Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ahemosi.defense-life","name":"hero-weapon-effect.ahemosi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ahemosi.defense-life","name":"hero-weapon-effect.ahemosi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ahemosi.defense-life","name":"hero-weapon-effect.ahemosi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ahemosi.defense-life","name":"hero-weapon-effect.ahemosi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ahemosi.defense-life","name":"hero-weapon-effect.ahemosi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.ahemosi.defense-life` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffLife，生命按 (1+life)(1+buffLifeGroup)，组内来源先加算。 |

#### 玲奈（矛，SSR，`hero.s4.lingnai`）

远征静态属性（小数）：attack=3.7029；defense=3.7029；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 刺客本能（`expedition.lingnai.assassin-instinct`） | 全军普通攻击伤害提升30%。 | `{"5":0.3}` | `hero-skill.lingnai.assassin-instinct` |
| 2 | 迅影舞步（`expedition.lingnai.swift-shadow-dance`） | 敌方每次主攻击独立判定闪避；Lv2 8%、Lv5 20%。仅取消普通攻击命中，不取消此前已触发的额外伤害。 | `{"2":0.08,"5":0.2}` | `hero-skill.lingnai.swift-shadow-dance` |
| 3 | 影刃（`expedition.lingnai.shadow-blade`） | 矛兵每次主攻击尝试独立25%判定；Lv4 附加180%、Lv5 附加200% extraDamage，闪避前判定。 | `{"4":1.8,"5":2}` | `hero-skill.lingnai.shadow-blade` |

专武目录：基础属性上限 penetration=0.925、life=0.925；技能ID=`hero-weapon-skill.lingnai.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.lingnai.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 刺客本能（`hero-skill.lingnai.assassin-instinct`）

- **实现名/原文**：玲奈·刺客本能；全军普通攻击伤害提升30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"normalAttack"}}`。
- **类型**：`normalAttackDamage`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot1","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lingnai.assassin-instinct","name":"hero-effect.lingnai.assassin-instinct","kind":"damageIncrease","recipient":"selfArmy","group":"normalAttackDamageIncrease","value":0.3,"scope":{"source":"army","target":"all","damageType":"normalAttack"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.lingnai.assassin-instinct` | unverified | confirmed | 独立证据：兵种规则附件 3d5dff55.../pasted-text.txt 与打熊权威文档明确 normalAttackDamageIncrease 是仅作用普攻的独立增伤区，不并入 attack 或普通 damageIncrease。 |

##### 2. 迅影舞步（`hero-skill.lingnai.swift-shadow-dance`）

- **实现名/原文**：玲奈·迅影舞步；敌方每次主攻击独立判定闪避；Lv2 8%、Lv5 20%。仅取消普通攻击命中，不取消此前已触发的额外伤害。
- **等级原数值**：`{"2":0.08,"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.2`；行动机制=`{"kind":"dodgeNormalAttack"}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：无 effect scope；见行动机制。
- **类型**：行动机制（无 effect）；代码 effect kind=无。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot2","dodgeNormalAttack","sharedRapidFireRoll"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 2 | Expedition Lv.2 | 8% | duration=—；cooldown=— | period=—；start=— | 无 effect；行动机制见上 |
| 5 | Expedition Lv.5 | 20% | duration=—；cooldown=— | period=—；start=— | 无 effect；行动机制见上 |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `无 effect/行动机制` | confirmed | confirmed | 真实战报与本轮明确规则确认：Lv2 8% 闪避只取消主普攻；闪避前已成功触发的连射、燃晶火药、影刃仍结算。该条目没有 ActiveEffect 乘区。 |

##### 3. 影刃（`hero-skill.lingnai.shadow-blade`）

- **实现名/原文**：玲奈·影刃；矛兵每次主攻击尝试独立25%判定；Lv4 附加180%、Lv5 附加200% extraDamage，闪避前判定。
- **等级原数值**：`{"4":1.8,"5":2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=`0.25`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot3","mainAttackAttempt","preDodge","extraDamageNotAdditionalAttack"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 4 | Expedition Lv.4 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lingnai.shadow-blade.extra","name":"hero-effect.lingnai.shadow-blade.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1.8,"basis":"parentRawDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}` |
| 5 | Expedition Lv.5 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lingnai.shadow-blade.extra","name":"hero-effect.lingnai.shadow-blade.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":2,"basis":"parentRawDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.lingnai.shadow-blade.extra` | confirmed | confirmed | 真实战报 6000 次矛兵主攻击尝试触发 1511 次，支持每次矛兵主攻击尝试按 25% 判定；明确规则确认 Lv4 180% 独立 extraDamage 且在闪避前判定。 |

##### 4. 玲奈专武·集结穿透（`hero-weapon-skill.lingnai.rally-penetration`）

- **实现名/原文**：玲奈专武·集结穿透；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lingnai.rally-penetration","name":"hero-weapon-effect.lingnai.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lingnai.rally-penetration","name":"hero-weapon-effect.lingnai.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lingnai.rally-penetration","name":"hero-weapon-effect.lingnai.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lingnai.rally-penetration","name":"hero-weapon-effect.lingnai.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lingnai.rally-penetration","name":"hero-weapon-effect.lingnai.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.lingnai.rally-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

#### 琳恩（射，SSR，`hero.s4.linen`）

远征静态属性（小数）：attack=3.7029；defense=3.7029；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 雄狮之歌（`expedition.linen.lion-song`） | 每回合40%概率使全军当回合穿透提升50%。 | `{"5":0.5}` | `hero-skill.linen.lion-song` |
| 2 | 悲戚之音（`expedition.linen.sorrowful-sound`） | 敌军全体穿透降低20%。 | `{"5":0.2}` | `hero-skill.linen.sorrowful-sound` |
| 3 | 欧纳伊华（`expedition.linen.onaihua`） | 射手每完成3次主攻击，自身攻击叠加5%；无层数上限，持续至战斗结束。 | `{"5":0.05}` | `hero-skill.linen.onaihua` |

专武目录：基础属性上限 penetration=0.925、life=0.925；技能ID=`hero-weapon-skill.linen.defense-penetration`；已录入阶梯数值=`{"hero-weapon-skill.linen.defense-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 雄狮之歌（`hero-skill.linen.lion-song`）

- **实现名/原文**：琳恩·雄狮之歌；每回合40%概率使全军当回合穿透提升50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot1","oncePerRound","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.linen.lion-song","name":"hero-effect.linen.lion-song","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"heroPenetrationBonus","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.linen.lion-song` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 悲戚之音（`hero-skill.linen.sorrowful-sound`）

- **实现名/原文**：琳恩·悲戚之音；敌军全体穿透降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`、`penetration`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.linen.sorrowful-sound","name":"hero-effect.linen.sorrowful-sound","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.linen.sorrowful-sound` | unverified | confirmed | 独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyPenetrationReduction 为战报穿透属性除法削减组，同组先加算。 |

##### 3. 欧纳伊华（`hero-skill.linen.onaihua`）

- **实现名/原文**：琳恩·欧纳伊华；射手每完成3次主攻击，自身攻击叠加5%；无层数上限，持续至战斗结束。
- **等级原数值**：`{"5":0.05}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":3,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","expeditionSlot3","usesAttackCount","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.linen.onaihua.marksman-attack","name":"hero-effect.linen.onaihua.marksman-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"heroMarksmanAttackStack","value":0.05,"scope":{"source":"marksman","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","refreshMode":"stack"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.linen.onaihua.marksman-attack` | provisional | provisional | 本轮规则确认每3次实际射手主攻击后下回合加层，同组为 1+0.05×层数、最多3层；但尚无独立证据证明其专属 group 应与通用 heroAttackBonus 异区，故乘区关系仍为 provisional。 |

##### 4. 琳恩专武·守城穿透（`hero-weapon-skill.linen.defense-penetration`）

- **实现名/原文**：琳恩专武·守城穿透；专武远征场景效果：penetration Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s4Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20"`；templateSource=—；tags=`["S4","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.linen.defense-penetration","name":"hero-weapon-effect.linen.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.linen.defense-penetration","name":"hero-weapon-effect.linen.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.linen.defense-penetration","name":"hero-weapon-effect.linen.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.linen.defense-penetration","name":"hero-weapon-effect.linen.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.linen.defense-penetration","name":"hero-weapon-effect.linen.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.linen.defense-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

### S5

#### 赫克托（盾，SSR，`hero.s5.heketuo`）

远征静态属性（小数）：attack=4.4435；defense=4.4435；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 生存本能（`expedition.heketuo.survival-instinct`） | 每回合40%概率使全军当回合受到伤害降低50%。 | `{"5":0.5}` | `hero-skill.heketuo.survival-instinct` |
| 2 | 雷霆出击（`expedition.heketuo.thunder-strike`） | 盾兵初始普通增伤乘区+200%、射手+100%，同一兵种每次主攻击后按85%衰减，覆盖10次；此处普通增伤按 scope 作用于普攻与技能伤害。 | `{"5":2}` | `hero-skill.heketuo.thunder-strike` |
| 3 | 疾风猛击（`expedition.heketuo.gale-strike`） | 每个兵种成功主攻击后独立25%判定，触发1倍基础伤害的额外技能事件。 | `{"5":1}` | `hero-skill.heketuo.gale-strike` |

专武目录：基础属性上限 penetration=1.11、life=1.11；技能ID=`hero-weapon-skill.heketuo.defense-attack`；已录入阶梯数值=`{"hero-weapon-skill.heketuo.defense-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 生存本能（`hero-skill.heketuo.survival-instinct`）

- **实现名/原文**：赫克托·生存本能；每回合40%概率使全军当回合受到伤害降低50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot1","oncePerRound","jasmineReductionTemplate","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.heketuo.survival-instinct","name":"hero-effect.heketuo.survival-instinct","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.heketuo.survival-instinct` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 2. 雷霆出击（`hero-skill.heketuo.thunder-strike`）

- **实现名/原文**：赫克托·雷霆出击；盾兵初始普通增伤乘区+200%、射手+100%，同一兵种每次主攻击后按85%衰减，覆盖10次；此处普通增伤按 scope 作用于普攻与技能伤害。
- **等级原数值**：`{"5":2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=decayingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot2","usesAttackCount","bearModelSemantic","normalAttackDamageNotExtra"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.heketuo.thunder-strike","name":"hero-effect.heketuo.thunder-strike","kind":"decayingDamageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","initialValues":{"shield":2,"marksman":1},"decayFactor":0.85,"maxMainAttacks":10,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.heketuo.thunder-strike` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 3. 疾风猛击（`hero-skill.heketuo.gale-strike`）

- **实现名/原文**：赫克托·疾风猛击；每个兵种成功主攻击后独立25%判定，触发1倍基础伤害的额外技能事件。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=`0.25`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot3","postDodge","perSuccessfulMainAttack","extraDamageNotAdditionalAttack"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.heketuo.gale-strike.extra","name":"赫克托·疾风猛击额外伤害","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.heketuo.gale-strike.extra` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 4. 赫克托专武·守城攻击（`hero-weapon-skill.heketuo.defense-attack`）

- **实现名/原文**：赫克托专武·守城攻击；专武远征场景效果：attack Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heketuo.defense-attack","name":"hero-weapon-effect.heketuo.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heketuo.defense-attack","name":"hero-weapon-effect.heketuo.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heketuo.defense-attack","name":"hero-weapon-effect.heketuo.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heketuo.defense-attack","name":"hero-weapon-effect.heketuo.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.heketuo.defense-attack","name":"hero-weapon-effect.heketuo.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.heketuo.defense-attack` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 诺拉（矛，SSR，`hero.s5.nuola`）

远征静态属性（小数）：attack=4.4435；defense=4.4435；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 多兵种作战（`expedition.nuola.multi-troop-combat`） | 盾/射造成伤害+15%，盾/射受到伤害降低15%。 | `{"5":0.15}` | `hero-skill.nuola.multi-troop-combat` |
| 2 | 攻其不备（`expedition.nuola.catch-off-guard`） | 矛兵成功主攻击后20%判定；每个存活敌军兵种分别受到100% extraDamage。 | `{"5":1}` | `hero-skill.nuola.catch-off-guard` |
| 3 | 乘势追击（`expedition.nuola.momentum-pursuit`） | 矛兵每完成5次成功主攻击后，全军从下一回合起增伤25%、减伤25%，持续2回合。 | `{"5":0.25}` | `hero-skill.nuola.momentum-pursuit` |

专武目录：基础属性上限 penetration=1.11、life=1.11；技能ID=`hero-weapon-skill.nuola.defense-defense`；已录入阶梯数值=`{"hero-weapon-skill.nuola.defense-defense":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 多兵种作战（`hero-skill.nuola.multi-troop-combat`）

- **实现名/原文**：诺拉·多兵种作战；盾/射造成伤害+15%，盾/射受到伤害降低15%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"marksman","damageType":"all"}}`。
- **类型**：`damageIncrease`、`reduction`；代码 effect kind=damageIncrease、damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed、confirmed、confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot1","bearModelSemantic","pvpStaticReduction"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.nuola.multi-troop-combat.shield-damage","name":"hero-effect.nuola.multi-troop-combat.shield-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.15,"scope":{"source":"shield","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.nuola.multi-troop-combat.marksman-damage","name":"hero-effect.nuola.multi-troop-combat.marksman-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.15,"scope":{"source":"marksman","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.nuola.multi-troop-combat.shield-reduction","name":"hero-effect.nuola.multi-troop-combat.shield-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.15,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.nuola.multi-troop-combat.marksman-reduction","name":"hero-effect.nuola.multi-troop-combat.marksman-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.15,"scope":{"source":"army","target":"marksman","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.nuola.multi-troop-combat.shield-damage` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.nuola.multi-troop-combat.marksman-damage` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.nuola.multi-troop-combat.shield-reduction` | unverified | confirmed | 本轮最终规则明确盾兵受伤降低15%与其他 receivedDamageReduction 同组加算。 |
| `hero-effect.nuola.multi-troop-combat.marksman-reduction` | unverified | confirmed | 本轮最终规则明确射手受伤降低15%与其他 receivedDamageReduction 同组加算。 |

##### 2. 攻其不备（`hero-skill.nuola.catch-off-guard`）

- **实现名/原文**：诺拉·攻其不备；矛兵成功主攻击后20%判定；每个存活敌军兵种分别受到100% extraDamage。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=`0.2`；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"lancer","interval":1,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"all","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot2","usesAttackCount","multiTargetExtraDamage"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.nuola.catch-off-guard.all-enemies","name":"hero-effect.nuola.catch-off-guard.all-enemies","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentRawDamage","scope":{"source":"lancer","target":"all","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.nuola.catch-off-guard.all-enemies` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 3. 乘势追击（`hero-skill.nuola.momentum-pursuit`）

- **实现名/原文**：诺拉·乘势追击；矛兵每完成5次成功主攻击后，全军从下一回合起增伤25%、减伤25%，持续2回合。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"lancer","interval":5,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`、`reduction`；代码 effect kind=damageIncrease、damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot3","usesAttackCount","replaceOnRetrigger"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.nuola.momentum-pursuit.damage","name":"hero-effect.nuola.momentum-pursuit.damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.nuola.momentum-pursuit.reduction","name":"hero-effect.nuola.momentum-pursuit.reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.nuola.momentum-pursuit.damage` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.nuola.momentum-pursuit.reduction` | unverified | confirmed | 独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 4. 诺拉专武·守城防御（`hero-weapon-skill.nuola.defense-defense`）

- **实现名/原文**：诺拉专武·守城防御；专武远征场景效果：defense Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nuola.defense-defense","name":"hero-weapon-effect.nuola.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nuola.defense-defense","name":"hero-weapon-effect.nuola.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nuola.defense-defense","name":"hero-weapon-effect.nuola.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nuola.defense-defense","name":"hero-weapon-effect.nuola.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.nuola.defense-defense","name":"hero-weapon-effect.nuola.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.nuola.defense-defense` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffDefense，组内来源先加算，并与普通 defenseBonus 分开。 |

#### 格温（射，SSR，`hero.s5.gewen`）

远征静态属性（小数）：attack=4.4435；defense=4.4435；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 鹰之视野（`expedition.gewen.eagle-vision`） | 全军主攻击命中目标后，使该目标从下一回合起永久易伤25%，同目标不叠层。 | `{"5":0.25}` | `hero-skill.gewen.eagle-vision` |
| 2 | 空中压制（`expedition.gewen.aerial-suppression`） | 各兵种第6、12、18次成功主攻击附加100% extraDamage，并给目标一次性15%易伤覆盖令牌。 | `{"5":1}` | `hero-skill.gewen.aerial-suppression` |
| 3 | 爆破小队（`expedition.gewen.demolition-squad`） | 射手第5、10、15次主攻击尝试时，对每个存活敌军兵种分别造成50% extraDamage；主攻闪避不取消。 | `{"5":0.5}` | `hero-skill.gewen.demolition-squad` |

专武目录：基础属性上限 penetration=1.11、life=1.11；技能ID=`hero-weapon-skill.gewen.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.gewen.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 鹰之视野（`hero-skill.gewen.eagle-vision`）

- **实现名/原文**：格温·鹰之视野；全军主攻击命中目标后，使该目标从下一回合起永久易伤25%，同目标不叠层。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`vulnerability`；代码 effect kind=incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot1","hitTargetTroop","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gewen.eagle-vision.vulnerability","name":"hero-effect.gewen.eagle-vision.vulnerability","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.25,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","refreshMode":"replace","maxStacks":1}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gewen.eagle-vision.vulnerability` | unverified | confirmed | 独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 2. 空中压制（`hero-skill.gewen.aerial-suppression`）

- **实现名/原文**：格温·空中压制；各兵种第6、12、18次成功主攻击附加100% extraDamage，并给目标一次性15%易伤覆盖令牌。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"army","interval":6,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`vulnerability`；代码 effect kind=extraDamage、oneUseIncomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot2","usesAttackCount","hitTargetTroop","bearModelSemantic","gwenAerialTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gewen.aerial-suppression.extra","name":"hero-effect.gewen.aerial-suppression.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.gewen.aerial-suppression.vulnerability","name":"格温·空中压制一次性易伤","kind":"oneUseIncomingDamageIncrease","recipient":"enemyArmy","group":"aerialSuppressionOverride","value":0.15,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"immediate","refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gewen.aerial-suppression.extra` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.gewen.aerial-suppression.vulnerability` | confirmed | confirmed | 本轮实战确认特殊 Bug：下一笔实际结算 DamageEvent 临时只取15%易伤，覆盖其余普通易伤；消费后原普通易伤保留。 |

##### 3. 爆破小队（`hero-skill.gewen.demolition-squad`）

- **实现名/原文**：格温·爆破小队；射手第5、10、15次主攻击尝试时，对每个存活敌军兵种分别造成50% extraDamage；主攻闪避不取消。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":5,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","expeditionSlot3","usesAttackCount","preDodge","mainAttackAttempt","multiTargetExtraDamage"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gewen.demolition-squad.all-enemies","name":"hero-effect.gewen.demolition-squad.all-enemies","kind":"extraDamage","recipient":"selfArmy","coefficient":0.5,"basis":"parentRawDamage","scope":{"source":"marksman","target":"all","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gewen.demolition-squad.all-enemies` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 4. 格温专武·集结穿透（`hero-weapon-skill.gewen.rally-penetration`）

- **实现名/原文**：格温专武·集结穿透；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s5Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt"`；templateSource=—；tags=`["S5","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gewen.rally-penetration","name":"hero-weapon-effect.gewen.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gewen.rally-penetration","name":"hero-weapon-effect.gewen.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gewen.rally-penetration","name":"hero-weapon-effect.gewen.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gewen.rally-penetration","name":"hero-weapon-effect.gewen.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gewen.rally-penetration","name":"hero-weapon-effect.gewen.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.gewen.rally-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

### S6

#### 无名（盾，SSR，`hero.s6.wuming`）

远征静态属性（小数）：attack=5.4043；defense=5.4043；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 避风扑雨（`expedition.wuming.wind-shelter`） | 盾兵受到普通攻击降低25%，受到技能伤害降低30%。 | `{"5":0.3}` | `hero-skill.wuming.wind-shelter` |
| 2 | 半月冲雪（`expedition.wuming.half-moon`） | 全军造成伤害提升20%。 | `{"5":0.2}` | `hero-skill.wuming.half-moon` |
| 3 | 四象分明（`expedition.wuming.four-images`） | 全军技能伤害提升25%，包括extraDamage。 | `{"5":0.25}` | `hero-skill.wuming.four-images` |

专武目录：基础属性上限 penetration=1.335、life=1.335；技能ID=`hero-weapon-skill.wuming.defense-defense`；已录入阶梯数值=`{"hero-weapon-skill.wuming.defense-defense":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 避风扑雨（`hero-skill.wuming.wind-shelter`）

- **实现名/原文**：无名·避风扑雨；盾兵受到普通攻击降低25%，受到技能伤害降低30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"normalAttack"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"skillDamage"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.wuming.wind-shelter.normal","name":"hero-effect.wuming.wind-shelter.normal","kind":"damageReduction","recipient":"selfArmy","group":"receivedNormalAttackReduction","value":0.25,"scope":{"source":"army","target":"shield","damageType":"normalAttack"}}`<br>`{"id":"hero-effect.wuming.wind-shelter.skill","name":"hero-effect.wuming.wind-shelter.skill","kind":"damageReduction","recipient":"selfArmy","group":"receivedSkillDamageReduction","value":0.3,"scope":{"source":"army","target":"shield","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.wuming.wind-shelter.normal` | unverified | confirmed | 独立证据：已确认伤害类型规则明确普攻减伤只匹配 normalAttack，作为 receivedNormalAttackReduction 独立小区。 |
| `hero-effect.wuming.wind-shelter.skill` | unverified | confirmed | 独立证据：已确认伤害类型规则明确技能减伤匹配 skillDamage，并覆盖 extraDamage，作为 receivedSkillDamageReduction 独立小区。 |

##### 2. 半月冲雪（`hero-skill.wuming.half-moon`）

- **实现名/原文**：无名·半月冲雪；全军造成伤害提升20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","expeditionSlot2","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.wuming.half-moon","name":"hero-effect.wuming.half-moon","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.wuming.half-moon` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 3. 四象分明（`hero-skill.wuming.four-images`）

- **实现名/原文**：无名·四象分明；全军技能伤害提升25%，包括extraDamage。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"skillDamage"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","expeditionSlot3","bearModelSemantic","includesExtraDamage"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.wuming.four-images","name":"hero-effect.wuming.four-images","kind":"damageIncrease","recipient":"selfArmy","group":"skillDamageIncrease","value":0.25,"scope":{"source":"army","target":"all","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.wuming.four-images` | unverified | confirmed | 独立证据：打熊权威 docs/skill-multiplier-system.md 明确 skillDamageIncrease 为只匹配技能伤害的独立增伤区。 |

##### 4. 无名专武·守城防御（`hero-weapon-skill.wuming.defense-defense`）

- **实现名/原文**：无名专武·守城防御；专武远征场景效果：defense Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.wuming.defense-defense","name":"hero-weapon-effect.wuming.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.wuming.defense-defense","name":"hero-weapon-effect.wuming.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.wuming.defense-defense","name":"hero-weapon-effect.wuming.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.wuming.defense-defense","name":"hero-weapon-effect.wuming.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.wuming.defense-defense","name":"hero-weapon-effect.wuming.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.wuming.defense-defense` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffDefense，组内来源先加算，并与普通 defenseBonus 分开。 |

#### 芮妮（矛，SSR，`hero.s6.ruini`）

远征静态属性（小数）：attack=5.4043；defense=5.4043；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 惊梦留痕（`expedition.ruini.dream-mark`） | 矛兵每2次主攻击尝试在闪避前标记选定目标；下回合对该目标造成200%独立技能额外伤害。 | `{"5":2}` | `hero-skill.ruini.dream-mark` |
| 2 | 捕梦手（`expedition.ruini.dream-catcher`） | 矛兵对DreamMark目标伤害提升150%。 | `{"5":1.5}` | `hero-skill.ruini.dream-catcher` |
| 3 | 梦境切片（`expedition.ruini.dream-fragment`） | 全军对DreamMark目标伤害提升75%。 | `{"5":0.75}` | `hero-skill.ruini.dream-fragment` |

专武目录：基础属性上限 penetration=1.335、life=1.335；技能ID=`hero-weapon-skill.ruini.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.ruini.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 惊梦留痕（`hero-skill.ruini.dream-mark`）

- **实现名/原文**：芮妮·惊梦留痕；矛兵每2次主攻击尝试在闪避前标记选定目标；下回合对该目标造成200%独立技能额外伤害。
- **等级原数值**：`{"5":2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"targetBoundMark","schedule":{"source":"lancer","interval":2,"mode":"onCompleted"},"markId":"reneeDreamMark","damageDelayRounds":1,"damageCoefficient":2,"markDurationRounds":1}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"all"}}`。
- **类型**：`mark`；代码 effect kind=targetBoundMark。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","expeditionSlot1","usesAttackCount","hitTargetTroop","targetBoundMark","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ruini.dream-mark","name":"hero-effect.ruini.dream-mark","kind":"targetBoundMark","recipient":"enemyArmy","markId":"reneeDreamMark","scope":{"source":"lancer","target":"currentTarget","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ruini.dream-mark` | confirmed | confirmed | S6真实战报确认：pre-dodge偶数次主攻尝试绑定当前目标；下回合整回合生效，独立产生2B skillDamage/extraDamage，目标死亡不转移。 |

##### 2. 捕梦手（`hero-skill.ruini.dream-catcher`）

- **实现名/原文**：芮妮·捕梦手；矛兵对DreamMark目标伤害提升150%。
- **等级原数值**：`{"5":1.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"all"}}`。
- **类型**：`vulnerability`；代码 effect kind=markedTargetDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","expeditionSlot2","targetBoundMark","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ruini.dream-catcher","name":"hero-effect.ruini.dream-catcher","kind":"markedTargetDamageIncrease","recipient":"enemyArmy","markId":"reneeDreamMark","group":"dreamMarkDamage","value":1.5,"scope":{"source":"lancer","target":"currentTarget","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ruini.dream-catcher` | confirmed | confirmed | S6真实战报最终规则明确捕梦手与梦境切片同属 dreamMarkDamage，小区内+150%与+75%加算，2B标记伤害也适用。 |

##### 3. 梦境切片（`hero-skill.ruini.dream-fragment`）

- **实现名/原文**：芮妮·梦境切片；全军对DreamMark目标伤害提升75%。
- **等级原数值**：`{"5":0.75}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`vulnerability`；代码 effect kind=markedTargetDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","expeditionSlot3","targetBoundMark","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ruini.dream-fragment","name":"hero-effect.ruini.dream-fragment","kind":"markedTargetDamageIncrease","recipient":"enemyArmy","markId":"reneeDreamMark","group":"dreamMarkDamage","value":0.75,"scope":{"source":"army","target":"currentTarget","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ruini.dream-fragment` | confirmed | confirmed | S6真实战报最终规则明确捕梦手与梦境切片同属 dreamMarkDamage，小区内+150%与+75%加算，2B标记伤害也适用。 |

##### 4. 芮妮专武·集结穿透（`hero-weapon-skill.ruini.rally-penetration`）

- **实现名/原文**：芮妮专武·集结穿透；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ruini.rally-penetration","name":"hero-weapon-effect.ruini.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ruini.rally-penetration","name":"hero-weapon-effect.ruini.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ruini.rally-penetration","name":"hero-weapon-effect.ruini.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ruini.rally-penetration","name":"hero-weapon-effect.ruini.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ruini.rally-penetration","name":"hero-weapon-effect.ruini.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.ruini.rally-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

#### 韦恩（射，SSR，`hero.s6.weien`）

远征静态属性（小数）：attack=5.4043；defense=5.4043；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 惊雷奇袭（`expedition.weien.thunder-raid`） | 每4自然回合，我军各存活兵种分别发动一次独立技能额外打击；Lv5为100%。 | `{"1":0.2,"2":0.4,"3":0.6,"4":0.8,"5":1}` | `hero-skill.weien.thunder-raid` |
| 2 | 迂回打击（`expedition.weien.flanking-strike`） | 射手每2次主攻击尝试，在闪避前对存活矛兵/射手产生独立技能伤害；Lv5为40%/20%。 | `{"1":0.08,"2":0.16,"3":0.24,"4":0.32,"5":0.4}` | `hero-skill.weien.flanking-strike` |
| 3 | 电光石火（`expedition.weien.lightning-speed`） | 全军各兵种主普攻通过闪避后分别判定暴击；触发时该次普通攻击伤害×2，不生成独立技能事件；Lv5概率25%。 | `{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}` | `hero-skill.weien.lightning-speed` |

专武目录：基础属性上限 penetration=1.335、life=1.335；技能ID=`hero-weapon-skill.weien.defense-penetration`；已录入阶梯数值=`{"hero-weapon-skill.weien.defense-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 惊雷奇袭（`hero-skill.weien.thunder-raid`）

- **实现名/原文**：韦恩·惊雷奇袭；每4自然回合，我军各存活兵种分别发动一次独立技能额外打击；Lv5为100%。
- **等级原数值**：`{"1":0.2,"2":0.4,"3":0.6,"4":0.8,"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","expeditionSlot1","roundBasedExtraDamage","extraDamageNotAdditionalAttack"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=4；start=4 | `{"id":"hero-effect.weien.thunder-raid.extra","name":"hero-effect.weien.thunder-raid.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.2,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=4；start=4 | `{"id":"hero-effect.weien.thunder-raid.extra","name":"hero-effect.weien.thunder-raid.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.4,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=4；start=4 | `{"id":"hero-effect.weien.thunder-raid.extra","name":"hero-effect.weien.thunder-raid.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.6,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=4；start=4 | `{"id":"hero-effect.weien.thunder-raid.extra","name":"hero-effect.weien.thunder-raid.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.8,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=4；start=4 | `{"id":"hero-effect.weien.thunder-raid.extra","name":"hero-effect.weien.thunder-raid.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentRawDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.weien.thunder-raid.extra` | confirmed | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 2. 迂回打击（`hero-skill.weien.flanking-strike`）

- **实现名/原文**：韦恩·迂回打击；射手每2次主攻击尝试，在闪避前对存活矛兵/射手产生独立技能伤害；Lv5为40%/20%。
- **等级原数值**：`{"1":0.08,"2":0.16,"3":0.24,"4":0.32,"5":0.4}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S10 reuse of Wayne critical and flanking templates; original S6 battle reports require recheck"`；templateSource=—；tags=`["S6","expeditionSlot2","usesAttackCount","multiTargetExtraDamage","noRetarget"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.flanking-strike.lancer","name":"hero-effect.weien.flanking-strike.lancer","kind":"extraDamage","recipient":"selfArmy","coefficient":0.08,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.weien.flanking-strike.marksman","name":"hero-effect.weien.flanking-strike.marksman","kind":"extraDamage","recipient":"selfArmy","coefficient":0.04,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}` |
| 2 | Expedition Lv.2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.flanking-strike.lancer","name":"hero-effect.weien.flanking-strike.lancer","kind":"extraDamage","recipient":"selfArmy","coefficient":0.16,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.weien.flanking-strike.marksman","name":"hero-effect.weien.flanking-strike.marksman","kind":"extraDamage","recipient":"selfArmy","coefficient":0.08,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}` |
| 3 | Expedition Lv.3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.flanking-strike.lancer","name":"hero-effect.weien.flanking-strike.lancer","kind":"extraDamage","recipient":"selfArmy","coefficient":0.24,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.weien.flanking-strike.marksman","name":"hero-effect.weien.flanking-strike.marksman","kind":"extraDamage","recipient":"selfArmy","coefficient":0.12,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}` |
| 4 | Expedition Lv.4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.flanking-strike.lancer","name":"hero-effect.weien.flanking-strike.lancer","kind":"extraDamage","recipient":"selfArmy","coefficient":0.32,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.weien.flanking-strike.marksman","name":"hero-effect.weien.flanking-strike.marksman","kind":"extraDamage","recipient":"selfArmy","coefficient":0.16,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.flanking-strike.lancer","name":"hero-effect.weien.flanking-strike.lancer","kind":"extraDamage","recipient":"selfArmy","coefficient":0.4,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.weien.flanking-strike.marksman","name":"hero-effect.weien.flanking-strike.marksman","kind":"extraDamage","recipient":"selfArmy","coefficient":0.2,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.weien.flanking-strike.lancer` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.weien.flanking-strike.marksman` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 3. 电光石火（`hero-skill.weien.lightning-speed`）

- **实现名/原文**：韦恩·电光石火；全军各兵种主普攻通过闪避后分别判定暴击；触发时该次普通攻击伤害×2，不生成独立技能事件；Lv5概率25%。
- **等级原数值**：`{"1":0.05,"2":0.1,"3":0.15,"4":0.2,"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.25`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"normalAttack"}}`。
- **类型**：`normalAttackDamage`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S10 reuse of Wayne critical and flanking templates; original S6 battle reports require recheck"`；templateSource=—；tags=`["S6","expeditionSlot3","criticalNormalAttack","perTroopAttack"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | 5% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.lightning-speed.critical","name":"hero-effect.weien.lightning-speed.critical","kind":"damageIncrease","recipient":"selfArmy","group":"criticalNormalAttack","value":1,"scope":{"source":"army","target":"all","damageType":"normalAttack"}}` |
| 2 | Expedition Lv.2 | 10% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.lightning-speed.critical","name":"hero-effect.weien.lightning-speed.critical","kind":"damageIncrease","recipient":"selfArmy","group":"criticalNormalAttack","value":1,"scope":{"source":"army","target":"all","damageType":"normalAttack"}}` |
| 3 | Expedition Lv.3 | 15% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.lightning-speed.critical","name":"hero-effect.weien.lightning-speed.critical","kind":"damageIncrease","recipient":"selfArmy","group":"criticalNormalAttack","value":1,"scope":{"source":"army","target":"all","damageType":"normalAttack"}}` |
| 4 | Expedition Lv.4 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.lightning-speed.critical","name":"hero-effect.weien.lightning-speed.critical","kind":"damageIncrease","recipient":"selfArmy","group":"criticalNormalAttack","value":1,"scope":{"source":"army","target":"all","damageType":"normalAttack"}}` |
| 5 | Expedition Lv.5 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.weien.lightning-speed.critical","name":"hero-effect.weien.lightning-speed.critical","kind":"damageIncrease","recipient":"selfArmy","group":"criticalNormalAttack","value":1,"scope":{"source":"army","target":"all","damageType":"normalAttack"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.weien.lightning-speed.critical` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：S6真实战报比较：惊雷Lv4 194/(375×0.8)=0.64667击败/B，电光石火179/277=0.64621击败/B，确认额外1B独立skillDamage且不继承普通攻击专属增伤。 |

##### 4. 韦恩专武·守城穿透（`hero-weapon-skill.weien.defense-penetration`）

- **实现名/原文**：韦恩专武·守城穿透；专武远征场景效果：penetration Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s6Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S6 expedition PVP rules and battle reports, 2026-09-25"`；templateSource=—；tags=`["S6","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.weien.defense-penetration","name":"hero-weapon-effect.weien.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.weien.defense-penetration","name":"hero-weapon-effect.weien.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.weien.defense-penetration","name":"hero-weapon-effect.weien.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.weien.defense-penetration","name":"hero-weapon-effect.weien.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.weien.defense-penetration","name":"hero-weapon-effect.weien.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.weien.defense-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

### S7

#### 艾迪丝（盾，SSR，`hero.s7.aidisi`）

远征静态属性（小数）：attack=6.5052；defense=6.5052；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 攻守兼备（`expedition.aidisi.offense-and-defense`） | 射手承伤降低20%，矛兵伤害提升20%。 | `{"5":0.2}` | `hero-skill.aidisi.offense-and-defense` |
| 2 | 铜头铁臂（`expedition.aidisi.iron-body`） | 盾兵受到伤害降低20%。 | `{"5":0.2}` | `hero-skill.aidisi.iron-body` |
| 3 | 钢甲护体（`expedition.aidisi.steel-armor`） | 全军生命提升25%。 | `{"5":0.25}` | `hero-skill.aidisi.steel-armor` |

专武目录：基础属性上限 penetration=1.605、life=1.605；技能ID=`hero-weapon-skill.aidisi.defense-life`；已录入阶梯数值=`{"hero-weapon-skill.aidisi.defense-life":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 攻守兼备（`hero-skill.aidisi.offense-and-defense`）

- **实现名/原文**：艾迪丝·攻守兼备；射手承伤降低20%，矛兵伤害提升20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"marksman","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"lancer","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.aidisi.marksman-reduction","name":"hero-effect.aidisi.marksman-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"marksman","damageType":"all"}}`<br>`{"id":"hero-effect.aidisi.lancer-damage","name":"hero-effect.aidisi.lancer-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.2,"scope":{"source":"lancer","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.aidisi.marksman-reduction` | confirmed | confirmed | S7战报最终规则：艾迪丝射手20%减伤归普通receivedDamageReduction，与同组其他25%按1+0.20+0.25=1.45合并。 |
| `hero-effect.aidisi.lancer-damage` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 2. 铜头铁臂（`hero-skill.aidisi.iron-body`）

- **实现名/原文**：艾迪丝·铜头铁臂；盾兵受到伤害降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：✅ **confirmed**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.aidisi.shield-reduction","name":"hero-effect.aidisi.shield-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"shield","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.aidisi.shield-reduction` | confirmed | confirmed | S7战报最终规则：艾迪丝盾兵20%减伤归普通receivedDamageReduction，与同组其他25%按1+0.20+0.25=1.45合并。 |

##### 3. 钢甲护体（`hero-skill.aidisi.steel-armor`）

- **实现名/原文**：艾迪丝·钢甲护体；全军生命提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.aidisi.life","name":"hero-effect.aidisi.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.aidisi.life` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 艾迪丝专武·坚固工事（`hero-weapon-skill.aidisi.defense-life`）

- **实现名/原文**：艾迪丝专武·坚固工事；专武远征场景效果：life Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.aidisi.defense-life","name":"hero-weapon-effect.aidisi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.aidisi.defense-life","name":"hero-weapon-effect.aidisi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.aidisi.defense-life","name":"hero-weapon-effect.aidisi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.aidisi.defense-life","name":"hero-weapon-effect.aidisi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.aidisi.defense-life","name":"hero-weapon-effect.aidisi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.aidisi.defense-life` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffLife，生命按 (1+life)(1+buffLifeGroup)，组内来源先加算。 |

#### 哥顿（矛，SSR，`hero.s7.gedun`）

远征静态属性（小数）：attack=6.5052；defense=6.5052；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 浸毒锋刃（`expedition.gedun.poisoned-blade`） | 每2次成功矛兵主攻击对实际命中目标附加技能额外伤害，并使该目标下一回合造成伤害降低；Lv5分别为100%与20%。 | `{"1":0.2,"5":1}` | `hero-skill.gedun.poisoned-blade` |
| 2 | 恐惧威慑（`expedition.gedun.toxic-phobia`） | R3/6/9…当回合矛兵伤害提升、敌军全军造成伤害降低；Lv5分别为150%与30%。 | `{"1":0.3,"5":1.5}` | `hero-skill.gedun.toxic-phobia` |
| 3 | 腐蚀云雾（`expedition.gedun.poison-cloud`） | R4/R5、R8/R9…使敌方盾兵易伤、敌方射手造成伤害降低；Lv5均为30%。 | `{"1":0.06,"5":0.3}` | `hero-skill.gedun.poison-cloud` |

专武目录：基础属性上限 penetration=1.605、life=1.605；技能ID=`hero-weapon-skill.gedun.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.gedun.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 浸毒锋刃（`hero-skill.gedun.poisoned-blade`）

- **实现名/原文**：哥顿·浸毒锋刃；每2次成功矛兵主攻击对实际命中目标附加技能额外伤害，并使该目标下一回合造成伤害降低；Lv5分别为100%与20%。
- **等级原数值**：`{"1":0.2,"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"lancer","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`reduction`；代码 effect kind=extraDamage、outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、provisional。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot1","usesAttackCount","hitTargetTroop","poisonTarget"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gedun.poisoned-blade.extra","name":"hero-effect.gedun.poisoned-blade.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.2,"basis":"parentRawDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.gedun.poison","name":"hero-effect.gedun.poison","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"poisonOutgoingDamageReduction","value":0.04,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gedun.poisoned-blade.extra","name":"hero-effect.gedun.poisoned-blade.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentRawDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.gedun.poison","name":"hero-effect.gedun.poison","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"poisonOutgoingDamageReduction","value":0.2,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gedun.poisoned-blade.extra` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.gedun.poison` | provisional | provisional | 技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 2. 恐惧威慑（`hero-skill.gedun.toxic-phobia`）

- **实现名/原文**：哥顿·恐惧威慑；R3/6/9…当回合矛兵伤害提升、敌军全军造成伤害降低；Lv5分别为150%与30%。
- **等级原数值**：`{"1":0.3,"5":1.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"all","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`、`reduction`；代码 effect kind=damageIncrease、outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、provisional。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot2","bearModelSemantic","periodic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=3；start=3 | `{"id":"hero-effect.gedun.toxic-phobia.lancer-damage","name":"hero-effect.gedun.toxic-phobia.lancer-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.3,"scope":{"source":"lancer","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.gedun.toxic-phobia.enemy-outgoing","name":"hero-effect.gedun.toxic-phobia.enemy-outgoing","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"gordonPeriodicOutgoingReduction","value":0.06,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=3；start=3 | `{"id":"hero-effect.gedun.toxic-phobia.lancer-damage","name":"hero-effect.gedun.toxic-phobia.lancer-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":1.5,"scope":{"source":"lancer","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.gedun.toxic-phobia.enemy-outgoing","name":"hero-effect.gedun.toxic-phobia.enemy-outgoing","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"gordonPeriodicOutgoingReduction","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gedun.toxic-phobia.lancer-damage` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.gedun.toxic-phobia.enemy-outgoing` | provisional | provisional | 技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 3. 腐蚀云雾（`hero-skill.gedun.poison-cloud`）

- **实现名/原文**：哥顿·腐蚀云雾；R4/R5、R8/R9…使敌方盾兵易伤、敌方射手造成伤害降低；Lv5均为30%。
- **等级原数值**：`{"1":0.06,"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`vulnerability`、`reduction`；代码 effect kind=incomingDamageIncrease、outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、provisional。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot3","bearModelSemantic","periodic","rounds4-5-8-9"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Expedition Lv.1 | — | duration=—；cooldown=— | period=4；start=4 | `{"id":"hero-effect.gedun.poison-cloud.shield-vulnerability","name":"hero-effect.gedun.poison-cloud.shield-vulnerability","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.06,"scope":{"source":"army","target":"shield","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.gedun.poison-cloud.marksman-outgoing","name":"hero-effect.gedun.poison-cloud.marksman-outgoing","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"gordonMarksmanOutgoingReduction","value":0.06,"scope":{"source":"marksman","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=4；start=4 | `{"id":"hero-effect.gedun.poison-cloud.shield-vulnerability","name":"hero-effect.gedun.poison-cloud.shield-vulnerability","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.3,"scope":{"source":"army","target":"shield","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.gedun.poison-cloud.marksman-outgoing","name":"hero-effect.gedun.poison-cloud.marksman-outgoing","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"gordonMarksmanOutgoingReduction","value":0.3,"scope":{"source":"marksman","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gedun.poison-cloud.shield-vulnerability` | unverified | confirmed | 独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |
| `hero-effect.gedun.poison-cloud.marksman-outgoing` | provisional | provisional | 技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 4. 哥顿专武·毒暴侵袭（`hero-weapon-skill.gedun.rally-penetration`）

- **实现名/原文**：哥顿专武·毒暴侵袭；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gedun.rally-penetration","name":"hero-weapon-effect.gedun.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gedun.rally-penetration","name":"hero-weapon-effect.gedun.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gedun.rally-penetration","name":"hero-weapon-effect.gedun.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gedun.rally-penetration","name":"hero-weapon-effect.gedun.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gedun.rally-penetration","name":"hero-weapon-effect.gedun.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.gedun.rally-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

#### 布拉德利（射，SSR，`hero.s7.buladeli`）

远征静态属性（小数）：attack=6.5052；defense=6.5052；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 老兵的骄傲（`expedition.buladeli.veterans-pride`） | 全军攻击提升25%。 | `{"5":0.25}` | `hero-skill.buladeli.veterans-pride` |
| 2 | 当头炮（`expedition.buladeli.head-cannon`） | 全军对矛兵伤害提升30%、对盾兵伤害提升25%。 | `{"5":0.3}` | `hero-skill.buladeli.head-cannon` |
| 3 | 洞悉战局（`expedition.buladeli.battlefield-insight`） | R5/6/9/10全军伤害提升30%。 | `{"5":0.3}` | `hero-skill.buladeli.battlefield-insight` |

专武目录：基础属性上限 penetration=1.605、life=1.605；技能ID=`hero-weapon-skill.buladeli.defense-attack`；已录入阶梯数值=`{"hero-weapon-skill.buladeli.defense-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 老兵的骄傲（`hero-skill.buladeli.veterans-pride`）

- **实现名/原文**：布拉德利·老兵的骄傲；全军攻击提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.buladeli.attack","name":"hero-effect.buladeli.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.buladeli.attack` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 当头炮（`hero-skill.buladeli.head-cannon`）

- **实现名/原文**：布拉德利·当头炮；全军对矛兵伤害提升30%、对盾兵伤害提升25%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"lancer","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot2","bearModelSemantic","targetTroopModifier"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.buladeli.vs-lancer","name":"hero-effect.buladeli.vs-lancer","kind":"damageIncrease","recipient":"selfArmy","group":"troopVsTroopDamage","value":0.3,"scope":{"source":"army","target":"lancer","damageType":"all"}}`<br>`{"id":"hero-effect.buladeli.vs-shield","name":"hero-effect.buladeli.vs-shield","kind":"damageIncrease","recipient":"selfArmy","group":"troopVsTroopDamage","value":0.25,"scope":{"source":"army","target":"shield","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.buladeli.vs-lancer` | unverified | confirmed | 独立证据：打熊权威 docs/v0.4-head-hero-skill-audit.md 明确 troopVsTroopDamage 与 baseDamageIncrease 分区；相应技能文本唯一指定 source/target 兵种。 |
| `hero-effect.buladeli.vs-shield` | unverified | confirmed | 独立证据：打熊权威 docs/v0.4-head-hero-skill-audit.md 明确 troopVsTroopDamage 与 baseDamageIncrease 分区；相应技能文本唯一指定 source/target 兵种。 |

##### 3. 洞悉战局（`hero-skill.buladeli.battlefield-insight`）

- **实现名/原文**：布拉德利·洞悉战局；R5/6/9/10全军伤害提升30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","expeditionSlot3","bearModelSemantic","periodic","rounds5-6-9-10"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.buladeli.battlefield-insight","name":"hero-effect.buladeli.battlefield-insight","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"periodRounds":4,"firstActiveRound":5,"activeWindowRounds":2}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.buladeli.battlefield-insight` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 布拉德利专武·精准布防（`hero-weapon-skill.buladeli.defense-attack`）

- **实现名/原文**：布拉德利专武·精准布防；专武远征场景效果：attack Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s7Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S7 expedition PVP battle reports, 2026-09-25"`；templateSource=—；tags=`["S7","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.buladeli.defense-attack","name":"hero-weapon-effect.buladeli.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.buladeli.defense-attack","name":"hero-weapon-effect.buladeli.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.buladeli.defense-attack","name":"hero-weapon-effect.buladeli.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.buladeli.defense-attack","name":"hero-weapon-effect.buladeli.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.buladeli.defense-attack","name":"hero-weapon-effect.buladeli.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.buladeli.defense-attack` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

### S8

#### 加托（盾，SSR，`hero.s8.jiatuo`）

远征静态属性（小数）：attack=7.8062；defense=7.8062；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 黄金近卫（`expedition.jiatuo.golden-guard`） | 盾兵防御提升30%。 | `{"5":0.3}` | `hero-skill.jiatuo.golden-guard` |
| 2 | 列王恩赐（`expedition.jiatuo.kings-gift`） | 盾兵每次完成主攻击后触发，下一回合护盾生效并覆盖旧盾：X=100×当前盾兵常数×√当前盾兵数×(1+战报攻击加成)；Lv4=0.24X，Lv5=0.30X。英雄远征技能攻击增减不进入X。 | `{"4":0.24,"5":0.3}` | `hero-skill.jiatuo.kings-gift` |
| 3 | 王者之师（`expedition.jiatuo.kings-army`） | 敌军全军攻击降低25%。 | `{"5":0.25}` | `hero-skill.jiatuo.kings-army` |

专武目录：基础属性上限 penetration=1.93、life=1.93；技能ID=`hero-weapon-skill.jiatuo.defense-defense`；已录入阶梯数值=`{"hero-weapon-skill.jiatuo.defense-defense":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 黄金近卫（`hero-skill.jiatuo.golden-guard`）

- **实现名/原文**：加托·黄金近卫；盾兵防御提升30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiatuo.shield-defense","name":"hero-effect.jiatuo.shield-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"addToAttribute","group":"heroDefenseBonus","value":0.3,"scope":{"source":"shield","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.jiatuo.shield-defense` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 列王恩赐（`hero-skill.jiatuo.kings-gift`）

- **实现名/原文**：加托·列王恩赐；盾兵每次完成主攻击后触发，下一回合护盾生效并覆盖旧盾：X=100×当前盾兵常数×√当前盾兵数×(1+战报攻击加成)；Lv4=0.24X，Lv5=0.30X。英雄远征技能攻击增减不进入X。
- **等级原数值**：`{"4":0.24,"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"shield","interval":1,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"nextRound"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`。
- **类型**：`shield`；代码 effect kind=temporaryShield。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional。
- **元数据**：source=`"2026-09-27 user-confirmed Gatot PVP shield formula and Sheet2/Sheet3 level-4 experiments"`；templateSource=—；tags=`["S8","expeditionSlot2","temporaryShieldHp","gatotReportAttackPower","nextRound","replaceOnMainAttack"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 4 | Expedition Lv.4 (Sheet2/Sheet3) | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiatuo.kings-gift","name":"hero-effect.jiatuo.kings-gift","kind":"temporaryShield","recipient":"selfArmy","coefficient":0.24,"basis":"gatotReportAttackPower","scope":{"source":"shield","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiatuo.kings-gift","name":"hero-effect.jiatuo.kings-gift","kind":"temporaryShield","recipient":"selfArmy","coefficient":0.3,"basis":"gatotReportAttackPower","scope":{"source":"shield","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.jiatuo.kings-gift` | unverified | provisional | 技能文本支持临时护盾语义，但当前“父事件 rawDamage 的 30% 且 RoundEnd 先吸收”公式仍标为 TENTATIVE；没有独立战报证据确认。 |

##### 3. 王者之师（`hero-skill.jiatuo.kings-army`）

- **实现名/原文**：加托·王者之师；敌军全军攻击降低25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.jiatuo.enemy-attack-reduction","name":"hero-effect.jiatuo.enemy-attack-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.jiatuo.enemy-attack-reduction` | unverified | confirmed | 独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyAttackReduction 为战报攻击属性除法削减组，同组先加算。 |

##### 4. 加托专武·不灭之城（`hero-weapon-skill.jiatuo.defense-defense`）

- **实现名/原文**：加托专武·不灭之城；专武远征场景效果：defense Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jiatuo.defense-defense","name":"hero-weapon-effect.jiatuo.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jiatuo.defense-defense","name":"hero-weapon-effect.jiatuo.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jiatuo.defense-defense","name":"hero-weapon-effect.jiatuo.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jiatuo.defense-defense","name":"hero-weapon-effect.jiatuo.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.jiatuo.defense-defense","name":"hero-weapon-effect.jiatuo.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.jiatuo.defense-defense` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffDefense，组内来源先加算，并与普通 defenseBonus 分开。 |

#### 索妮娅（矛，SSR，`hero.s8.suoniya`）

远征静态属性（小数）：attack=7.8062；defense=7.8062；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 宝藏猎人（`expedition.suoniya.treasure-hunter`） | 全军伤害提升20%。 | `{"5":0.2}` | `hero-skill.suoniya.treasure-hunter` |
| 2 | 赏金诱惑（`expedition.suoniya.bounty-temptation`） | 每完成2次矛兵主攻击立即造成0.75B技能额外伤害；全军攻击+25%从下一回合起持续1回合。 | `{"5":0.75}` | `hero-skill.suoniya.bounty-temptation` |
| 3 | 激流冲击（`expedition.suoniya.torrent-impact`） | 每5个自然回合（R5/10/15…）对实际命中目标造成2.50B技能额外伤害；该目标下一回合跳过行动。 | `{"5":2.5}` | `hero-skill.suoniya.torrent-impact` |

专武目录：基础属性上限 penetration=1.93、life=1.93；技能ID=`hero-weapon-skill.suoniya.defense-penetration`；已录入阶梯数值=`{"hero-weapon-skill.suoniya.defense-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 宝藏猎人（`hero-skill.suoniya.treasure-hunter`）

- **实现名/原文**：索妮娅·宝藏猎人；全军伤害提升20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","expeditionSlot1","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.suoniya.treasure-hunter","name":"hero-effect.suoniya.treasure-hunter","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.suoniya.treasure-hunter` | unverified | confirmed | 独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 2. 赏金诱惑（`hero-skill.suoniya.bounty-temptation`）

- **实现名/原文**：索妮娅·赏金诱惑；每完成2次矛兵主攻击立即造成0.75B技能额外伤害；全军攻击+25%从下一回合起持续1回合。
- **等级原数值**：`{"5":0.75}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"lancer","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`attribute`；代码 effect kind=extraDamage、attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","expeditionSlot2","usesAttackCount","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.suoniya.bounty-temptation.extra","name":"hero-effect.suoniya.bounty-temptation.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.75,"basis":"parentBaseDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.suoniya.bounty-temptation.attack","name":"hero-effect.suoniya.bounty-temptation.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.suoniya.bounty-temptation.extra` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.suoniya.bounty-temptation.attack` | unverified | confirmed | 本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 3. 激流冲击（`hero-skill.suoniya.torrent-impact`）

- **实现名/原文**：索妮娅·激流冲击；每5个自然回合（R5/10/15…）对实际命中目标造成2.50B技能额外伤害；该目标下一回合跳过行动。
- **等级原数值**：`{"5":2.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"naturalRoundTrigger","source":"lancer"}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`control`；代码 effect kind=extraDamage、skipNextRoundAction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","expeditionSlot3","periodic","hitTargetTroop","stun","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=5；start=5 | `{"id":"hero-effect.suoniya.torrent-impact.extra","name":"hero-effect.suoniya.torrent-impact.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":2.5,"basis":"parentBaseDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.suoniya.torrent-impact.stun","name":"hero-effect.suoniya.torrent-impact.stun","kind":"skipNextRoundAction","recipient":"enemyArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.suoniya.torrent-impact.extra` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.suoniya.torrent-impact.stun` | unverified | confirmed | 独立证据：英雄原始规则明确效果是跳过目标下一次主行动，而不是把伤害降为 0；不属于伤害乘区。 |

##### 4. 索妮娅专武·涡流炮台（`hero-weapon-skill.suoniya.defense-penetration`）

- **实现名/原文**：索妮娅专武·涡流炮台；专武远征场景效果：penetration Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.suoniya.defense-penetration","name":"hero-weapon-effect.suoniya.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.suoniya.defense-penetration","name":"hero-weapon-effect.suoniya.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.suoniya.defense-penetration","name":"hero-weapon-effect.suoniya.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.suoniya.defense-penetration","name":"hero-weapon-effect.suoniya.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.suoniya.defense-penetration","name":"hero-weapon-effect.suoniya.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.suoniya.defense-penetration` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

#### 亨德里克（射，SSR，`hero.s8.hengdelike`）

远征静态属性（小数）：attack=7.8062；defense=7.8062；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 蝙虫之噬（`expedition.s8.hengdelike.defense-reduction`） | 敌军全军防御属性降低25%，进入enemyDefenseReduction属性组。 | `{"5":0.25}` | `hero-skill.s8.hengdelike.defense-reduction` |
| 2 | 藤壶之铠（`expedition.s8.hengdelike.barnacle-armor`） | 每4个自然回合连续生效2回合（R5/6、R9/10…），全军heroDefenseBonus+30%。 | `{"5":0.3}` | `hero-skill.s8.hengdelike.barnacle-armor` |
| 3 | 大森之嗣（`expedition.s8.hengdelike.heir-of-forest`） | 每3个自然回合（R3/6/9…）由射手对每个存活敌军兵种栈分别造成0.40B技能额外伤害。 | `{"5":0.4}` | `hero-skill.s8.hengdelike.heir-of-forest` |

专武目录：基础属性上限 penetration=1.93、life=1.93；技能ID=`hero-weapon-skill.s8.hengdelike.rally-attack`；已录入阶梯数值=`{"hero-weapon-skill.s8.hengdelike.rally-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 蝙虫之噬（`hero-skill.s8.hengdelike.defense-reduction`）

- **实现名/原文**：亨德里克·蝙虫之噬；敌军全军防御属性降低25%，进入enemyDefenseReduction属性组。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.s8.hengdelike.defense-reduction","name":"hero-effect.s8.hengdelike.defense-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"defense","group":"enemyDefenseReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.s8.hengdelike.defense-reduction` | unverified | confirmed | 独立证据：README、英雄规则附件及打熊权威 docs/skill-multiplier-system.md 明确 defenseReduction 与 vulnerability 分区，且按独立增幅组处理。 |

##### 2. 藤壶之铠（`hero-skill.s8.hengdelike.barnacle-armor`）

- **实现名/原文**：亨德里克·藤壶之铠；每4个自然回合连续生效2回合（R5/6、R9/10…），全军heroDefenseBonus+30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","expeditionSlot2","periodicDefenseBuff","rounds5-6-9-10"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.s8.hengdelike.barnacle-armor","name":"hero-effect.s8.hengdelike.barnacle-armor","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"periodRounds":4,"firstActiveRound":5,"activeWindowRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.s8.hengdelike.barnacle-armor` | unverified | confirmed | 独立证据：兵种规则附件 3d5dff55.../pasted-text.txt 明确钢铁守护属于 skill defense bonus，与英雄/车身防御技能增益同体系而非独立防御倍率；专项同区测试验证。 |

##### 3. 大森之嗣（`hero-skill.s8.hengdelike.heir-of-forest`）

- **实现名/原文**：亨德里克·大森之嗣；每3个自然回合（R3/6/9…）由射手对每个存活敌军兵种栈分别造成0.40B技能额外伤害。
- **等级原数值**：`{"5":0.4}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"naturalRoundTrigger","source":"marksman"}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","expeditionSlot3","periodic","multiTargetExtraDamage","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=3；start=3 | `{"id":"hero-effect.s8.hengdelike.heir-of-forest.all","name":"hero-effect.s8.hengdelike.heir-of-forest.all","kind":"extraDamage","recipient":"selfArmy","coefficient":0.4,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"all","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.s8.hengdelike.heir-of-forest.all` | unverified | confirmed | 独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 4. 亨德里克专武·深渊之佑（`hero-weapon-skill.s8.hengdelike.rally-attack`）

- **实现名/原文**：亨德里克专武·深渊之佑；专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s8Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S8 PVP rules"`；templateSource=—；tags=`["S8","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.s8.hengdelike.rally-attack","name":"hero-weapon-effect.s8.hengdelike.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.s8.hengdelike.rally-attack","name":"hero-weapon-effect.s8.hengdelike.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.s8.hengdelike.rally-attack","name":"hero-weapon-effect.s8.hengdelike.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.s8.hengdelike.rally-attack","name":"hero-weapon-effect.s8.hengdelike.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.s8.hengdelike.rally-attack","name":"hero-weapon-effect.s8.hengdelike.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.s8.hengdelike.rally-attack` | unverified | confirmed | 独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

### S9

#### 马格努斯（盾，SSR，`hero.s9.magenusi`）

远征静态属性（小数）：attack=9.4075；defense=9.4075；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 怒海狂涛（`expedition.magenusi.raging-sea`） | 全军攻击提升25%。 | `{"5":0.25}` | `hero-skill.magenusi.raging-sea` |
| 2 | 钢铁方阵（`expedition.magenusi.steel-phalanx`） | 每次盾兵发起主攻击即独立40%判定，普通攻击被闪避仍判定；成功后全军 heroDefenseBonus +50%，当轮触发点起立即生效，次轮失效。 | `{"5":0.5}` | `hero-skill.magenusi.steel-phalanx` |
| 3 | 冰海战法（`expedition.magenusi.ice-sea-tactics`） | 盾兵承伤降低10%，射手伤害提升10%。 | `{"5":0.1}` | `hero-skill.magenusi.ice-sea-tactics` |

专武目录：基础属性上限 penetration=2.32、life=2.32；技能ID=`hero-weapon-skill.magenusi.defense-life`；已录入阶梯数值=`{"hero-weapon-skill.magenusi.defense-life":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 怒海狂涛（`hero-skill.magenusi.raging-sea`）

- **实现名/原文**：马格努斯·怒海狂涛；全军攻击提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.magenusi.attack","name":"hero-effect.magenusi.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.magenusi.attack` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 钢铁方阵（`hero-skill.magenusi.steel-phalanx`）

- **实现名/原文**：马格努斯·钢铁方阵；每次盾兵发起主攻击即独立40%判定，普通攻击被闪避仍判定；成功后全军 heroDefenseBonus +50%，当轮触发点起立即生效，次轮失效。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=`0.4`；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"shield","interval":1,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot2","immediateCurrentRoundDefenseBuff"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.magenusi.steel-phalanx","name":"hero-effect.magenusi.steel-phalanx","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.magenusi.steel-phalanx` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：兵种规则附件 3d5dff55.../pasted-text.txt 明确钢铁守护属于 skill defense bonus，与英雄/车身防御技能增益同体系而非独立防御倍率；专项同区测试验证。 |

##### 3. 冰海战法（`hero-skill.magenusi.ice-sea-tactics`）

- **实现名/原文**：马格努斯·冰海战法；盾兵承伤降低10%，射手伤害提升10%。
- **等级原数值**：`{"5":0.1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional、confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.magenusi.shield-reduction","name":"hero-effect.magenusi.shield-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.1,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.magenusi.marksman-damage","name":"hero-effect.magenusi.marksman-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.1,"scope":{"source":"marksman","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.magenusi.shield-reduction` | unverified | provisional | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.magenusi.marksman-damage` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 马格努斯专武·英灵意志（`hero-weapon-skill.magenusi.defense-life`）

- **实现名/原文**：马格努斯专武·英灵意志；专武远征场景效果：life Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.magenusi.defense-life","name":"hero-weapon-effect.magenusi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.magenusi.defense-life","name":"hero-weapon-effect.magenusi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.magenusi.defense-life","name":"hero-weapon-effect.magenusi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.magenusi.defense-life","name":"hero-weapon-effect.magenusi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.magenusi.defense-life","name":"hero-weapon-effect.magenusi.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.magenusi.defense-life` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffLife，生命按 (1+life)(1+buffLifeGroup)，组内来源先加算。 |

#### 弗雷德（矛，SSR，`hero.s9.fuleide`）

远征静态属性（小数）：attack=9.4075；defense=9.4075；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 水炮压制（`expedition.fuleide.water-cannon`） | 敌军全军穿透降低20%。 | `{"5":0.2}` | `hero-skill.fuleide.water-cannon` |
| 2 | 酸性溶液（`expedition.fuleide.acid-solution`） | 仅敌方盾兵常驻易伤20%。 | `{"5":0.2}` | `hero-skill.fuleide.acid-solution` |
| 3 | 攻势如潮（`expedition.fuleide.tidal-offensive`） | 每4次矛兵主攻击尝试对原目标造成2B技能额外伤害，普通攻击被闪避仍触发；敌军全体下一回合造成伤害降低20%。 | `{"5":2}` | `hero-skill.fuleide.tidal-offensive` |

专武目录：基础属性上限 penetration=2.32、life=2.32；技能ID=`hero-weapon-skill.fuleide.rally-attack`；已录入阶梯数值=`{"hero-weapon-skill.fuleide.rally-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 水炮压制（`hero-skill.fuleide.water-cannon`）

- **实现名/原文**：弗雷德·水炮压制；敌军全军穿透降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`、`penetration`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fuleide.enemy-penetration","name":"hero-effect.fuleide.enemy-penetration","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.fuleide.enemy-penetration` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyPenetrationReduction 为战报穿透属性除法削减组，同组先加算。 |

##### 2. 酸性溶液（`hero-skill.fuleide.acid-solution`）

- **实现名/原文**：弗雷德·酸性溶液；仅敌方盾兵常驻易伤20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`。
- **类型**：`vulnerability`；代码 effect kind=incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fuleide.acid-solution","name":"hero-effect.fuleide.acid-solution","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.2,"scope":{"source":"army","target":"shield","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.fuleide.acid-solution` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 3. 攻势如潮（`hero-skill.fuleide.tidal-offensive`）

- **实现名/原文**：弗雷德·攻势如潮；每4次矛兵主攻击尝试对原目标造成2B技能额外伤害，普通攻击被闪避仍触发；敌军全体下一回合造成伤害降低20%。
- **等级原数值**：`{"5":2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"lancer","interval":4,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`reduction`；代码 effect kind=extraDamage、outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、provisional。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot3","usesAttackCount","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.fuleide.tidal-offensive.extra","name":"hero-effect.fuleide.tidal-offensive.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":2,"basis":"parentBaseDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.fuleide.tidal-offensive.enemy-outgoing","name":"hero-effect.fuleide.tidal-offensive.enemy-outgoing","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"enemyOutgoingDamageReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.fuleide.tidal-offensive.extra` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.fuleide.tidal-offensive.enemy-outgoing` | unverified | provisional | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 4. 弗雷德专武·英勇感召（`hero-weapon-skill.fuleide.rally-attack`）

- **实现名/原文**：弗雷德专武·英勇感召；专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fuleide.rally-attack","name":"hero-weapon-effect.fuleide.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fuleide.rally-attack","name":"hero-weapon-effect.fuleide.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fuleide.rally-attack","name":"hero-weapon-effect.fuleide.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fuleide.rally-attack","name":"hero-weapon-effect.fuleide.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.fuleide.rally-attack","name":"hero-weapon-effect.fuleide.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.fuleide.rally-attack` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 修拉（射，SSR，`hero.s9.xiula`）

远征静态属性（小数）：attack=9.4075；defense=9.4075；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 迷雾孢子（`expedition.xiula.mist-spores`） | 全军受到伤害降低20%。 | `{"5":0.2}` | `hero-skill.xiula.mist-spores` |
| 2 | 贯穿之矢（`expedition.xiula.piercing-arrow`） | 每2次射手主攻击尝试对原目标造成1B技能额外伤害，普通攻击被闪避仍触发；原目标下一回合易伤25%。 | `{"5":1}` | `hero-skill.xiula.piercing-arrow` |
| 3 | 波云诡谲（`expedition.xiula.unpredictable-clouds`） | 射手承伤降低15%，射手伤害提升10%。 | `{"5":0.15}` | `hero-skill.xiula.unpredictable-clouds` |

专武目录：基础属性上限 penetration=2.32、life=2.32；技能ID=`hero-weapon-skill.xiula.defense-attack`；已录入阶梯数值=`{"hero-weapon-skill.xiula.defense-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 迷雾孢子（`hero-skill.xiula.mist-spores`）

- **实现名/原文**：修拉·迷雾孢子；全军受到伤害降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xiula.mist-spores","name":"hero-effect.xiula.mist-spores","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.xiula.mist-spores` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 2. 贯穿之矢（`hero-skill.xiula.piercing-arrow`）

- **实现名/原文**：修拉·贯穿之矢；每2次射手主攻击尝试对原目标造成1B技能额外伤害，普通攻击被闪避仍触发；原目标下一回合易伤25%。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`vulnerability`；代码 effect kind=extraDamage、incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot2","usesAttackCount","hitTargetTroop","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xiula.piercing-arrow.extra","name":"hero-effect.xiula.piercing-arrow.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.xiula.piercing-arrow.vulnerability","name":"hero-effect.xiula.piercing-arrow.vulnerability","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.25,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.xiula.piercing-arrow.extra` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.xiula.piercing-arrow.vulnerability` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 3. 波云诡谲（`hero-skill.xiula.unpredictable-clouds`）

- **实现名/原文**：修拉·波云诡谲；射手承伤降低15%，射手伤害提升10%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"marksman","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional、confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.xiula.marksman-reduction","name":"hero-effect.xiula.marksman-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.15,"scope":{"source":"army","target":"marksman","damageType":"all"}}`<br>`{"id":"hero-effect.xiula.marksman-damage","name":"hero-effect.xiula.marksman-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.1,"scope":{"source":"marksman","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.xiula.marksman-reduction` | unverified | provisional | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.xiula.marksman-damage` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 修拉专武·大地的祝福（`hero-weapon-skill.xiula.defense-attack`）

- **实现名/原文**：修拉专武·大地的祝福；专武远征场景效果：attack Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s9Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S9 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S9","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.xiula.defense-attack","name":"hero-weapon-effect.xiula.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.xiula.defense-attack","name":"hero-weapon-effect.xiula.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.xiula.defense-attack","name":"hero-weapon-effect.xiula.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.xiula.defense-attack","name":"hero-weapon-effect.xiula.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.xiula.defense-attack","name":"hero-weapon-effect.xiula.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.xiula.defense-attack` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

### S10

#### 格里高利（盾，SSR，`hero.s10.gregory`）

远征静态属性（小数）：attack=11.1088；defense=11.1088；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 炽阳之师（`expedition.gregory.blazing-sun-army`） | 全军攻击+15%、防御+10%。 | `{"5":0.15}` | `hero-skill.gregory.blazing-sun-army` |
| 2 | 钢铁方阵（`expedition.gregory.steel-phalanx`） | 全军普通主攻击25%概率暴击，暴击倍率2。 | `{"5":2}` | `hero-skill.gregory.steel-phalanx` |
| 3 | 钢铁防线（`expedition.gregory.steel-defense`） | 盾兵受到伤害降低20%。 | `{"5":0.2}` | `hero-skill.gregory.steel-defense` |

专武目录：基础属性上限 penetration=2.775、life=2.775；技能ID=`hero-weapon-skill.gregory.defense-penetration`；已录入阶梯数值=`{"hero-weapon-skill.gregory.defense-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 炽阳之师（`hero-skill.gregory.blazing-sun-army`）

- **实现名/原文**：格里高利·炽阳之师；全军攻击+15%、防御+10%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gregory.attack","name":"hero-effect.gregory.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.gregory.defense","name":"hero-effect.gregory.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"addToAttribute","group":"heroDefenseBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gregory.attack` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |
| `hero-effect.gregory.defense` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 钢铁方阵（`hero-skill.gregory.steel-phalanx`）

- **实现名/原文**：格里高利·钢铁方阵；全军普通主攻击25%概率暴击，暴击倍率2。
- **等级原数值**：`{"5":2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=`0.25`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"normalAttack"}}`。
- **类型**：`normalAttackDamage`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot2","criticalNormalAttack","perTroopAttack","wayneCriticalTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 25% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gregory.steel-phalanx.critical","name":"hero-effect.gregory.steel-phalanx.critical","kind":"damageIncrease","recipient":"selfArmy","group":"criticalNormalAttack","value":1,"scope":{"source":"army","target":"all","damageType":"normalAttack"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gregory.steel-phalanx.critical` | unverified | provisional | 旧库存证据（已由 2026-09-27 用户规则覆盖）：仅为当前 PVP 实现；打熊权威审计反而将暴击增幅归入 normalAttackDamageIncrease，尚无 PVP 独立证据支持 criticalNormalAttack 单独成区。 |

##### 3. 钢铁防线（`hero-skill.gregory.steel-defense`）

- **实现名/原文**：格里高利·钢铁防线；盾兵受到伤害降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gregory.steel-defense","name":"hero-effect.gregory.steel-defense","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"shield","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gregory.steel-defense` | unverified | provisional | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 4. 格里高利专武·烈日坚城（`hero-weapon-skill.gregory.defense-penetration`）

- **实现名/原文**：格里高利专武·烈日坚城；专武远征场景效果：penetration Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gregory.defense-penetration","name":"hero-weapon-effect.gregory.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gregory.defense-penetration","name":"hero-weapon-effect.gregory.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gregory.defense-penetration","name":"hero-weapon-effect.gregory.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gregory.defense-penetration","name":"hero-weapon-effect.gregory.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gregory.defense-penetration","name":"hero-weapon-effect.gregory.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.gregory.defense-penetration` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

#### 芙蕾雅（矛，SSR，`hero.s10.freya`）

远征静态属性（小数）：attack=11.1088；defense=11.1088；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 暮色迷雾（`expedition.freya.twilight-mist`） | 敌军全体攻击降低20%。 | `{"5":0.2}` | `hero-skill.freya.twilight-mist` |
| 2 | 新月之镰（`expedition.freya.crescent-scythe`） | 仅矛兵普通主攻击成功命中后独立50%判定，触发时对原目标造成1B技能额外伤害；闪避时不判定。 | `{"5":1}` | `hero-skill.freya.crescent-scythe` |
| 3 | 灵动一击（`expedition.freya.agile-strike`） | 盾兵/射手承伤降低15%，盾兵/射手伤害提升15%。 | `{"5":0.15}` | `hero-skill.freya.agile-strike` |

专武目录：基础属性上限 penetration=2.775、life=2.775；技能ID=`hero-weapon-skill.freya.defense-defense`；已录入阶梯数值=`{"hero-weapon-skill.freya.defense-defense":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 暮色迷雾（`hero-skill.freya.twilight-mist`）

- **实现名/原文**：芙蕾雅·暮色迷雾；敌军全体攻击降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.freya.twilight-mist","name":"hero-effect.freya.twilight-mist","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.freya.twilight-mist` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyAttackReduction 为战报攻击属性除法削减组，同组先加算。 |

##### 2. 新月之镰（`hero-skill.freya.crescent-scythe`）

- **实现名/原文**：芙蕾雅·新月之镰；仅矛兵普通主攻击成功命中后独立50%判定，触发时对原目标造成1B技能额外伤害；闪避时不判定。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"successfulNormalAttackHit"`；定义概率=`0.5`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot2","perTroopAttack","extraDamageNotAdditionalAttack","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 50% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.freya.crescent-scythe.extra","name":"hero-effect.freya.crescent-scythe.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.freya.crescent-scythe.extra` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 3. 灵动一击（`hero-skill.freya.agile-strike`）

- **实现名/原文**：芙蕾雅·灵动一击；盾兵/射手承伤降低15%，盾兵/射手伤害提升15%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"marksman","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional、provisional、confirmed、confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.freya.shield-reduction","name":"hero-effect.freya.shield-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.15,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.freya.marksman-reduction","name":"hero-effect.freya.marksman-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.15,"scope":{"source":"army","target":"marksman","damageType":"all"}}`<br>`{"id":"hero-effect.freya.shield-damage","name":"hero-effect.freya.shield-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.15,"scope":{"source":"shield","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.freya.marksman-damage","name":"hero-effect.freya.marksman-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.15,"scope":{"source":"marksman","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.freya.shield-reduction` | unverified | provisional | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.freya.marksman-reduction` | unverified | provisional | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.freya.shield-damage` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.freya.marksman-damage` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 芙蕾雅专武·备夜守望（`hero-weapon-skill.freya.defense-defense`）

- **实现名/原文**：芙蕾雅专武·备夜守望；专武远征场景效果：defense Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.freya.defense-defense","name":"hero-weapon-effect.freya.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.freya.defense-defense","name":"hero-weapon-effect.freya.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.freya.defense-defense","name":"hero-weapon-effect.freya.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.freya.defense-defense","name":"hero-weapon-effect.freya.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.freya.defense-defense","name":"hero-weapon-effect.freya.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.freya.defense-defense` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffDefense，组内来源先加算，并与普通 defenseBonus 分开。 |

#### 布兰琪（射，SSR，`hero.s10.blanchette`）

远征静态属性（小数）：attack=11.1088；defense=11.1088；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 真红猎刃（`expedition.blanchette.crimson-hunting-blade`） | 全军穿透提升25%。 | `{"5":0.25}` | `hero-skill.blanchette.crimson-hunting-blade` |
| 2 | 炽红爆裂（`expedition.blanchette.crimson-burst`） | 自然回合R3/R6/R9…射手对当前目标造成0.75B技能额外伤害；周期不随攻击次数或闪避漂移。 | `{"5":0.75}` | `hero-skill.blanchette.crimson-burst` |
| 3 | 曙红狙刺（`expedition.blanchette.dawn-sniper`） | 每2次射手主攻击对存活矛兵造成40%、射手造成20% extraDamage。 | `{"5":0.4}` | `hero-skill.blanchette.dawn-sniper` |

专武目录：基础属性上限 penetration=2.775、life=2.775；技能ID=`hero-weapon-skill.blanchette.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.blanchette.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 真红猎刃（`hero-skill.blanchette.crimson-hunting-blade`）

- **实现名/原文**：布兰琪·真红猎刃；全军穿透提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.blanchette.penetration","name":"hero-effect.blanchette.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.blanchette.penetration` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 炽红爆裂（`hero-skill.blanchette.crimson-burst`）

- **实现名/原文**：布兰琪·炽红爆裂；自然回合R3/R6/R9…射手对当前目标造成0.75B技能额外伤害；周期不随攻击次数或闪避漂移。
- **等级原数值**：`{"5":0.75}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=—；行动机制=`{"kind":"naturalRoundTrigger","source":"marksman"}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot2","periodic","bearModelSemantic","extraDamageNotAdditionalAttack"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=3；start=3 | `{"id":"hero-effect.blanchette.crimson-burst.extra","name":"hero-effect.blanchette.crimson-burst.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.75,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.blanchette.crimson-burst.extra` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 3. 曙红狙刺（`hero-skill.blanchette.dawn-sniper`）

- **实现名/原文**：布兰琪·曙红狙刺；每2次射手主攻击对存活矛兵造成40%、射手造成20% extraDamage。
- **等级原数值**：`{"5":0.4}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","expeditionSlot3","usesAttackCount","multiTargetExtraDamage","noRetarget","wayneFlankingTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.blanchette.dawn-sniper.lancer","name":"hero-effect.blanchette.dawn-sniper.lancer","kind":"extraDamage","recipient":"selfArmy","coefficient":0.4,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.blanchette.dawn-sniper.marksman","name":"hero-effect.blanchette.dawn-sniper.marksman","kind":"extraDamage","recipient":"selfArmy","coefficient":0.2,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.blanchette.dawn-sniper.lancer` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.blanchette.dawn-sniper.marksman` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 4. 布兰琪专武·焰红雷霆（`hero-weapon-skill.blanchette.rally-penetration`）

- **实现名/原文**：布兰琪专武·焰红雷霆；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s10Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"confirmed S10 expedition PVP rules, 2026-09-27"`；templateSource=—；tags=`["S10","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.blanchette.rally-penetration","name":"hero-weapon-effect.blanchette.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.blanchette.rally-penetration","name":"hero-weapon-effect.blanchette.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.blanchette.rally-penetration","name":"hero-weapon-effect.blanchette.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.blanchette.rally-penetration","name":"hero-weapon-effect.blanchette.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.blanchette.rally-penetration","name":"hero-weapon-effect.blanchette.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.blanchette.rally-penetration` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

### S11

#### 埃莱奥诺拉（盾，SSR，`hero.s11.eleonora`）

远征静态属性（小数）：attack=12.8102；defense=12.8102；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 烈日威光（`expedition.eleonora.sunlight-majesty`） | 全军生命提升25%。 | `{"5":0.25}` | `hero-skill.eleonora.sunlight-majesty` |
| 2 | 索拉里斯方阵（`expedition.eleonora.solaris-phalanx`） | 盾兵承伤降低10%，射手伤害提升10%。 | `{"5":0.1}` | `hero-skill.eleonora.solaris-phalanx` |
| 3 | 腾焰飞芒（`expedition.eleonora.soaring-flame`） | 每5次盾兵主攻击尝试后，全军从下一回合起通用伤害提升25%、承伤降低25%，持续2回合；普通攻击被闪避仍计数，跳过行动不计数。 | `{"5":0.25}` | `hero-skill.eleonora.soaring-flame` |

专武目录：基础属性上限 penetration=3.2、life=3.2；技能ID=`hero-weapon-skill.eleonora.defense-life`；已录入阶梯数值=`{"hero-weapon-skill.eleonora.defense-life":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 烈日威光（`hero-skill.eleonora.sunlight-majesty`）

- **实现名/原文**：埃莱奥诺拉·烈日威光；全军生命提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.eleonora.life","name":"hero-effect.eleonora.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.eleonora.life` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 索拉里斯方阵（`hero-skill.eleonora.solaris-phalanx`）

- **实现名/原文**：埃莱奥诺拉·索拉里斯方阵；盾兵承伤降低10%，射手伤害提升10%。
- **等级原数值**：`{"5":0.1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=provisional、confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.eleonora.shield-reduction","name":"hero-effect.eleonora.shield-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.1,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.eleonora.marksman-damage","name":"hero-effect.eleonora.marksman-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.1,"scope":{"source":"marksman","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.eleonora.shield-reduction` | unverified | provisional | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.eleonora.marksman-damage` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 3. 腾焰飞芒（`hero-skill.eleonora.soaring-flame`）

- **实现名/原文**：埃莱奥诺拉·腾焰飞芒；每5次盾兵主攻击尝试后，全军从下一回合起通用伤害提升25%、承伤降低25%，持续2回合；普通攻击被闪避仍计数，跳过行动不计数。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"shield","interval":5,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`、`reduction`；代码 effect kind=damageIncrease、damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot3","usesAttackCount","norahMomentumTemplate","replaceOnRetrigger","soaringFlameTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.eleonora.soaring-flame.damage","name":"hero-effect.eleonora.soaring-flame.damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.eleonora.soaring-flame.reduction","name":"hero-effect.eleonora.soaring-flame.reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.eleonora.soaring-flame.damage` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.eleonora.soaring-flame.reduction` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 4. 埃莱奥诺拉专武·最后的堡垒（`hero-weapon-skill.eleonora.defense-life`）

- **实现名/原文**：埃莱奥诺拉专武·最后的堡垒；专武远征场景效果：life Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.eleonora.defense-life","name":"hero-weapon-effect.eleonora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.eleonora.defense-life","name":"hero-weapon-effect.eleonora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.eleonora.defense-life","name":"hero-weapon-effect.eleonora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.eleonora.defense-life","name":"hero-weapon-effect.eleonora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.eleonora.defense-life","name":"hero-weapon-effect.eleonora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.eleonora.defense-life` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffLife，生命按 (1+life)(1+buffLifeGroup)，组内来源先加算。 |

#### 劳埃德（矛，SSR，`hero.s11.lloyd`）

远征静态属性（小数）：attack=12.8102；defense=12.8102；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 群鸟侵扰（`expedition.lloyd.bird-harassment`） | 敌军全体穿透降低20%。 | `{"5":0.2}` | `hero-skill.lloyd.bird-harassment` |
| 2 | 冰雾爆弹（`expedition.lloyd.ice-fog-bomb`） | 自然R3/R6/R9…当轮矛兵通用伤害提升150%、敌军全体穿透属性降低30%，与群鸟侵扰20%同组加算。 | `{"5":1.5}` | `hero-skill.lloyd.ice-fog-bomb` |
| 3 | 机巧万变（`expedition.lloyd.endless-ingenuity`） | 每回合40%概率使全军当回合穿透提升50%。 | `{"5":0.5}` | `hero-skill.lloyd.endless-ingenuity` |

专武目录：基础属性上限 penetration=3.2、life=3.2；技能ID=`hero-weapon-skill.lloyd.rally-attack`；已录入阶梯数值=`{"hero-weapon-skill.lloyd.rally-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 群鸟侵扰（`hero-skill.lloyd.bird-harassment`）

- **实现名/原文**：劳埃德·群鸟侵扰；敌军全体穿透降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`、`penetration`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lloyd.bird-harassment","name":"hero-effect.lloyd.bird-harassment","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.lloyd.bird-harassment` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyPenetrationReduction 为战报穿透属性除法削减组，同组先加算。 |

##### 2. 冰雾爆弹（`hero-skill.lloyd.ice-fog-bomb`）

- **实现名/原文**：劳埃德·冰雾爆弹；自然R3/R6/R9…当轮矛兵通用伤害提升150%、敌军全体穿透属性降低30%，与群鸟侵扰20%同组加算。
- **等级原数值**：`{"5":1.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"all","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`、`attribute`、`reduction`、`penetration`；代码 effect kind=damageIncrease、attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot2","periodic","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lloyd.ice-fog-bomb.lancer-damage","name":"hero-effect.lloyd.ice-fog-bomb.lancer-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":1.5,"scope":{"source":"lancer","target":"all","damageType":"all"},"lifecycle":{"periodRounds":3,"firstActiveRound":3,"activeWindowRounds":1}}`<br>`{"id":"hero-effect.lloyd.ice-fog-bomb.penetration","name":"hero-effect.lloyd.ice-fog-bomb.penetration","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"periodRounds":3,"firstActiveRound":3,"activeWindowRounds":1}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.lloyd.ice-fog-bomb.lancer-damage` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.lloyd.ice-fog-bomb.penetration` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyPenetrationReduction 为战报穿透属性除法削减组，同组先加算。 |

##### 3. 机巧万变（`hero-skill.lloyd.endless-ingenuity`）

- **实现名/原文**：劳埃德·机巧万变；每回合40%概率使全军当回合穿透提升50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot3","oncePerRound","lynnAlonsoPenetrationTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.lloyd.endless-ingenuity","name":"hero-effect.lloyd.endless-ingenuity","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.lloyd.endless-ingenuity` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 劳埃德专武·钢铁迷城（`hero-weapon-skill.lloyd.rally-attack`）

- **实现名/原文**：劳埃德专武·钢铁迷城；专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lloyd.rally-attack","name":"hero-weapon-effect.lloyd.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lloyd.rally-attack","name":"hero-weapon-effect.lloyd.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lloyd.rally-attack","name":"hero-weapon-effect.lloyd.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lloyd.rally-attack","name":"hero-weapon-effect.lloyd.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.lloyd.rally-attack","name":"hero-weapon-effect.lloyd.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.lloyd.rally-attack` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 鲁弗斯（射，SSR，`hero.s11.rufus`）

远征静态属性（小数）：attack=12.8102；defense=12.8102；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 火焰战团（`expedition.rufus.fire-brigade`） | 全军攻击提升25%。 | `{"5":0.25}` | `hero-skill.rufus.fire-brigade` |
| 2 | 碎甲一击（`expedition.rufus.armor-breaking-strike`） | 射手普通主攻击成功命中后对原目标造成0.6B技能额外伤害，并使其下一回合易伤25%；闪避或跳过行动时不触发。 | `{"5":0.6}` | `hero-skill.rufus.armor-breaking-strike` |
| 3 | 暴烈震爆（`expedition.rufus.violent-blast`） | 盾/矛/射每次主攻击尝试分别20%判定；触发使本次选中目标穿透降低50%持续2回合，闪避仍判定，同一目标重复触发覆盖刷新。 | `{"5":0.5}` | `hero-skill.rufus.violent-blast` |

专武目录：基础属性上限 penetration=3.2、life=3.2；技能ID=`hero-weapon-skill.rufus.rally-attack`；已录入阶梯数值=`{"hero-weapon-skill.rufus.rally-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 火焰战团（`hero-skill.rufus.fire-brigade`）

- **实现名/原文**：鲁弗斯·火焰战团；全军攻击提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.rufus.attack","name":"hero-effect.rufus.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.rufus.attack` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 碎甲一击（`hero-skill.rufus.armor-breaking-strike`）

- **实现名/原文**：鲁弗斯·碎甲一击；射手普通主攻击成功命中后对原目标造成0.6B技能额外伤害，并使其下一回合易伤25%；闪避或跳过行动时不触发。
- **等级原数值**：`{"5":0.6}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"successfulNormalAttackHit"`；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`vulnerability`；代码 effect kind=extraDamage、incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed、confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot2","hitTargetTroop","extraDamageNotAdditionalAttack","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.rufus.armor-breaking-strike.extra","name":"hero-effect.rufus.armor-breaking-strike.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":0.6,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.rufus.armor-breaking-strike.vulnerability","name":"hero-effect.rufus.armor-breaking-strike.vulnerability","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.25,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.rufus.armor-breaking-strike.extra` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.rufus.armor-breaking-strike.vulnerability` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 3. 暴烈震爆（`hero-skill.rufus.violent-blast`）

- **实现名/原文**：鲁弗斯·暴烈震爆；盾/矛/射每次主攻击尝试分别20%判定；触发使本次选中目标穿透降低50%持续2回合，闪避仍判定，同一目标重复触发覆盖刷新。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=`0.2`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`、`penetration`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","expeditionSlot3","hitTargetTroop","perTroopAttack","replaceOnRetrigger"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.rufus.violent-blast.penetration-reduction","name":"hero-effect.rufus.violent-blast.penetration-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.5,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.rufus.violent-blast.penetration-reduction` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyPenetrationReduction 为战报穿透属性除法削减组，同组先加算。 |

##### 4. 鲁弗斯专武·烈火旅团（`hero-weapon-skill.rufus.rally-attack`）

- **实现名/原文**：鲁弗斯专武·烈火旅团；专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s11Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **unverified**；项目内部 ruleStatus=`supported`；verificationStatus=—；项目效果库存状态=confirmed。
- **元数据**：source=`"2026-09-27 user-confirmed S11 expedition PVP rules"`；templateSource=—；tags=`["S11","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.rufus.rally-attack","name":"hero-weapon-effect.rufus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.rufus.rally-attack","name":"hero-weapon-effect.rufus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.rufus.rally-attack","name":"hero-weapon-effect.rufus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.rufus.rally-attack","name":"hero-weapon-effect.rufus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.rufus.rally-attack","name":"hero-weapon-effect.rufus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.rufus.rally-attack` | unverified | confirmed | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

### S12

#### 赫尔薇尔（盾，SSR，`hero.s12.hervor`）

远征静态属性（小数）：attack=14.5116；defense=14.5116；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 战争怒吼（`expedition.hervor.war-cry`） | 全军穿透提升25%。 | `{"5":0.25}` | `hero-skill.hervor.war-cry` |
| 2 | 不灭之师（`expedition.hervor.immortal-army`） | 盾兵受到普通攻击降低25%、技能伤害降低30%。 | `{"5":0.3}` | `hero-skill.hervor.immortal-army` |
| 3 | 战火意志（`expedition.hervor.will-of-war`） | 盾兵承伤降低15%、伤害提升10%。 | `{"5":0.15}` | `hero-skill.hervor.will-of-war` |

专武目录：基础属性上限 penetration=3.625、life=3.625；技能ID=`hero-weapon-skill.hervor.defense-defense`；已录入阶梯数值=`{"hero-weapon-skill.hervor.defense-defense":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 战争怒吼（`hero-skill.hervor.war-cry`）

- **实现名/原文**：赫尔薇尔·战争怒吼；全军穿透提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.hervor.penetration","name":"hero-effect.hervor.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.hervor.penetration` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 不灭之师（`hero-skill.hervor.immortal-army`）

- **实现名/原文**：赫尔薇尔·不灭之师；盾兵受到普通攻击降低25%、技能伤害降低30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"normalAttack"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"skillDamage"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot2","wuMingDamageTypeReductionTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.hervor.immortal-army.normal","name":"hero-effect.hervor.immortal-army.normal","kind":"damageReduction","recipient":"selfArmy","group":"receivedNormalAttackReduction","value":0.25,"scope":{"source":"army","target":"shield","damageType":"normalAttack"}}`<br>`{"id":"hero-effect.hervor.immortal-army.skill","name":"hero-effect.hervor.immortal-army.skill","kind":"damageReduction","recipient":"selfArmy","group":"receivedSkillDamageReduction","value":0.3,"scope":{"source":"army","target":"shield","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.hervor.immortal-army.normal` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：已确认伤害类型规则明确普攻减伤只匹配 normalAttack，作为 receivedNormalAttackReduction 独立小区。 |
| `hero-effect.hervor.immortal-army.skill` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：已确认伤害类型规则明确技能减伤匹配 skillDamage，并覆盖 extraDamage，作为 receivedSkillDamageReduction 独立小区。 |

##### 3. 战火意志（`hero-skill.hervor.will-of-war`）

- **实现名/原文**：赫尔薇尔·战火意志；盾兵承伤降低15%、伤害提升10%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.hervor.shield-reduction","name":"hero-effect.hervor.shield-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.15,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.hervor.shield-damage","name":"hero-effect.hervor.shield-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.1,"scope":{"source":"shield","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.hervor.shield-reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.hervor.shield-damage` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 赫尔薇尔专武·霜风坚垒（`hero-weapon-skill.hervor.defense-defense`）

- **实现名/原文**：赫尔薇尔专武·霜风坚垒；专武远征场景效果：defense Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hervor.defense-defense","name":"hero-weapon-effect.hervor.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hervor.defense-defense","name":"hero-weapon-effect.hervor.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hervor.defense-defense","name":"hero-weapon-effect.hervor.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hervor.defense-defense","name":"hero-weapon-effect.hervor.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hervor.defense-defense","name":"hero-weapon-effect.hervor.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.hervor.defense-defense` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffDefense，组内来源先加算，并与普通 defenseBonus 分开。 |

#### 加罗尔（矛，SSR，`hero.s12.karol`）

远征静态属性（小数）：attack=14.5116；defense=14.5116；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 守护之翼（`expedition.karol.guardian-wings`） | 全军受到伤害降低20%。 | `{"5":0.2}` | `hero-skill.karol.guardian-wings` |
| 2 | 破阵之矛（`expedition.karol.formation-breaking-spear`） | 全军对矛兵伤害+30%、对盾兵伤害+25%。 | `{"5":0.3}` | `hero-skill.karol.formation-breaking-spear` |
| 3 | 荣耀战旗（`expedition.karol.banner-of-glory`） | 全军攻击+15%、防御+10%。 | `{"5":0.15}` | `hero-skill.karol.banner-of-glory` |

专武目录：基础属性上限 penetration=3.625、life=3.625；技能ID=`hero-weapon-skill.karol.rally-attack`；已录入阶梯数值=`{"hero-weapon-skill.karol.rally-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 守护之翼（`hero-skill.karol.guardian-wings`）

- **实现名/原文**：加罗尔·守护之翼；全军受到伤害降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.karol.guardian-wings","name":"hero-effect.karol.guardian-wings","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.karol.guardian-wings` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 2. 破阵之矛（`hero-skill.karol.formation-breaking-spear`）

- **实现名/原文**：加罗尔·破阵之矛；全军对矛兵伤害+30%、对盾兵伤害+25%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"lancer","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot2","targetTroopModifier","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.karol.vs-lancer","name":"hero-effect.karol.vs-lancer","kind":"damageIncrease","recipient":"selfArmy","group":"troopVsTroopDamage","value":0.3,"scope":{"source":"army","target":"lancer","damageType":"all"}}`<br>`{"id":"hero-effect.karol.vs-shield","name":"hero-effect.karol.vs-shield","kind":"damageIncrease","recipient":"selfArmy","group":"troopVsTroopDamage","value":0.25,"scope":{"source":"army","target":"shield","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.karol.vs-lancer` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/v0.4-head-hero-skill-audit.md 明确 troopVsTroopDamage 与 baseDamageIncrease 分区；相应技能文本唯一指定 source/target 兵种。 |
| `hero-effect.karol.vs-shield` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/v0.4-head-hero-skill-audit.md 明确 troopVsTroopDamage 与 baseDamageIncrease 分区；相应技能文本唯一指定 source/target 兵种。 |

##### 3. 荣耀战旗（`hero-skill.karol.banner-of-glory`）

- **实现名/原文**：加罗尔·荣耀战旗；全军攻击+15%、防御+10%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.karol.attack","name":"hero-effect.karol.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.karol.defense","name":"hero-effect.karol.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"addToAttribute","group":"heroDefenseBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.karol.attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |
| `hero-effect.karol.defense` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 加罗尔专武·集群猛攻（`hero-weapon-skill.karol.rally-attack`）

- **实现名/原文**：加罗尔专武·集群猛攻；专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.karol.rally-attack","name":"hero-weapon-effect.karol.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.karol.rally-attack","name":"hero-weapon-effect.karol.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.karol.rally-attack","name":"hero-weapon-effect.karol.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.karol.rally-attack","name":"hero-weapon-effect.karol.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.karol.rally-attack","name":"hero-weapon-effect.karol.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.karol.rally-attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 丽姬娅（射，SSR，`hero.s12.ligeia`）

远征静态属性（小数）：attack=14.5116；defense=14.5116；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 钢牙啃噬（`expedition.ligeia.steel-fang-gnaw`） | 敌军全体防御降低25%。 | `{"5":0.25}` | `hero-skill.ligeia.steel-fang-gnaw` |
| 2 | 瓦解之毒（`expedition.ligeia.disintegrating-poison`） | 每第2次射手主攻击尝试若成功命中，对本次目标造成1B并预约次轮易伤25%；闪避仍计数但不产生效果。 | `{"5":1}` | `hero-skill.ligeia.disintegrating-poison` |
| 3 | 毒牙侵袭（`expedition.ligeia.venom-fang-assault`） | 与瓦解之毒共用每第2次射手主攻计数；命中后对本次目标追加1B并使其次轮造成伤害降低20%；两笔同目标1B合并为2B。 | `{"5":1}` | `hero-skill.ligeia.venom-fang-assault` |

专武目录：基础属性上限 penetration=3.625、life=3.625；技能ID=`hero-weapon-skill.ligeia.defense-penetration`；已录入阶梯数值=`{"hero-weapon-skill.ligeia.defense-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 钢牙啃噬（`hero-skill.ligeia.steel-fang-gnaw`）

- **实现名/原文**：丽姬娅·钢牙啃噬；敌军全体防御降低25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ligeia.defense-reduction","name":"hero-effect.ligeia.defense-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"defense","group":"enemyDefenseReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ligeia.defense-reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：README、英雄规则附件及打熊权威 docs/skill-multiplier-system.md 明确 defenseReduction 与 vulnerability 分区，且按独立增幅组处理。 |

##### 2. 瓦解之毒（`hero-skill.ligeia.disintegrating-poison`）

- **实现名/原文**：丽姬娅·瓦解之毒；每第2次射手主攻击尝试若成功命中，对本次目标造成1B并预约次轮易伤25%；闪避仍计数但不产生效果。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"successfulNormalAttackHit"`；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`vulnerability`；代码 effect kind=extraDamage、incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot2","usesAttackCount","sharedMarksmanAttackCounter","hitTargetTroop","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ligeia.disintegrating-poison.extra","name":"hero-effect.ligeia.disintegrating-poison.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.ligeia.disintegrating-poison.vulnerability","name":"hero-effect.ligeia.disintegrating-poison.vulnerability","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.25,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ligeia.disintegrating-poison.extra` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.ligeia.disintegrating-poison.vulnerability` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 3. 毒牙侵袭（`hero-skill.ligeia.venom-fang-assault`）

- **实现名/原文**：丽姬娅·毒牙侵袭；与瓦解之毒共用每第2次射手主攻计数；命中后对本次目标追加1B并使其次轮造成伤害降低20%；两笔同目标1B合并为2B。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"successfulNormalAttackHit"`；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`reduction`；代码 effect kind=extraDamage、outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","expeditionSlot3","usesAttackCount","sharedMarksmanAttackCounter","hitTargetTroop","poisonTarget","gordonPoisonTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ligeia.venom-fang-assault.extra","name":"hero-effect.ligeia.venom-fang-assault.extra","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.ligeia.venom-fang-assault.poison","name":"hero-effect.ligeia.venom-fang-assault.poison","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"enemyOutgoingDamageReduction","value":0.2,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.ligeia.venom-fang-assault.extra` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.ligeia.venom-fang-assault.poison` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 4. 丽姬娅专武·蜘蛛巢城（`hero-weapon-skill.ligeia.defense-penetration`）

- **实现名/原文**：丽姬娅专武·蜘蛛巢城；专武远征场景效果：penetration Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s12Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S12","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ligeia.defense-penetration","name":"hero-weapon-effect.ligeia.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ligeia.defense-penetration","name":"hero-weapon-effect.ligeia.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ligeia.defense-penetration","name":"hero-weapon-effect.ligeia.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ligeia.defense-penetration","name":"hero-weapon-effect.ligeia.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.ligeia.defense-penetration","name":"hero-weapon-effect.ligeia.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.ligeia.defense-penetration` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

### S13

#### 吉塞拉（盾，SSR，`hero.s13.gisela`）

远征静态属性（小数）：attack=16.2129；defense=16.2129；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 合金盾牌（`expedition.gisela.alloy-shield`） | 盾兵防御提升30%。 | `{"5":0.3}` | `hero-skill.gisela.alloy-shield` |
| 2 | 临时工事（`expedition.gisela.temporary-fortification`） | 盾兵主攻击时40%概率使全军本回合防御提升50%。 | `{"5":0.5}` | `hero-skill.gisela.temporary-fortification` |
| 3 | 试作护盾（`expedition.gisela.prototype-shield`） | 每回合一次40%判定，成功后全军本回合受到伤害降低50%。 | `{"5":0.5}` | `hero-skill.gisela.prototype-shield` |

专武目录：基础属性上限 penetration=4.05、life=4.05；技能ID=`hero-weapon-skill.gisela.defense-attack`；已录入阶梯数值=`{"hero-weapon-skill.gisela.defense-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 合金盾牌（`hero-skill.gisela.alloy-shield`）

- **实现名/原文**：吉塞拉·合金盾牌；盾兵防御提升30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gisela.shield-defense","name":"hero-effect.gisela.shield-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"addToAttribute","group":"heroDefenseBonus","value":0.3,"scope":{"source":"shield","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gisela.shield-defense` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 临时工事（`hero-skill.gisela.temporary-fortification`）

- **实现名/原文**：吉塞拉·临时工事；盾兵主攻击时40%概率使全军本回合防御提升50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=`0.4`；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"shield","interval":1,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.magenusi.steel-phalanx"`；tags=`["S13","expeditionSlot2","immediateCurrentRoundDefenseBuff"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gisela.temporary-fortification.1","name":"吉塞拉·临时工事·效果1","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"heroDefenseBonus","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gisela.temporary-fortification` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：兵种规则附件 3d5dff55.../pasted-text.txt 明确钢铁守护属于 skill defense bonus，与英雄/车身防御技能增益同体系而非独立防御倍率；专项同区测试验证。 |

##### 3. 试作护盾（`hero-skill.gisela.prototype-shield`）

- **实现名/原文**：吉塞拉·试作护盾；每回合一次40%判定，成功后全军本回合受到伤害降低50%。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`roundStart`；主攻判定时点=—；定义概率=`0.4`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","expeditionSlot3","oncePerRound","allArmy"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 40% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.gisela.prototype-shield","name":"hero-effect.gisela.prototype-shield","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.5,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"immediate","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.gisela.prototype-shield` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 4. 吉塞拉专武·自动台（`hero-weapon-skill.gisela.defense-attack`）

- **实现名/原文**：吉塞拉专武·自动台；专武远征场景效果：attack Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gisela.defense-attack","name":"hero-weapon-effect.gisela.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gisela.defense-attack","name":"hero-weapon-effect.gisela.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gisela.defense-attack","name":"hero-weapon-effect.gisela.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gisela.defense-attack","name":"hero-weapon-effect.gisela.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.gisela.defense-attack","name":"hero-weapon-effect.gisela.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.gisela.defense-attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 弗洛拉（矛，SSR，`hero.s13.flora`）

远征静态属性（小数）：attack=16.2129；defense=16.2129；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 刺藤曼舞（`expedition.flora.thorn-vine-dance`） | 三兵种每次主攻击尝试各自50%判定，本次选中目标下一回合易伤50%；闪避不撤销已发生的判定。 | `{"5":0.5}` | `hero-skill.flora.thorn-vine-dance` |
| 2 | 荆棘花丛（`expedition.flora.thorn-bush`） | 盾兵承伤降低25%、矛兵伤害提升25%。 | `{"5":0.25}` | `hero-skill.flora.thorn-bush` |
| 3 | 芳香迷雾（`expedition.flora.aromatic-mist`） | 自然R5/6、R9/10…使敌盾易伤30%、敌射造成伤害降低30%。 | `{"5":0.3}` | `hero-skill.flora.aromatic-mist` |

专武目录：基础属性上限 penetration=4.05、life=4.05；技能ID=`hero-weapon-skill.flora.defense-life`；已录入阶梯数值=`{"hero-weapon-skill.flora.defense-life":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 刺藤曼舞（`hero-skill.flora.thorn-vine-dance`）

- **实现名/原文**：弗洛拉·刺藤曼舞；三兵种每次主攻击尝试各自50%判定，本次选中目标下一回合易伤50%；闪避不撤销已发生的判定。
- **等级原数值**：`{"5":0.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=`0.5`；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"nextRound"`；durationRounds=`1`；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`vulnerability`；代码 effect kind=incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.miya.doom-entanglement"`；tags=`["S13","expeditionSlot1","hitTargetTroop","perTroopAttack","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 50% | duration=1；cooldown=— | period=—；start=— | `{"id":"hero-effect.flora.thorn-vine-dance.1","name":"弗洛拉·刺藤曼舞·效果1","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.5,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.flora.thorn-vine-dance` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 2. 荆棘花丛（`hero-skill.flora.thorn-bush`）

- **实现名/原文**：弗洛拉·荆棘花丛；盾兵承伤降低25%、矛兵伤害提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"lancer","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.flora.shield-reduction","name":"hero-effect.flora.shield-reduction","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.25,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.flora.lancer-damage","name":"hero-effect.flora.lancer-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.25,"scope":{"source":"lancer","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.flora.shield-reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.flora.lancer-damage` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 3. 芳香迷雾（`hero-skill.flora.aromatic-mist`）

- **实现名/原文**：弗洛拉·芳香迷雾；自然R5/6、R9/10…使敌盾易伤30%、敌射造成伤害降低30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`vulnerability`、`reduction`；代码 effect kind=incomingDamageIncrease、outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","expeditionSlot3","periodic","gordonPoisonCloudTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.flora.aromatic-mist.shield-vulnerability","name":"hero-effect.flora.aromatic-mist.shield-vulnerability","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.3,"scope":{"source":"army","target":"shield","damageType":"all"},"lifecycle":{"periodRounds":4,"firstActiveRound":5,"activeWindowRounds":2}}`<br>`{"id":"hero-effect.flora.aromatic-mist.marksman-outgoing","name":"hero-effect.flora.aromatic-mist.marksman-outgoing","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"enemyOutgoingDamageReduction","value":0.3,"scope":{"source":"marksman","target":"all","damageType":"all"},"lifecycle":{"periodRounds":4,"firstActiveRound":5,"activeWindowRounds":2}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.flora.aromatic-mist.shield-vulnerability` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |
| `hero-effect.flora.aromatic-mist.marksman-outgoing` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 4. 弗洛拉专武·自然祝福（`hero-weapon-skill.flora.defense-life`）

- **实现名/原文**：弗洛拉专武·自然祝福；专武远征场景效果：life Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.flora.defense-life","name":"hero-weapon-effect.flora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.flora.defense-life","name":"hero-weapon-effect.flora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.flora.defense-life","name":"hero-weapon-effect.flora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.flora.defense-life","name":"hero-weapon-effect.flora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.flora.defense-life","name":"hero-weapon-effect.flora.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.flora.defense-life` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffLife，生命按 (1+life)(1+buffLifeGroup)，组内来源先加算。 |

#### 乌尔卡努斯（射，SSR，`hero.s13.vulcanus`）

远征静态属性（小数）：attack=16.2129；defense=16.2129；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 枭雄之怒（`expedition.vulcanus.overlord-fury`） | 敌军全体攻击降低20%。 | `{"5":0.2}` | `hero-skill.vulcanus.overlord-fury` |
| 2 | 架裂之刃（`expedition.vulcanus.rifting-blade`） | 完全沿用格温空中压制：各兵种第6/12/18…次成功主攻击产生1B及目标一次性15%易伤令牌。 | `{"5":1}` | `hero-skill.vulcanus.rifting-blade` |
| 3 | 破碎之镰（`expedition.vulcanus.shattered-scythe`） | 每3回合敌盾/矛防御降低60%、我方射手攻击提升60%，持续1回合。 | `{"5":0.6}` | `hero-skill.vulcanus.shattered-scythe` |

专武目录：基础属性上限 penetration=4.05、life=4.05；技能ID=`hero-weapon-skill.vulcanus.rally-attack`；已录入阶梯数值=`{"hero-weapon-skill.vulcanus.rally-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 枭雄之怒（`hero-skill.vulcanus.overlord-fury`）

- **实现名/原文**：乌尔卡努斯·枭雄之怒；敌军全体攻击降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.vulcanus.overlord-fury","name":"hero-effect.vulcanus.overlord-fury","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.vulcanus.overlord-fury` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyAttackReduction 为战报攻击属性除法削减组，同组先加算。 |

##### 2. 架裂之刃（`hero-skill.vulcanus.rifting-blade`）

- **实现名/原文**：乌尔卡努斯·架裂之刃；完全沿用格温空中压制：各兵种第6/12/18…次成功主攻击产生1B及目标一次性15%易伤令牌。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"army","interval":6,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`vulnerability`；代码 effect kind=extraDamage、oneUseIncomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.gewen.aerial-suppression"`；tags=`["S13","expeditionSlot2","usesAttackCount","hitTargetTroop","bearModelSemantic","gwenAerialTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.vulcanus.rifting-blade.1","name":"乌尔卡努斯·架裂之刃·效果1","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"army","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.vulcanus.rifting-blade.2","name":"乌尔卡努斯·架裂之刃·效果2","kind":"oneUseIncomingDamageIncrease","recipient":"enemyArmy","group":"aerialSuppressionOverride","value":0.15,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"immediate","refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.vulcanus.rifting-blade.extra` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.vulcanus.rifting-blade.next-hit` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：标记/一次性生命周期有明确规则，但没有独立证据证明其伤害增幅应与普通 vulnerability 分区；当前专属 group 仅见于实现。 |

##### 3. 破碎之镰（`hero-skill.vulcanus.shattered-scythe`）

- **实现名/原文**：乌尔卡努斯·破碎之镰；每3回合敌盾/矛防御降低60%、我方射手攻击提升60%，持续1回合。
- **等级原数值**：`{"5":0.6}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"lancer","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction、attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","expeditionSlot3","periodic","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.vulcanus.shattered-scythe.shield-defense","name":"hero-effect.vulcanus.shattered-scythe.shield-defense","kind":"attributeReduction","recipient":"enemyArmy","attribute":"defense","group":"enemyDefenseReduction","value":0.6,"scope":{"source":"army","target":"shield","damageType":"all"},"lifecycle":{"periodRounds":3,"firstActiveRound":3,"activeWindowRounds":1}}`<br>`{"id":"hero-effect.vulcanus.shattered-scythe.lancer-defense","name":"hero-effect.vulcanus.shattered-scythe.lancer-defense","kind":"attributeReduction","recipient":"enemyArmy","attribute":"defense","group":"enemyDefenseReduction","value":0.6,"scope":{"source":"army","target":"lancer","damageType":"all"},"lifecycle":{"periodRounds":3,"firstActiveRound":3,"activeWindowRounds":1}}`<br>`{"id":"hero-effect.vulcanus.shattered-scythe.marksman-attack","name":"hero-effect.vulcanus.shattered-scythe.marksman-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.6,"scope":{"source":"marksman","target":"all","damageType":"all"},"lifecycle":{"periodRounds":3,"firstActiveRound":3,"activeWindowRounds":1}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.vulcanus.shattered-scythe.shield-defense` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：README、英雄规则附件及打熊权威 docs/skill-multiplier-system.md 明确 defenseReduction 与 vulnerability 分区，且按独立增幅组处理。 |
| `hero-effect.vulcanus.shattered-scythe.lancer-defense` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：README、英雄规则附件及打熊权威 docs/skill-multiplier-system.md 明确 defenseReduction 与 vulnerability 分区，且按独立增幅组处理。 |
| `hero-effect.vulcanus.shattered-scythe.marksman-attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 4. 乌尔卡努斯专武·王者之威（`hero-weapon-skill.vulcanus.rally-attack`）

- **实现名/原文**：乌尔卡努斯专武·王者之威；专武远征场景效果：attack Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s13Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S13","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.vulcanus.rally-attack","name":"hero-weapon-effect.vulcanus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.vulcanus.rally-attack","name":"hero-weapon-effect.vulcanus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.vulcanus.rally-attack","name":"hero-weapon-effect.vulcanus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.vulcanus.rally-attack","name":"hero-weapon-effect.vulcanus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.vulcanus.rally-attack","name":"hero-weapon-effect.vulcanus.rally-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.vulcanus.rally-attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

### S14

#### 艾丽芙（盾，SSR，`hero.s14.elif`）

远征静态属性（小数）：attack=17.9143；defense=17.9143；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 轻纱之缚（`expedition.elif.light-veil-binding`） | 敌军全体攻击降低25%。 | `{"5":0.25}` | `hero-skill.elif.light-veil-binding` |
| 2 | 千刃之阵（`expedition.elif.thousand-blade-formation`） | 全军攻击+15%、防御+10%。 | `{"5":0.15}` | `hero-skill.elif.thousand-blade-formation` |
| 3 | 绫绮之幕（`expedition.elif.brocade-veil`） | 沿用加托列王恩赐：每次盾兵主攻后按0.30×100×Ct×√当前盾兵数×(1+A_report)生成下一回合护盾，覆盖刷新。 | `{"5":0.3}` | `hero-skill.elif.brocade-veil` |

专武目录：基础属性上限 penetration=4.475、life=4.475；技能ID=`hero-weapon-skill.elif.defense-defense`；已录入阶梯数值=`{"hero-weapon-skill.elif.defense-defense":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 轻纱之缚（`hero-skill.elif.light-veil-binding`）

- **实现名/原文**：艾丽芙·轻纱之缚；敌军全体攻击降低25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S14","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.elif.light-veil-binding","name":"hero-effect.elif.light-veil-binding","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.elif.light-veil-binding` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyAttackReduction 为战报攻击属性除法削减组，同组先加算。 |

##### 2. 千刃之阵（`hero-skill.elif.thousand-blade-formation`）

- **实现名/原文**：艾丽芙·千刃之阵；全军攻击+15%、防御+10%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S14","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.elif.attack","name":"hero-effect.elif.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.elif.defense","name":"hero-effect.elif.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"addToAttribute","group":"heroDefenseBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.elif.attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |
| `hero-effect.elif.defense` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 3. 绫绮之幕（`hero-skill.elif.brocade-veil`）

- **实现名/原文**：艾丽芙·绫绮之幕；沿用加托列王恩赐：每次盾兵主攻后按0.30×100×Ct×√当前盾兵数×(1+A_report)生成下一回合护盾，覆盖刷新。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"shield","interval":1,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"nextRound"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`。
- **类型**：`shield`；代码 effect kind=temporaryShield。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.jiatuo.kings-gift"`；tags=`["S14","expeditionSlot3","temporaryShieldHp","gatotReportAttackPower","nextRound","replaceOnMainAttack"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.elif.brocade-veil.1","name":"艾丽芙·绫绮之幕·效果1","kind":"temporaryShield","recipient":"selfArmy","coefficient":0.3,"basis":"gatotReportAttackPower","scope":{"source":"shield","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.elif.brocade-veil` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本支持临时护盾语义，但当前“父事件 rawDamage 的 30% 且 RoundEnd 先吸收”公式仍标为 TENTATIVE；没有独立战报证据确认。 |

##### 4. 艾丽芙专武·卫戍之恩（`hero-weapon-skill.elif.defense-defense`）

- **实现名/原文**：艾丽芙专武·卫戍之恩；专武远征场景效果：defense Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S14","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.elif.defense-defense","name":"hero-weapon-effect.elif.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.elif.defense-defense","name":"hero-weapon-effect.elif.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.elif.defense-defense","name":"hero-weapon-effect.elif.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.elif.defense-defense","name":"hero-weapon-effect.elif.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.elif.defense-defense","name":"hero-weapon-effect.elif.defense-defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"multiplyAttributeFactor","group":"buffDefense","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.elif.defense-defense` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffDefense，组内来源先加算，并与普通 defenseBonus 分开。 |

#### 多米尼克（矛，SSR，`hero.s14.dominic`）

远征静态属性（小数）：attack=17.9143；defense=17.9143；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 幻形机巧（`expedition.dominic.shapeshifting-mechanism`） | 全军伤害提升20%。 | `{"5":0.2}` | `hero-skill.dominic.shapeshifting-mechanism` |
| 2 | 玫瑰突刺（`expedition.dominic.rose-thrust`） | 矛兵普通主攻击成功命中后，对本次目标产生0.6B并预约次轮易伤25%；闪避时均取消。 | `{"5":0.6}` | `hero-skill.dominic.rose-thrust` |
| 3 | 魔镜迷宫（`expedition.dominic.mirror-maze`） | 盾兵/射手承伤降低15%，盾兵/射手伤害提升15%。 | `{"5":0.15}` | `hero-skill.dominic.mirror-maze` |

专武目录：基础属性上限 penetration=4.475、life=4.475；技能ID=`hero-weapon-skill.dominic.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.dominic.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 幻形机巧（`hero-skill.dominic.shapeshifting-mechanism`）

- **实现名/原文**：多米尼克·幻形机巧；全军伤害提升20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S14","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.dominic.shapeshifting-mechanism","name":"hero-effect.dominic.shapeshifting-mechanism","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.dominic.shapeshifting-mechanism` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 2. 玫瑰突刺（`hero-skill.dominic.rose-thrust`）

- **实现名/原文**：多米尼克·玫瑰突刺；矛兵普通主攻击成功命中后，对本次目标产生0.6B并预约次轮易伤25%；闪避时均取消。
- **等级原数值**：`{"5":0.6}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"successfulNormalAttackHit"`；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`vulnerability`；代码 effect kind=extraDamage、incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.rufus.armor-breaking-strike"`；tags=`["S14","expeditionSlot2","hitTargetTroop","extraDamageNotAdditionalAttack","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.dominic.rose-thrust.1","name":"多米尼克·玫瑰突刺·效果1","kind":"extraDamage","recipient":"selfArmy","coefficient":0.6,"basis":"parentBaseDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.dominic.rose-thrust.2","name":"多米尼克·玫瑰突刺·效果2","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.25,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.dominic.rose-thrust.extra` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.dominic.rose-thrust.vulnerability` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |

##### 3. 魔镜迷宫（`hero-skill.dominic.mirror-maze`）

- **实现名/原文**：多米尼克·魔镜迷宫；盾兵/射手承伤降低15%，盾兵/射手伤害提升15%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"marksman","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.freya.agile-strike"`；tags=`["S14","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.dominic.mirror-maze.1","name":"多米尼克·魔镜迷宫·效果1","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.15,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.dominic.mirror-maze.2","name":"多米尼克·魔镜迷宫·效果2","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.15,"scope":{"source":"army","target":"marksman","damageType":"all"}}`<br>`{"id":"hero-effect.dominic.mirror-maze.3","name":"多米尼克·魔镜迷宫·效果3","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.15,"scope":{"source":"shield","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.dominic.mirror-maze.4","name":"多米尼克·魔镜迷宫·效果4","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.15,"scope":{"source":"marksman","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.dominic.shield-reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.dominic.marksman-reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.dominic.shield-damage` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.dominic.marksman-damage` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 多米尼克专武·宏大幻想（`hero-weapon-skill.dominic.rally-penetration`）

- **实现名/原文**：多米尼克专武·宏大幻想；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S14","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.dominic.rally-penetration","name":"hero-weapon-effect.dominic.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.dominic.rally-penetration","name":"hero-weapon-effect.dominic.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.dominic.rally-penetration","name":"hero-weapon-effect.dominic.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.dominic.rally-penetration","name":"hero-weapon-effect.dominic.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.dominic.rally-penetration","name":"hero-weapon-effect.dominic.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.dominic.rally-penetration` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

#### 卡拉（射，SSR，`hero.s14.cara`）

远征静态属性（小数）：attack=17.9143；defense=17.9143；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 迷雾重重（`expedition.cara.heavy-mist`） | 敌军全体穿透降低20%。 | `{"5":0.2}` | `hero-skill.cara.heavy-mist` |
| 2 | 机械魔宠（`expedition.cara.mechanical-pet`） | 全军普通攻击伤害提升30%。 | `{"5":0.3}` | `hero-skill.cara.mechanical-pet` |
| 3 | 魔女的强袭（`expedition.cara.witch-assault`） | 沿用韦恩迂回打击：每第2次射手主攻尝试对存活敌矛造成0.4B、敌射造成0.2B；闪避仍触发，缺失目标不转移。 | `{"5":0.4}` | `hero-skill.cara.witch-assault` |

专武目录：基础属性上限 penetration=4.475、life=4.475；技能ID=`hero-weapon-skill.cara.defense-penetration`；已录入阶梯数值=`{"hero-weapon-skill.cara.defense-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 迷雾重重（`hero-skill.cara.heavy-mist`）

- **实现名/原文**：卡拉·迷雾重重；敌军全体穿透降低20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`、`penetration`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S14","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.cara.heavy-mist","name":"hero-effect.cara.heavy-mist","kind":"attributeReduction","recipient":"enemyArmy","attribute":"penetration","group":"enemyPenetrationReduction","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.cara.heavy-mist` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目规则附件 bdbd26fe.../pasted-text.txt 明确 enemyPenetrationReduction 为战报穿透属性除法削减组，同组先加算。 |

##### 2. 机械魔宠（`hero-skill.cara.mechanical-pet`）

- **实现名/原文**：卡拉·机械魔宠；全军普通攻击伤害提升30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"normalAttack"}}`。
- **类型**：`normalAttackDamage`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S14","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.cara.mechanical-pet","name":"hero-effect.cara.mechanical-pet","kind":"damageIncrease","recipient":"selfArmy","group":"normalAttackDamageIncrease","value":0.3,"scope":{"source":"army","target":"all","damageType":"normalAttack"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.cara.mechanical-pet` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：兵种规则附件 3d5dff55.../pasted-text.txt 与打熊权威文档明确 normalAttackDamageIncrease 是仅作用普攻的独立增伤区，不并入 attack 或普通 damageIncrease。 |

##### 3. 魔女的强袭（`hero-skill.cara.witch-assault`）

- **实现名/原文**：卡拉·魔女的强袭；沿用韦恩迂回打击：每第2次射手主攻尝试对存活敌矛造成0.4B、敌射造成0.2B；闪避仍触发，缺失目标不转移。
- **等级原数值**：`{"5":0.4}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`beforeAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.weien.flanking-strike"`；tags=`["S14","expeditionSlot3","usesAttackCount","multiTargetExtraDamage","noRetarget","wayneFlankingTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.cara.witch-assault.1","name":"卡拉·魔女的强袭·效果1","kind":"extraDamage","recipient":"selfArmy","coefficient":0.4,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"lancer","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.cara.witch-assault.2","name":"卡拉·魔女的强袭·效果2","kind":"extraDamage","recipient":"selfArmy","coefficient":0.2,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"marksman","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.cara.witch-assault.lancer` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |
| `hero-effect.cara.witch-assault.marksman` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 4. 卡拉专武·迷雾避难所（`hero-weapon-skill.cara.defense-penetration`）

- **实现名/原文**：卡拉专武·迷雾避难所；专武远征场景效果：penetration Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s14Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S14","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.cara.defense-penetration","name":"hero-weapon-effect.cara.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.cara.defense-penetration","name":"hero-weapon-effect.cara.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.cara.defense-penetration","name":"hero-weapon-effect.cara.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.cara.defense-penetration","name":"hero-weapon-effect.cara.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.cara.defense-penetration","name":"hero-weapon-effect.cara.defense-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.cara.defense-penetration` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

### S15

#### 汉克（盾，SSR，`hero.s15.hank`）

远征静态属性（小数）：attack=19.6151；defense=19.6151；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 轰鸣的怒火（`expedition.hank.roaring-fury`） | 全军穿透提升25%。 | `{"5":0.25}` | `hero-skill.hank.roaring-fury` |
| 2 | 火花四溅（`expedition.hank.sparks-fly`） | 沿用埃莱奥诺拉腾焰飞芒：每第5次盾兵主攻尝试后，下两回合全军通用伤害提升25%、承伤降低25%；闪避仍计数。 | `{"5":0.25}` | `hero-skill.hank.sparks-fly` |
| 3 | 狂暴之力（`expedition.hank.berserk-power`） | 沿用弗洛拉芳香迷雾：自然R5/6、R9/10…使敌盾易伤30%、敌射造成伤害降低30%。 | `{"5":0.3}` | `hero-skill.hank.berserk-power` |

专武目录：基础属性上限 penetration=4.9、life=4.9；技能ID=`hero-weapon-skill.hank.defense-life`；已录入阶梯数值=`{"hero-weapon-skill.hank.defense-life":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 轰鸣的怒火（`hero-skill.hank.roaring-fury`）

- **实现名/原文**：汉克·轰鸣的怒火；全军穿透提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S15","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.hank.penetration","name":"hero-effect.hank.penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.hank.penetration` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 火花四溅（`hero-skill.hank.sparks-fly`）

- **实现名/原文**：汉克·火花四溅；沿用埃莱奥诺拉腾焰飞芒：每第5次盾兵主攻尝试后，下两回合全军通用伤害提升25%、承伤降低25%；闪避仍计数。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"mainAttackAttempt"`；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"shield","interval":5,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`、`reduction`；代码 effect kind=damageIncrease、damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.eleonora.soaring-flame"`；tags=`["S15","expeditionSlot2","usesAttackCount","norahMomentumTemplate","replaceOnRetrigger","soaringFlameTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.hank.sparks-fly.1","name":"汉克·火花四溅·效果1","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}`<br>`{"id":"hero-effect.hank.sparks-fly.2","name":"汉克·火花四溅·效果2","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":2,"refreshMode":"replace"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.hank.sparks-fly.damage` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |
| `hero-effect.hank.sparks-fly.reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：SR/英雄规则明确通用“受到伤害降低”进入 receivedDamageReduction；README 将其与 outgoing reduction、直接抵消和属性防御严格分开。 |

##### 3. 狂暴之力（`hero-skill.hank.berserk-power`）

- **实现名/原文**：汉克·狂暴之力；沿用弗洛拉芳香迷雾：自然R5/6、R9/10…使敌盾易伤30%、敌射造成伤害降低30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`vulnerability`、`reduction`；代码 effect kind=incomingDamageIncrease、outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.flora.aromatic-mist"`；tags=`["S15","expeditionSlot3","periodic","gordonPoisonCloudTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.hank.berserk-power.1","name":"汉克·狂暴之力·效果1","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.3,"scope":{"source":"army","target":"shield","damageType":"all"},"lifecycle":{"periodRounds":4,"firstActiveRound":5,"activeWindowRounds":2}}`<br>`{"id":"hero-effect.hank.berserk-power.2","name":"汉克·狂暴之力·效果2","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"enemyOutgoingDamageReduction","value":0.3,"scope":{"source":"marksman","target":"all","damageType":"all"},"lifecycle":{"periodRounds":4,"firstActiveRound":5,"activeWindowRounds":2}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.hank.berserk-power.shield-vulnerability` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威 docs/skill-multiplier-system.md 与英雄规则明确普通易伤进入 vulnerability，同组加算，并与 defenseReduction 分区。 |
| `hero-effect.hank.berserk-power.marksman-outgoing` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |

##### 4. 汉克专武·绝望之墙（`hero-weapon-skill.hank.defense-life`）

- **实现名/原文**：汉克专武·绝望之墙；专武远征场景效果：life Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S15","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hank.defense-life","name":"hero-weapon-effect.hank.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hank.defense-life","name":"hero-weapon-effect.hank.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hank.defense-life","name":"hero-weapon-effect.hank.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hank.defense-life","name":"hero-weapon-effect.hank.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.hank.defense-life","name":"hero-weapon-effect.hank.defense-life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"multiplyAttributeFactor","group":"buffLife","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.hank.defense-life` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffLife，生命按 (1+life)(1+buffLifeGroup)，组内来源先加算。 |

#### 艾丝黛拉（矛，SSR，`hero.s15.estrella`）

远征静态属性（小数）：attack=19.6151；defense=19.6151；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 月蚀哀色（`expedition.estrella.eclipse-sorrow`） | 敌军全体防御降低25%。 | `{"5":0.25}` | `hero-skill.estrella.eclipse-sorrow` |
| 2 | 黎明画卷（`expedition.estrella.dawn-canvas`） | 全军攻击+15%、防御+10%。 | `{"5":0.15}` | `hero-skill.estrella.dawn-canvas` |
| 3 | 浮彩盛景（`expedition.estrella.colorful-scene`） | 盾兵承伤降低25%、矛兵伤害提升25%。 | `{"5":0.25}` | `hero-skill.estrella.colorful-scene` |

专武目录：基础属性上限 penetration=4.9、life=4.9；技能ID=`hero-weapon-skill.estrella.defense-attack`；已录入阶梯数值=`{"hero-weapon-skill.estrella.defense-attack":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 月蚀哀色（`hero-skill.estrella.eclipse-sorrow`）

- **实现名/原文**：艾丝黛拉·月蚀哀色；敌军全体防御降低25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S15","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.estrella.defense-reduction","name":"hero-effect.estrella.defense-reduction","kind":"attributeReduction","recipient":"enemyArmy","attribute":"defense","group":"enemyDefenseReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.estrella.defense-reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：README、英雄规则附件及打熊权威 docs/skill-multiplier-system.md 明确 defenseReduction 与 vulnerability 分区，且按独立增幅组处理。 |

##### 2. 黎明画卷（`hero-skill.estrella.dawn-canvas`）

- **实现名/原文**：艾丝黛拉·黎明画卷；全军攻击+15%、防御+10%。
- **等级原数值**：`{"5":0.15}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S15","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.estrella.attack","name":"hero-effect.estrella.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.estrella.defense","name":"hero-effect.estrella.defense","kind":"attributeModifier","recipient":"selfArmy","attribute":"defense","operation":"addToAttribute","group":"heroDefenseBonus","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.estrella.attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |
| `hero-effect.estrella.defense` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 3. 浮彩盛景（`hero-skill.estrella.colorful-scene`）

- **实现名/原文**：艾丝黛拉·浮彩盛景；盾兵承伤降低25%、矛兵伤害提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"lancer","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.flora.thorn-bush"`；tags=`["S15","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.estrella.colorful-scene.1","name":"艾丝黛拉·浮彩盛景·效果1","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.25,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.estrella.colorful-scene.2","name":"艾丝黛拉·浮彩盛景·效果2","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.25,"scope":{"source":"lancer","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.estrella.shield-reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.estrella.lancer-damage` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 艾丝黛拉专武·家园守护（`hero-weapon-skill.estrella.defense-attack`）

- **实现名/原文**：艾丝黛拉专武·家园守护；专武远征场景效果：attack Buff；仅在 rallyDefense、garrisonDefense 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyDefense","garrisonDefense"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S15","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.estrella.defense-attack","name":"hero-weapon-effect.estrella.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.estrella.defense-attack","name":"hero-weapon-effect.estrella.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.estrella.defense-attack","name":"hero-weapon-effect.estrella.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.estrella.defense-attack","name":"hero-weapon-effect.estrella.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.estrella.defense-attack","name":"hero-weapon-effect.estrella.defense-attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"multiplyAttributeFactor","group":"buffAttack","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.estrella.defense-attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffAttack，组内来源先加算，并与普通 attackBonus 分开。 |

#### 维薇卡（射，SSR，`hero.s15.viveca`）

远征静态属性（小数）：attack=19.6151；defense=19.6151；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 暗夜军团（`expedition.viveca.dark-night-legion`） | 全军攻击提升25%。 | `{"5":0.25}` | `hero-skill.viveca.dark-night-legion` |
| 2 | 暗影视界（`expedition.viveca.shadow-vision`） | 射手普攻成功命中后独立20%判定，成功对每个仍存活敌军兵种栈分别造成1B；闪避时不判定。 | `{"5":1}` | `hero-skill.viveca.shadow-vision` |
| 3 | 迷雾之子（`expedition.viveca.child-of-mist`） | 盾兵承伤降低10%、射手伤害提升10%。 | `{"5":0.1}` | `hero-skill.viveca.child-of-mist` |

专武目录：基础属性上限 penetration=4.9、life=4.9；技能ID=`hero-weapon-skill.viveca.rally-penetration`；已录入阶梯数值=`{"hero-weapon-skill.viveca.rally-penetration":{"1":0.05,"2":0.075,"3":0.1,"4":0.125,"5":0.15}}`。

PVP 注册技能 4 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 暗夜军团（`hero-skill.viveca.dark-night-legion`）

- **实现名/原文**：维薇卡·暗夜军团；全军攻击提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S15","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.viveca.attack","name":"hero-effect.viveca.attack","kind":"attributeModifier","recipient":"selfArmy","attribute":"attack","operation":"addToAttribute","group":"heroAttackBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.viveca.attack` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：本轮最终确认规则：技能属性不修改战报面板；同组数值相加后乘在 (1+panelAttribute) 上，异组相乘。 该 effect 的 group 归属沿用已记录的单项规则证据。 |

##### 2. 暗影视界（`hero-skill.viveca.shadow-vision`）

- **实现名/原文**：维薇卡·暗影视界；射手普攻成功命中后独立20%判定，成功对每个仍存活敌军兵种栈分别造成1B；闪避时不判定。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"successfulNormalAttackHit"`；定义概率=`0.2`；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"marksman","interval":1,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.nuola.catch-off-guard"`；tags=`["S15","expeditionSlot2","usesAttackCount","multiTargetExtraDamage"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | 20% | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.viveca.shadow-vision.1","name":"维薇卡·暗影视界·效果1","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"all","damageType":"skillDamage"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.viveca.shadow-vision.all` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：技能原始规则及打熊复用规则明确该 effect 生成独立 skillDamage/extraDamage 事件，而非并入普通攻击增伤乘区。 |

##### 3. 迷雾之子（`hero-skill.viveca.child-of-mist`）

- **实现名/原文**：维薇卡·迷雾之子；盾兵承伤降低10%、射手伤害提升10%。
- **等级原数值**：`{"5":0.1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`reduction`、`damageIncrease`；代码 effect kind=damageReduction、damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.magenusi.ice-sea-tactics"`；tags=`["S15","expeditionSlot3"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.viveca.child-of-mist.1","name":"维薇卡·迷雾之子·效果1","kind":"damageReduction","recipient":"selfArmy","group":"receivedDamageReduction","value":0.1,"scope":{"source":"army","target":"shield","damageType":"all"}}`<br>`{"id":"hero-effect.viveca.child-of-mist.2","name":"维薇卡·迷雾之子·效果2","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.1,"scope":{"source":"marksman","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-effect.viveca.shield-reduction` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：技能文本确认 effectKind、数值与 scope，但未找到独立证据证明当前专属 group 与同类通用 group 应同区或异区；当前归属仅为实现。 |
| `hero-effect.viveca.marksman-damage` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：打熊权威文档 docs/v0.4-head-hero-skill-audit.md 与 docs/head-hero-skill-zones.md 明确普通全军/兵种增伤同属 baseDamageIncrease；技能文本可唯一映射到该普通增伤区。 |

##### 4. 维薇卡专武·破晓之歌（`hero-weapon-skill.viveca.rally-penetration`）

- **实现名/原文**：维薇卡专武·破晓之歌；专武远征场景效果：penetration Buff；仅在 rallyAttack 生效。原远征目录未提供独立技能文案。
- **等级原数值**：专武见下列逐级效果；远征目录无单独条目。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=`["rallyAttack"]`。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"exclusiveWeapon","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s15Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S15","exclusiveWeapon","weaponSkill2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 1 | Exclusive Weapon Tier 1 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.viveca.rally-penetration","name":"hero-weapon-effect.viveca.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.05,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 2 | Exclusive Weapon Tier 2 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.viveca.rally-penetration","name":"hero-weapon-effect.viveca.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.075,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 3 | Exclusive Weapon Tier 3 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.viveca.rally-penetration","name":"hero-weapon-effect.viveca.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.1,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 4 | Exclusive Weapon Tier 4 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.viveca.rally-penetration","name":"hero-weapon-effect.viveca.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.125,"scope":{"source":"army","target":"all","damageType":"all"}}` |
| 5 | Exclusive Weapon Tier 5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-weapon-effect.viveca.rally-penetration","name":"hero-weapon-effect.viveca.rally-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"multiplyAttributeFactor","group":"buffPenetration","value":0.15,"scope":{"source":"army","target":"all","damageType":"all"}}` |

效果级验证依据：

| effectId | 战报口径 | 库存标记 | 依据/缺口 |
| --- | --- | --- | --- |
| `hero-weapon-effect.viveca.rally-penetration` | provisional | 已废止 | 旧库存证据（已由 2026-09-27 用户规则覆盖）：独立证据：项目既往明确规则规定专武 Buff 大乘区含 buffPenetration，组内来源先加算，并与普通 penetrationBonus 分开。 |

### S16

#### 西格尔（盾，SSR，`hero.s16.sigel`）

远征静态属性（小数）：attack=21.317；defense=21.317；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 暗夜铠胄（`expedition.sigel.dark-armor`） | 全军生命提升25%。 | `{"5":0.25}` | `hero-skill.sigel.dark-armor` |
| 2 | 永夜坚城（`expedition.sigel.eternal-fortress`） | 己方盾兵攻击属性降低20%；敌方矛兵、射手攻击属性降低35%。 | `{"5":0.35}` | `hero-skill.sigel.eternal-fortress` |
| 3 | 极夜先锋（`expedition.sigel.night-vanguard`） | 盾兵受到普通攻击伤害降低25%、技能伤害降低30%，沿用赫尔薇尔不灭之师。 | `{"5":0.3}` | `hero-skill.sigel.night-vanguard` |

PVP 注册技能 3 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 暗夜铠胄（`hero-skill.sigel.dark-armor`）

- **实现名/原文**：西格尔·暗夜铠胄；全军生命提升25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`；代码 effect kind=attributeModifier。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S16","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.sigel.life","name":"hero-effect.sigel.life","kind":"attributeModifier","recipient":"selfArmy","attribute":"life","operation":"addToAttribute","group":"heroLifeBonus","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

##### 2. 永夜坚城（`hero-skill.sigel.eternal-fortress`）

- **实现名/原文**：西格尔·永夜坚城；己方盾兵攻击属性降低20%；敌方矛兵、射手攻击属性降低35%。
- **等级原数值**：`{"5":0.35}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"shield","target":"all","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"lancer","target":"all","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S16","expeditionSlot2"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.sigel.self-shield-attack","name":"hero-effect.sigel.self-shield-attack","kind":"attributeReduction","recipient":"selfArmy","attribute":"attack","group":"selfAttackReduction","value":0.2,"scope":{"source":"shield","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.sigel.enemy-lancer-attack","name":"hero-effect.sigel.enemy-lancer-attack","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.35,"scope":{"source":"lancer","target":"all","damageType":"all"}}`<br>`{"id":"hero-effect.sigel.enemy-marksman-attack","name":"hero-effect.sigel.enemy-marksman-attack","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.35,"scope":{"source":"marksman","target":"all","damageType":"all"}}` |

##### 3. 极夜先锋（`hero-skill.sigel.night-vanguard`）

- **实现名/原文**：西格尔·极夜先锋；盾兵受到普通攻击伤害降低25%、技能伤害降低30%，沿用赫尔薇尔不灭之师。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"normalAttack"}}`、`{"recipient":"selfArmy","scope":{"source":"army","target":"shield","damageType":"skillDamage"}}`。
- **类型**：`reduction`；代码 effect kind=damageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.hervor.immortal-army"`；tags=`["S16","expeditionSlot3","wuMingDamageTypeReductionTemplate"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.sigel.night-vanguard.1","name":"西格尔·极夜先锋·效果1","kind":"damageReduction","recipient":"selfArmy","group":"receivedNormalAttackReduction","value":0.25,"scope":{"source":"army","target":"shield","damageType":"normalAttack"}}`<br>`{"id":"hero-effect.sigel.night-vanguard.2","name":"西格尔·极夜先锋·效果2","kind":"damageReduction","recipient":"selfArmy","group":"receivedSkillDamageReduction","value":0.3,"scope":{"source":"army","target":"shield","damageType":"skillDamage"}}` |

#### 乌尔撒（矛，SSR，`hero.s16.ursa`）

远征静态属性（小数）：attack=21.317；defense=21.317；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 蕈林迷踪（`expedition.ursa.mushroom-maze`） | 敌军全体攻击属性降低25%。 | `{"5":0.25}` | `hero-skill.ursa.mushroom-maze` |
| 2 | 先祖号角（`expedition.ursa.ancestral-horn`） | 自然R2/4/6…当轮我方矛兵、射手穿透提升30%，敌军全体防御属性降低30%。 | `{"5":0.3}` | `hero-skill.ursa.ancestral-horn` |
| 3 | 蕈毒尖刃（`expedition.ursa.poison-blade`） | 每第2次矛兵主攻击尝试若命中，产生1B并使本次目标次轮易伤25%；闪避仍计数但取消效果。 | `{"5":1}` | `hero-skill.ursa.poison-blade` |

PVP 注册技能 3 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 蕈林迷踪（`hero-skill.ursa.mushroom-maze`）

- **实现名/原文**：乌尔撒·蕈林迷踪；敌军全体攻击属性降低25%。
- **等级原数值**：`{"5":0.25}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`reduction`；代码 effect kind=attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S16","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ursa.enemy-attack","name":"hero-effect.ursa.enemy-attack","kind":"attributeReduction","recipient":"enemyArmy","attribute":"attack","group":"enemyAttackReduction","value":0.25,"scope":{"source":"army","target":"all","damageType":"all"}}` |

##### 2. 先祖号角（`hero-skill.ursa.ancestral-horn`）

- **实现名/原文**：乌尔撒·先祖号角；自然R2/4/6…当轮我方矛兵、射手穿透提升30%，敌军全体防御属性降低30%。
- **等级原数值**：`{"5":0.3}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"all","damageType":"all"}}`、`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`attribute`、`penetration`、`reduction`；代码 effect kind=attributeModifier、attributeReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S16","expeditionSlot2","periodic","naturalRoundOnly"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ursa.lancer-penetration","name":"hero-effect.ursa.lancer-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.3,"scope":{"source":"lancer","target":"all","damageType":"all"},"lifecycle":{"periodRounds":2,"firstActiveRound":2,"activeWindowRounds":1}}`<br>`{"id":"hero-effect.ursa.marksman-penetration","name":"hero-effect.ursa.marksman-penetration","kind":"attributeModifier","recipient":"selfArmy","attribute":"penetration","operation":"addToAttribute","group":"heroPenetrationBonus","value":0.3,"scope":{"source":"marksman","target":"all","damageType":"all"},"lifecycle":{"periodRounds":2,"firstActiveRound":2,"activeWindowRounds":1}}`<br>`{"id":"hero-effect.ursa.enemy-defense","name":"hero-effect.ursa.enemy-defense","kind":"attributeReduction","recipient":"enemyArmy","attribute":"defense","group":"enemyDefenseReduction","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"periodRounds":2,"firstActiveRound":2,"activeWindowRounds":1}}` |

##### 3. 蕈毒尖刃（`hero-skill.ursa.poison-blade`）

- **实现名/原文**：乌尔撒·蕈毒尖刃；每第2次矛兵主攻击尝试若命中，产生1B并使本次目标次轮易伤25%；闪避仍计数但取消效果。
- **等级原数值**：`{"5":1}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=`"successfulNormalAttackHit"`；定义概率=—；行动机制=`{"kind":"attackCountTrigger","schedule":{"source":"lancer","interval":2,"mode":"onCompleted"}}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"currentTarget","damageType":"all"}}`。
- **类型**：`skillDamage`、`extraDamage`、`vulnerability`；代码 effect kind=extraDamage、incomingDamageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.ligeia.disintegrating-poison"`；tags=`["S16","expeditionSlot3","usesAttackCount","hitTargetTroop","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.ursa.poison-blade.1","name":"乌尔撒·蕈毒尖刃·效果1","kind":"extraDamage","recipient":"selfArmy","coefficient":1,"basis":"parentBaseDamage","scope":{"source":"lancer","target":"currentTarget","damageType":"skillDamage"}}`<br>`{"id":"hero-effect.ursa.poison-blade.2","name":"乌尔撒·蕈毒尖刃·效果2","kind":"incomingDamageIncrease","recipient":"enemyArmy","group":"vulnerability","value":0.25,"scope":{"source":"army","target":"currentTarget","damageType":"all"},"lifecycle":{"activationTiming":"nextRound","durationRounds":1,"refreshMode":"replace"}}` |

#### 艾诗琳（射，SSR，`hero.s16.aishilin`）

远征静态属性（小数）：attack=21.317；defense=21.317；penetration=0；life=0。英雄资料：`src/pvp/heroSkills/data/expeditionHeroes.ts`。

| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |
| --- | --- | --- | --- | --- |
| 1 | 林间战曲（`expedition.aishilin.forest-song`） | 全军通用伤害提升20%。 | `{"5":0.2}` | `hero-skill.aishilin.forest-song` |
| 2 | 矢石如雨（`expedition.aishilin.arrow-rain`） | 自然R3/6/9…当轮射手通用伤害提升150%，敌军造成伤害降低30%。 | `{"5":1.5}` | `hero-skill.aishilin.arrow-rain` |
| 3 | 森林之怒（`expedition.aishilin.forest-fury`） | 自然R3/6/9…射手对每个仍存活敌方兵种栈分别造成0.4B技能额外伤害。 | `{"5":0.4}` | `hero-skill.aishilin.forest-fury` |

PVP 注册技能 3 项；以下逐项展开代码中的全部等级、效果和生命周期。

##### 1. 林间战曲（`hero-skill.aishilin.forest-song`）

- **实现名/原文**：艾诗琳·林间战曲；全军通用伤害提升20%。
- **等级原数值**：`{"5":0.2}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`；代码 effect kind=damageIncrease。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":1,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S16","expeditionSlot1"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.aishilin.army-damage","name":"hero-effect.aishilin.army-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":0.2,"scope":{"source":"army","target":"all","damageType":"all"}}` |

##### 2. 矢石如雨（`hero-skill.aishilin.arrow-rain`）

- **实现名/原文**：艾诗琳·矢石如雨；自然R3/6/9…当轮射手通用伤害提升150%，敌军造成伤害降低30%。
- **等级原数值**：`{"5":1.5}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`passive`；主攻判定时点=—；定义概率=—；行动机制=—；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"all"}}`、`{"recipient":"enemyArmy","scope":{"source":"army","target":"all","damageType":"all"}}`。
- **类型**：`damageIncrease`、`reduction`；代码 effect kind=damageIncrease、outgoingDamageReduction。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":2,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=—；tags=`["S16","expeditionSlot2","periodic","naturalRoundOnly"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=—；start=— | `{"id":"hero-effect.aishilin.marksman-damage","name":"hero-effect.aishilin.marksman-damage","kind":"damageIncrease","recipient":"selfArmy","group":"commonDamageIncrease","value":1.5,"scope":{"source":"marksman","target":"all","damageType":"all"},"lifecycle":{"periodRounds":3,"firstActiveRound":3,"activeWindowRounds":1}}`<br>`{"id":"hero-effect.aishilin.enemy-outgoing","name":"hero-effect.aishilin.enemy-outgoing","kind":"outgoingDamageReduction","recipient":"enemyArmy","group":"enemyOutgoingDamageReduction","value":0.3,"scope":{"source":"army","target":"all","damageType":"all"},"lifecycle":{"periodRounds":3,"firstActiveRound":3,"activeWindowRounds":1}}` |

##### 3. 森林之怒（`hero-skill.aishilin.forest-fury`）

- **实现名/原文**：艾诗琳·森林之怒；自然R3/6/9…射手对每个仍存活敌方兵种栈分别造成0.4B技能额外伤害。
- **等级原数值**：`{"5":0.4}`。目录数值可能只概括技能，实际多效果数值见下表。
- **触发**：`afterNormalAttack`；主攻判定时点=—；定义概率=—；行动机制=`{"kind":"naturalRoundTrigger","source":"marksman"}`；场景=—。
- **生效/持续**：定义 activationTiming=`"immediate"`；durationRounds=—；cooldownRounds=—。逐效果 lifecycle 和逐等级覆盖值见下表；`passive` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。
- **目标范围**：`{"recipient":"selfArmy","scope":{"source":"marksman","target":"all","damageType":"skillDamage"}}`。
- **类型**：`skillDamage`、`extraDamage`；代码 effect kind=extraDamage。
- **位置**：`{"kind":"expeditionSkillSlot","expeditionSkillSlot":3,"allowedPositions":["leader","member"]}`；**源码**：`src/pvp/heroSkills/definitions/s16Heroes.ts`。
- **验证状态（战报口径）**：⚠️ **provisional**；项目内部 ruleStatus=`TENTATIVE`；verificationStatus=`"inferredFromPriorGenerations"`；项目效果库存状态=历史快照已废止。
- **元数据**：source=`"2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable"`；templateSource=`"hero-skill.s8.hengdelike.heir-of-forest"`；tags=`["S16","expeditionSlot3","periodic","multiTargetExtraDamage","bearModelSemantic"]`。

| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |
| --- | --- | --- | --- | --- | --- |
| 5 | Expedition Lv.5 | — | duration=—；cooldown=— | period=3；start=3 | `{"id":"hero-effect.aishilin.forest-fury.1","name":"艾诗琳·森林之怒·效果1","kind":"extraDamage","recipient":"selfArmy","coefficient":0.4,"basis":"parentBaseDamage","scope":{"source":"marksman","target":"all","damageType":"skillDamage"}}` |

## 第三部分：战报验证与证据边界

项目历史库存记有：阿隆索·钢铁意志约 20% 触发率及下回合穿透减益；玲奈·迅影舞步闪避主攻击；玲奈·影刃产生独立额外伤害；芮妮·惊梦留痕延时 `2B` 额外事件且不吃玲奈普通攻击专属增伤；韦恩·惊雷奇袭四回合周期独立事件。加托 `X=100×Ct×√n×(1+A_report)`、Lv4/5 系数、书允不进入 `X`、烈晶盾牌/炽红力场与巴希提同组，属于 2026-09-27 用户指定的实验结论，并已加回归测试。S9 马格努斯约 1500 次盾主攻中 604 次触发的统计由用户提供，原始战报未随仓库附上。韦恩暴击旧库存文字记为独立技能伤害，与本次 S10 复用韦恩普通攻击暴击模板的规则冲突；当前代码执行后者，旧证据不能再标成当前规则已验证。S11 新口径已按用户确认规则录入并通过代码回归，合成日志不能替代真实游戏战报。原始 Sheet2/Sheet3 表格未随当前仓库存档，后续仍应复核更广泛的实战条件。严格证据标签见全量表及 [技能库存](hero_skill_inventory.md)。

## 第四部分：当前未解决问题（按优先级）

1. **高**：用真实逐事件战报拟合攻穿防、四属性来源分层、同组/异组边界与取整；当前通过的是模拟器回归，不等于游戏外部验证。
2. **高**：加托新护盾公式与承伤降低同组结算已按确认口径实现；仍需更多原始逐事件战报复核边界、首轮顺序和残盾。
3. **高**：T12 兵种技能继续进行真实战报拟合验证；实际等级与常数已按最新明确表修正，不存在等级不再作为待补常数。
4. **中**：周期、首轮、主攻击尝试与完成的时序边界；菲兰德、琳恩、赫克托、韦恩和 S8～S16 技能需逐回合战报核对，尤其韦恩暴击的新旧证据冲突。S12～S16 尚无可用 PVP 战报，全部标为 provisional。
5. **中**：S1～S16 部分目录仅录入 Lv5，缺失等级不插值；S16 专武数据未录入，专武阶梯、作用场景和英雄全量技能需继续收集原始数据。
6. **中**：预测模式外部 Buff 与游戏战报最终面板的映射、集结人数分配、混级兵堆伤亡及真实战报拟合误差。

S12～S16 的 provisional 数据、模板来源和 kB 边界见 [S12–S16 迁移](S12_S16_RULE_MIGRATION_2026-09-27.md)；S11 的主攻尝试、命中、kB 与目标状态见 [S11 迁移](S11_RULE_MIGRATION_2026-09-27.md)；S9/S10 规则见 [S9/S10 迁移](S9_S10_RULE_MIGRATION_2026-09-27.md)；S8 时序与属性分组见 [S8 最新迁移](S8_RULE_MIGRATION_2026-09-27.md)；加托容量、承伤降低与专项回归见 [2026-09-27 迁移](PVP_RULE_MIGRATION_2026-09-27.md)；此前完整底层迁移见 [2026-09-26 历史记录](PVP_RULE_MIGRATION_2026-09-26.md)。

