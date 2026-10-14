# 无尽冬日 PVP 战斗模拟器

**当前版本：v0.2.0-beta**

这是用于比较《无尽冬日》PVP 阵容与模拟战斗表现的非官方工具。网页提供面向普通玩家的普通模式、包含更多配置的高级模式，以及通过 `?dev=1` 打开的开发者工具。模拟结果用于研究和参考，模型仍在 Beta 阶段，已知规则边界和界面问题会继续完善。

本项目与《无尽冬日》的开发者、发行商没有官方关联，也不代表游戏官方数据或承诺实际对局结果。项目源码以 [MIT License](LICENSE) 发布。

## 本地运行

需要 Node.js 20.19+（20.x）或 22.12+，以及 npm。在项目根目录执行：

```bash
npm install
npm run dev
```

按终端显示的本地地址打开网页。普通模式是默认入口；可在页面顶部切换到高级模式，在网址后加 `?dev=1` 可打开开发者工具。

## 生产构建与部署

```bash
npm run build
```

构建后的**网站静态文件**位于 `dist-ui/`；`dist/` 是 TypeScript 引擎的构建输出，不能作为网站发布目录。生产构建使用 `/whiteout-survival-pvp-simulator/` 作为 Vite 资源基础路径；本地开发仍使用 `/`。

本站使用 GitHub Pages 发布到 <https://3372126760-lang.github.io/whiteout-survival-pvp-simulator/>。推送到 `main` 后，[GitHub Actions 工作流](.github/workflows/deploy-pages.yml)会运行 `npm ci`、`npm run build`，并将 `dist-ui/` 上传和部署到 Pages；也可在 Actions 页面手动运行。首次部署时，在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。无需额外的 SPA 404 回退：模式由查询参数控制，分享阵容保存在 `#s=...` 中，刷新仍访问仓库根页面。例如 `?mode=simple`、`?mode=advanced`、`?mode=advanced&dev=1`。

**Beta 限制：**战报图片 OCR 依赖本地开发服务的 `/api/local-ocr` 接口。GitHub Pages 公开版不提供此接口，页面会显示“战报图片识别功能暂未在公开 Beta 开放。”；本地 `npm run dev` 仍保留 OCR。手工配置、模拟及分享链接不依赖 OCR。

## 模型与开发资料

2026-10-07：正式候选筛选接入累计seed/配置缓存、M4与Final置信区间Racing、多basin的5%→2%→1%自适应精搜。完整对照中调用从38,080降至22,750次，最佳方案保留；详细阶段预算、独立验证和限制见 [正式战斗预算验收报告](docs/pvp-adaptive-battle-budget.md)。

2026-10-07：米娅同 family 的独立概率判定与唯一易伤效果、历史战报英雄入口整理、优化器阶段耗时／ETA／JSON 报告已接入。完整正式引擎 benchmark 与规则边界见 [本轮验收报告](docs/pvp-proc-family-and-optimizer-profiling.md)。

2026-10-06 最新优化搜索：新增自动英雄稀有度／近三代规则、保守支配审计、多个盆地连续 5% 爬坡和局部 1% 精搜。理论 35%/65% 权重与最终正式 BattleEngine 复验保留，核心战斗和技能规则未修改。详见 [本轮交付与验收报告](docs/pvp-basin-search-and-hero-policy.md)。


这是与相邻打熊模型隔离的 TypeScript PVP 引擎。当前支持纯兵战斗、已确认兵种技能、
远征英雄属性修正、R/SR 英雄技能，以及 S1～S15 英雄和专武远征规则。

## 已确认底层规则

- 固定 `N0 = min(双方初始总兵数)`；伤害使用回合开始快照的实时 `aliveCount`。
- 回合内只生成 pending `DamageEvent`，所有伤亡在 RoundEnd 统一结算。
- 兵种状态保存 `aliveCount/frontUnitHp/maxHpPerUnit`，残血不降低输出人数。
- 生命系数固定为盾 300、矛 100、射 75：
  `maxHp = troopConstant * troopHpCoefficient * LifeFactor`。防御只进入受击目标的伤害分母。
- `troopConstant` 使用 32 个实际等级的显式表：T1～T10、T10-FC1～10、T11-FC3～10、T12-FC7～10。基础 T11 不存在；非法等级不能回退或插值。
- 默认索敌为盾→矛→射；只有明确的矛兵奇袭使用射→盾→矛。
- `extraDamage` 是 `skillDamage` 子类型，使用技能伤害减免。
- 同 group 加算，不同 group 乘算；减防、易伤、属性减益是独立语义。
- 敌军减攻/减穿同组先加算，再令对应属性乘区除以 `1 + groupSum`。

## 英雄远征规则

- PVP 数据目录只保存远征数据，不保存任何探险属性或技能。
- 最终战报模式直接采用战报最终四属性、实际初始兵数；不重复叠加英雄静态属性、城镇、宠物、专家和专武属性。预测模式可用 `heroStatCorrection` 做阵容静态差值。
- 盾/矛/射可各配置一名车头并启用全部已确认战斗远征技能；车身必须显式选择远征技能 1；最多 4 个车身技能。
- 非战斗远征技能不会生成运行状态、`ActiveEffect`、`DamageEvent` 或战斗触发日志。
- 巴希提不稳定力场按“每回合、每个 sourceTroop、主攻击前”独立判定；触发后产生基础伤害 B×50% 的独立 skillDamage/extraDamage，连射第二段不重判。
- 预测模式的专武基础属性参与阵容差值修正；专武场景技能按 BattleContext 匹配，最终战报模式已含专武属性。
- 专武场景属性 `buffAttack/buffDefense/buffPenetration/buffLife` 与同属性的普通外部 Buff 先相加，再统一进入外部 Buff 乘区：`(100 + raw + 阵容修正 + 官职) × (1 + 普通 Buff + 专武 Buff) ÷ (1 + Debuff) − 100`；普通英雄远征技能组仍按原有乘区计算。见 [2026-10-06 专武乘区修复](docs/pvp-weapon-external-buff-fix.md)。
- S1 PVP 专武只保留远征场景效果；四项英雄本体/探索侧专武技能不进入 PVP。
- 菲兰德强化药剂按盾/矛/射攻击独立判定并生成 `skillDamage/extraDamage`。
- 阿隆索钢铁意志即时挂到本次命中的目标兵种，持续当前回合与下一回合；同一目标重复触发覆盖并重新计时，不叠幅。
- S3 罗根、米娅、格雷格及其远征专武已接入；攻击触发型 Debuff 默认只挂实际命中兵种栈。
- S4～S9 的周期、攻击计数、目标绑定与多目标 `extraDamage` 复用打熊模型已确认语义；
  PVP 额外提供中毒减伤、眩晕跳过行动和通用 `temporaryShieldHp` 层。
- 加托·列王恩赐在盾兵每次主攻击完成后触发、下一回合生成一回合临时护盾：
  `X = 100 × Ct × √当前盾兵数 × (1 + A_report)`，Lv5 容量 `0.30X`，Lv4 容量 `0.24X`。
  `A_report` 只取战报攻击层，不重复乘外部 Buff，也不计英雄技能攻击加减；新护盾在生效回合覆盖旧剩余值，先于 troop HP 承伤。
- S8 索妮娅赏金诱惑按完成的矛主攻计数：当前回合 `0.75B` 额外技能伤害、下一回合全军攻击 +25%；激流冲击按自然回合 R5/10/15… 造成 `2.50B` 并令实际目标下一回合跳过行动。
- S8 亨德里克蝙虫之噬降低敌军防御属性；藤壶之铠按 R5/6、R9/10… 加入 `heroDefenseBonus`；大森之嗣按 R3/6/9… 对每个存活敌军栈分别造成 `0.40B`。
- T12 矛/射“增加伤害”按对应兵种、回合和事件 scope 进入 `commonDamageIncrease`；真正的额外打击才生成 `skillDamage/extraDamage`。

## 目录

```text
src/pvp/
  battle/ casualty/ damage/ effects/ formulas/ logging/ round/ targeting/
  troopSkills/
  heroSkills/
    data/expeditionHeroes.ts
    data/exclusiveWeapons.ts
    definitions/s1Heroes.ts
    definitions/s2Heroes.ts
    definitions/s3Heroes.ts
    definitions/s4Heroes.ts ... definitions/s15Heroes.ts
    definitions/simpleHeroes.ts
    heroStatCorrection.ts
    loadout.ts
    resolveHeroSkills.ts
  tests/
```

## Remaining RULE_UNKNOWN

1. `futureEffectActivationTiming`
2. `targetingOverrideConflictPrecedence`
3. `reservedTriggerScheduling`
4. `complexInitiativeOrdering`

最新兵种等级、固定系数和混兵初始比例结算见 [兵种模型规则](docs/pvp-troop-level-rules.md)。

战报图片可通过本地 OCR 导入并人工确认；安装和识别边界见 [本地战报 OCR](docs/pvp-local-report-ocr.md)。
开发服务固定 5173 并复用已有实例；启动、HMR、异常兜底和性能检查见 [开发启动说明](docs/pvp-dev-startup.md)。
三队列调度的已知规则和暂定随机策略见 [三队列调度](docs/pvp-three-queue-scheduler.md)。

## TENTATIVE

1. `艾丽芙·绫绮之幕`：目前仍按减伤前 `rawDamage × 30%` 暂定；不与加托共用容量公式。

## 验证与示例

S8 最新口径见 [S8 规则迁移](S8_RULE_MIGRATION_2026-09-27.md)；加托容量与承伤降低见 [2026-09-27 规则迁移](PVP_RULE_MIGRATION_2026-09-27.md)；此前底层迁移见 [2026-09-26 历史清单](PVP_RULE_MIGRATION_2026-09-26.md)。完整数学模型与逐级英雄技能见 [交接文档](PVP_MODEL_CORE_AND_HERO_SKILLS.md)。

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run example:hero-rule-sync
```

## 当前优化器：多阶段启发式搜索

单撞、集结、三队列共用数值 Criterion 内核，最终结果由正式 BattleEngine 验证。优化英雄专武池与当前战斗配置独立；旧代与 R/SR 英雄保持合法。阶段、近似边界、实测调用数及缺失的真实对局信息见 [Criterion 联合搜索 audit](docs/pvp-criterion-optimizer-audit.md)。

```powershell
npm run benchmark:criterion
npm run benchmark:criterion-search
npm run debug:body-ablation -- --input 战斗配置.json --trials 3000
```

以上命令运行测量或诊断，不启动 Vite。
