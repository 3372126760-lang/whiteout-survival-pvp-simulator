> 2026-10-09 专家四技能显示修正：冰火下拉框显示等级及正式解析值（Lv8 · 2.0%、Lv20 · 5.0%），下方显示当前效果与三队共享范围。UI / Criterion / Theory / 正式战斗输入复用唯一 resolver，A/B 独立等级；缺失数据明确阻止计算。优化器及队列审计输出等级、实际效果和解析状态。typecheck / lint / build 通过，111文件 / 1261项测试通过，72核心文件哈希未变，未启动新dev server。见 [修正说明](docs/pvp-ice-fire-expert-skill-display.md) 和 [验收记录](examples/ice-fire-expert-skill-validation.json)。

> 2026-10-09 本轮最终验收：typecheck / lint / build 全部通过；110个文件 / 1251项测试通过。真实 FastBattle 合成审计覆盖六排列、每排列1000场、合计6000场，失败0；仅换预期英雄已验证属性、Criterion和Theory实际分数变化。72个正式核心文件哈希未变；本地中文OCR属性与特殊加成实测通过，兵种识别关闭。本轮未启动新开发服务器，UI事件回归通过，未进行Edge现场视觉验收。见 [验收记录](examples/ice-fire-shared-conversion-validation.json)。

> 2026-10-09 11:27后规则：冰火宠物/专家改为每侧三队共享；每队独立保存历史/预期英雄和专武并复用单撞属性转换。OCR恢复属性与特殊加成，兵种/FC识别仍关闭。新增完整队列换位及敌方六排列稳健优化，从Criterion/Theory开始覆盖；Final默认每排列1000场。见 [本轮说明](docs/pvp-ice-fire-shared-conversion-permutations.md)。

> 2026-10-09 最新修正：装备锻炉我方为9项，逐兵种攻击、防御独立，仅穿透/生命配对；A方OCR预期9项，敌方仍共享2项。宝石矿洞仍为我方6项/敌方2项。见 [锻炉9项修正](docs/pvp-equipment-forge-schema.md)。此前冰火累计筛选、共享seed与baseline补样本见 [搜索报告](docs/pvp-ice-fire-cumulative-schema.md)。失败seed对应方案尚未提供，1500回合根因未确认；未修改正式核心规则。

# 无尽冬日 PVP 战斗模型项目状态（2026-10-08）

2026-10-08 历史记录（OCR职责由上方最新口径覆盖）：保存/覆盖/删除采用应用内Dialog；地心属性按1/2/4/12项Schema输入并统一展开12项；研究所敌方T10固定，我方独立选T10/LAB_T11/LAB_T12，仅T12显示技能0–3。OCR改为只读属性。冰火固定cursor与地心随机存活队列共享有界候选框架，默认单队150、Pair2000、Triple1000、Theory200；正式20/50/100/300/1000整场筛选，当前方案参与比较。107文件 / 1191项测试通过，typecheck/lint/build通过，72核心文件哈希未变。详见 [本轮交付](docs/pvp-inner-earth-ui-search.md)。

2026-10-08 冰火战歌来源修复：每队战报英雄和专武来源显式隔离；清空英雄、手填属性、复制/交换、旧配置迁移及保存/恢复同步清理残留。无英雄的 240% 属性保持因子 3.4，不再扣除旧 S11 静态贡献。优化器保留与属性快照绑定的独立基准；每队新增来源调试。typecheck / lint / build 通过，全量 105 文件 / 1162 项测试通过，72 个核心文件哈希未变。详见 [冰火战歌战报来源修复](docs/pvp-ice-fire-report-lineage-fix.md)。

2026-10-08 最新更新：新增“地心模式”六种玩法；原通用三队列入口收敛为“冰火战歌模式”，固定循环游标、实际剩兵继承，随机三队闯关仅用于地心大地之心/英雄之地。地心我方三队英雄、比例和属性独立，敌方容量/比例预设/属性共用；英雄之地每队容量190410，宝石矿洞/装备锻炉敌方150000。地下研究所专用无火晶T11/T12常数8.8437/10.4356，T12技能0～3。大地之心宠物为独立战斗上下文，不改写基础属性。无英雄四玩法使用EMPTY_HEAD比例专用路径，231比例全数值评价，Top30正式首筛、300场复筛、至少1000场最终验证。配置版本4迁移保留原始快照与提示。详见 [地心与冰火战歌交付说明](docs/pvp-inner-earth-modes.md)。

本轮最终检查：104文件 / 1147项测试全部通过，typecheck / lint / build 均 exitCode=0。72文件核对集合中70文件哈希未变；两个场景文件新增枚举、精确兵数和调度审计，正式BattleEngine、伤害/HP公式及已确认技能规则未修改。六玩法真实引擎审计与冰火五场序列验证已通过。结果应用保留独立属性和专武基准，过期候选不可应用。本轮未启动新的dev server，UI事件、保存、Worker与应用已回归，未进行Edge现场视觉验收。门禁记录见 [验收汇总](examples/inner-earth-validation-summary.json)。

2026-10-08 第五轮历史：最终战报模式强制固定当前车头与实际专武，单撞只搜比例、集结搜比例×车身。EMPTY_HEAD / EMPTY_BODY 均为一个合法模板；单撞全231比例计算Criterion / Theory并参加默认20场首筛，514确认进入搜索。长期“我的英雄”与本次参与优化分开，每个优化卡片一个勾选框。旧三队列的主界面入口与迁移方式已由本轮地心更新覆盖。详见 [第五轮报告](docs/pvp-criterion-optimizer-round5.md)。其历史门禁为99文件 / 1073测试通过、72文件哈希未变。

2026-10-08 第四轮记录：R / SR 与 S 分类别，S3+ 生成新车头时过滤 R/SR，手动与车身池保留；预测模式完整 S11 可用英雄池为 34 位，近期 S9～S11 可生成 876 套车头、202356 个车头×比例。单撞优化 A方/B方、集结攻防完整入口、每侧四张车身卡片均保留。其 95 文件 / 1032 测试记录见 [第四轮报告](docs/pvp-criterion-optimizer-round4.md)；最终战报搜索维度已被第五轮覆盖。

2026-10-07 历史记录：第三轮完成 C0 全局竞争、同效果族最多两次、共享种子 5 场探针及候选 20/40 场置信门槛，90 文件 / 991 测试通过。该轮英雄类别过滤口径已被第四轮覆盖。历史性能和输入边界见 [第三轮交付报告](docs/pvp-criterion-optimizer-round3.md)。后续正文保留此前模型状态快照。

2026-10-06 最新优化搜索：新增自动英雄稀有度／近三代规则、保守支配审计、多个盆地连续 5% 爬坡和局部 1% 精搜。理论 35%/65% 权重与最终正式 BattleEngine 复验保留，核心战斗和技能规则未修改。详见 [本轮交付与验收报告](docs/pvp-basin-search-and-hero-policy.md)。


2026-10-06 更新：预测属性的专武攻、防、穿、血增益统一进入外部 Buff 同组，普通 Buff 与专武 Buff 先相加，再乘原始属性与阵容/官职加算层；详见 [专武乘区修复](docs/pvp-weapon-external-buff-fix.md)。2026-10-01 的 32 个实际等级显式常数表（基础 T11 已删除）及比例输入 0.01%、搜索 1% 规则保持不变，见 [兵种模型规则](docs/pvp-troop-level-rules.md)。

最新全局服务器阶段实现、完整阶段表、各模式限制与验证结果见 [全局服务器阶段交付说明](SERVER_STAGE_STATUS.md)。
配置自动保存、方案库、JSON 导入导出和版本迁移见 [配置持久化交付说明](CONFIG_PERSISTENCE_STATUS.md)。

四场景配队优化路由、单撞／333 搜索、Rally 结果与应用见 [场景优化交付说明](SCENARIO_OPTIMIZER_STATUS.md)。

上一轮历史优化验收（过滤前空间）：71 文件／843 项全量测试通过，typecheck／lint／build 通过。有效八套车头对照：正式场次 60040→41005（−31.7%），耗时 524.14→343.71 秒，最终最佳胜率 89.4%→94.2%，手动参照 86.6% 保留。3840 套车头另经 887040 次理论扫描与 23040 个真实首轮候选验证，理论／正式车头覆盖均 100%。

## 当前结论

本仓库是独立 TypeScript PVP 引擎，已录入 15 个兵种技能与 204 个英雄战斗技能，英雄目录覆盖 R/SR 与 S1～S16。最新用户规则已接入伤害、属性、技能、输入模式与 BattleTrace。**S12～S16 的 45 项远征技能和已有 12 项专武场景技能全部为 provisional / inferredFromPriorGenerations；测试通过只说明代码符合当前指定规则，不证明真实游戏战报已验证。** 此目录没有 `.git`，无法提供可靠的提交历史或未提交 diff。

## 底层模型

```text
N0 = min(双方开战实际初始总兵数)  // 全场固定
n_s = 回合开始快照中的攻击兵种存活兵数
B_s = sqrt(N0) × sqrt(n_s) × K_s × C_level,s
Damage ∝ B_s × Attack_s × Penetration_s / Defense_实际受击目标
HP_unit = C_hp × C_level × LifeFactor
```

`K_盾/矛/射=1/3/4`，`C_hp,盾/矛/射=300/100/75`。同一回合使用回合开始快照，事件在回合末依次抵消、消耗临时护盾、扣 HP、结算伤亡。普通增伤 `commonDamageIncrease` 按 scope 覆盖普攻和技能；`normalAttackDamageIncrease` 只覆盖普攻；`skillDamageIncrease` 覆盖 `skillDamage/extraDamage`。同来源、同目标、同时点、同父基础量的技能系数先汇总，再统一取整。详细公式、group 表和旧→新变化见 [规则迁移清单](PVP_RULE_MIGRATION_2026-09-26.md)。

## 输入模式

| 模式 | 属性与兵数 |
| --- | --- |
| 最终战报（默认） | 直接输入战报最终攻防穿血与实际开战兵数；不重复英雄静态、专武、城镇、宠物、专家或容量 Buff。英雄配置仅用于动态战斗技能。 |
| 预测 | 从基础面板、阵容静态差值、外部 Buff/Debuff 和容量增益构造实际入场兵数与属性；容量只影响人数、`N0`、`n_s`、总 HP。 |

## 代码结构

```text
src/pvp/scenario/         场景输入、模式与装配
src/pvp/battle/           初始状态、整场模拟
src/pvp/round/            快照、行动阶段、统一回合末结算
src/pvp/formulas/         基础伤害、单兵 HP、等级常数
src/pvp/effects/          属性、乘区、scope、状态生命周期
src/pvp/damage/           单笔 DamageEvent
src/pvp/troopSkills/      盾/矛/射兵种技能定义与触发
src/pvp/heroSkills/       R/SR、S1～S16 英雄目录与战斗技能运行时
src/pvp/casualty/         临时护盾、HP、伤亡与混级分配
src/pvp/logging/          BattleTrace
src/pvp/validationUi/    最终战报/预测输入适配与预览
src/pvp/optimizer/       集结配队搜索
src/ui/                  浏览器 UI 与 Worker
src/pvp/tests/           Vitest 回归
```

主要调用：`runPureTroopBattleScenario` → `createPureTroopBattleState` → `simulateBattle` → `resolveRound` → 回合快照 → 兵种/英雄触发 → `runActionPhase` 生成并聚合 DamageEvent → `resolveRoundEnd` 消盾、扣血、结算伤亡 → `formatBattleTrace`。默认顺序 A盾、B盾、A矛、B矛、A射、B射。

## 本次修改与验证

本次变更包括目标防御分母、生命只含生命属性、普通防御技能改入 `heroDefenseBonus`、通用/普攻专属 group 改名、相同技能伤害池、菲兰德逐主攻判定、琳恩无限层、赫克托通用衰减增伤、韦恩目标基础量、加托护盾覆盖、最终战报去重、预测容量以及逐来源 BattleTrace。详细逐项文件清单见 [迁移报告](PVP_RULE_MIGRATION_2026-09-26.md)。

2026-09-27 新口径：加托二技能护盾改为 `X=100×Ct×√当前盾兵数×(1+A_report)`，Lv5 `S=0.30X`、Lv4 `S=0.24X`；书允等英雄技能攻击加减不进入 `X`，每次盾兵主攻击后按生成值覆盖刷新。烈晶盾牌与炽红力场改归 `receivedDamageReduction`，与巴希提等同组加算后作为分母；旧直接抵消公式停止使用。BattleTrace 保留计算输入、各减伤来源及结算前后伤害。详见 [最新规则迁移](PVP_RULE_MIGRATION_2026-09-27.md)。

S8 后续确认覆盖上述加托护盾时序：盾兵在 Rn 完成主攻才触发，护盾从 R(n+1) 生效 1 回合；眩晕跳过主攻则不排队下一层。索妮娅赏金诱惑按完成矛主攻计数，当轮 `0.75B`、次轮攻击 +25%；激流冲击固定自然 R5/10/15…，当轮 `2.50B`、目标次轮跳过行动。亨德里克蝙虫之噬进入防御属性减益，藤壶之铠进入同组 `heroDefenseBonus`，大森之嗣固定自然 R3/6/9… 逐存活目标造成 `0.40B`。S8 额外伤害均使用 `parentBaseDamage` 的 kB 路径；最终战报模式不重复叠加三个 S8 专武属性。详见 [S8 最新迁移](S8_RULE_MIGRATION_2026-09-27.md)。

S9/S10 最新确认规则现已接入：马格努斯盾主攻尝试即判定 40% 当轮即时防御；弗雷德第 4/8… 次矛主攻尝试与修拉第 2/4… 次射手主攻尝试在闪避后仍各产生 `2B`/`1B` 并安排次轮效果；芙蕾雅仅在矛普攻成功命中后判定 50% 的 `1B`。弗雷德易伤仅作用敌盾，S9/S10 指定承伤降低统一进入 `receivedDamageReduction`。格里高利与韦恩共用单次普通攻击 ×2 暴击模板；布兰琪按自然 R3/6/9… 产生 `0.75B`，其双目标技能共用韦恩二技能模板。S9/S10 的 kB 统一使用 `parentBaseDamage`，六名英雄最终战报模式均不重复叠加专武属性。细节与证据界限见 [S9/S10 规则迁移](S9_S10_RULE_MIGRATION_2026-09-27.md)。

S11 最新确认规则现已接入：埃莱奥诺拉每第 5 次盾主攻尝试后预约次轮起 2 回合的全军增伤与承伤降低，普通攻击被闪避仍计数，眩晕未出手不计数；盾兵常驻承伤降低进入 `receivedDamageReduction`。劳埃德冰雾爆弹在自然 R3/6/9… 生效，当轮矛兵通用伤害 +150%，敌军全体穿透降低与常驻 20% 同组相加；机巧万变逐自然回合独立判定。鲁弗斯碎甲一击仅射手普攻命中时生成 `0.6B` 技能额外伤害及本次目标次轮易伤；暴烈震爆逐兵种主攻尝试判定，同目标减穿覆盖刷新、不同目标分别维护。S11 三英雄最终战报模式继续防止静态属性和专武重复计算。详见 [S11 规则迁移](S11_RULE_MIGRATION_2026-09-27.md)。

S12～S16 已按最新待验证口径实现 15 名英雄共 45 项远征技能。15 项指定技能复用已有定义/运行模板，保留各自的主攻尝试、命中、闪避、眩晕、周期和目标语义。丽姬娅同次命中两笔 `1B` 同目标池化为 `2B`；卡拉、维薇卡、艾诗琳的不同目标分别结算。S12～S16 的额外伤害均按 `parentBaseDamage` 进入 kB 技能伤害路径；普通承伤降低及属性降低使用公共组。S16 尚无可录入的专武技能资料，不推造专武。详见 [S12～S16 规则迁移](S12_S16_RULE_MIGRATION_2026-09-27.md)。

| 检查 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run lint` | 通过 |
| `npm.cmd test -- --testTimeout 20000` | 39 个文件，580 个测试通过 |
| `npm.cmd run build` | TypeScript 引擎与 Vite UI 构建通过 |
| `npm.cmd run validate:skills` | 奇袭、炎晶战矛、连射、不朽之壁验收通过 |

[battle_test_log.txt](battle_test_log.txt) 是固定种子 20260926 的**完整合成运行日志**，包含回合、技能、伤害乘区、目标防御、逐来源承伤降低、取整、护盾和伤亡。不是游戏实测战报；运行脚本为 `scripts/generate-handoff-battle-trace.ts`。本次重新生成后模拟在第 10 回合因一方兵种归零结束。[gatot_rule_trace.txt](gatot_rule_trace.txt) 是固定种子 20260927 的加托护盾专项合成日志，含完整 `X` 输入、首轮时序及承伤降低来源，脚本为 `scripts/generate-gatot-rule-trace.ts`。完整逐级英雄技能与 S8 专题见 [hero_skill_inventory.md](hero_skill_inventory.md)。

[s8_rule_trace.txt](s8_rule_trace.txt) 是固定种子的 S8 三英雄合成运行日志，展示加托 Rn 触发/R(n+1) 生效、索妮娅赏金攻击 Buff 延后、激流自然回合、亨德里克防御组和 R10 的 `0.75B+2.50B` 池化；运行脚本为 `scripts/generate-s8-rule-trace.ts`。

[s9_s10_rule_trace.txt](s9_s10_rule_trace.txt) 是 S9 与 S10 六英雄的两场完整合成 BattleTrace，记录指定回合闪避、主攻尝试计数、命中资格、kB 事件、目标防御及伤亡；脚本为 `scripts/generate-s9-s10-rule-trace.ts`。它是代码回归记录，不是实际游戏战报。

[s11_rule_trace.txt](s11_rule_trace.txt) 是 S11 三英雄的 7 回合完整合成 BattleTrace，记录盾兵第 5 次主攻被闪避仍计数、R6/R7 Buff、劳埃德周期技能、鲁弗斯碎甲一击的命中资格与暴烈震爆的逐目标刷新；脚本为 `scripts/generate-s11-rule-trace.ts`。指定技能判定与闪避由脚本注入，该日志不是实际游戏战报。

[s12_s16_rule_trace.txt](s12_s16_rule_trace.txt) 包含 S12 丽姬娅、S13 乌尔卡努斯、S14 艾丽芙、S16 艾诗琳的四场独立合成 BattleTrace，显示 `TENTATIVE`/`inferredFromPriorGenerations`、模板来源、丽姬娅同目标 `1B+1B=2B`、艾诗琳 R3 的三个独立 `0.4B`、一次性令牌消耗及次轮护盾容量；脚本为 `scripts/generate-s12-s16-rule-trace.ts`。日志不是实际游戏战报。

## 待解决问题（优先级）

场景和战报输入已实现单撞/333 的 UI、非集结车身隔离、三队列单次与批量对战及战后分类；分阶段状态见 [场景 UI 第一轮交付](SCENARIO_UI_PHASE1_STATUS.md)，三队列流程和验收见 [三队列与战后伤亡交付](THREE_QUEUE_AND_CASUALTY_STATUS.md)及 [三队列批量模拟交付](THREE_QUEUE_MONTE_CARLO_STATUS.md)。

1. **高**：真实战报逐事件拟合攻穿防、属性来源、同组乘区及取整。
2. **高**：S8 新时序、kB 事件及承伤降低同组规则已有用户确认和代码回归；仍需原始 Sheet2/Sheet3、257 回合战报与更多逐事件战报复核数值、命中栈和取整。
3. **高**：T12 与 T12-FC1～FC5 等级常数缺失，必须保留 `RULE_UNKNOWN`。
4. **中**：S12～S16 暂无法取得对应代数的 PVP 战报，所有技能的触发、数值、目标和结算顺序必须待开放后逐项复核。S16 专武技能资料仍缺。
5. **中**：菲兰德、琳恩、赫克托、韦恩、S8～S11 周期、闪避与首轮时序需战报复核；尤其韦恩暴击旧实现现按本次 S10 共用模板改成普通攻击 ×2，仍缺原始逐事件战报。
6. **中**：部分英雄缺少各技能等级原始数值；混级伤亡、专武场景和预测外部 Buff 需进一步拟合。

`docs/pvp-skill-inventory.json` 和配套 Markdown 是较早的库存快照，其中部分旧 group 与证据用语已不适用于新规则；分析当前实现应以生成的全量英雄报告、源码和本次迁移文档为准。
