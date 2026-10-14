# 地心模式与冰火战歌模式交付说明

最新属性字段、OCR入口和三队优化搜索已由 [属性与搜索交付](pvp-inner-earth-ui-search.md) 覆盖；本页其余内容保留初版场景规则记录。

日期：2026-10-08。本轮扩展场景配置、界面和优化路由，沿用正式 PVP 战斗规则。

## 场景入口

```text
battleSceneOptions = [SINGLE, THREE_THREE_THREE, ICE_FIRE_LEAGUE, RALLY, INNER_EARTH]
对应：单撞模式、333模式、冰火战歌模式、集结模式、地心模式
```

主界面没有通用“三队列模式”入口，也没有随机调度选择器。旧 `THREE_QUEUE` 枚举保留用于内部兼容和旧配置迁移。

## 冰火战歌

- `scheduler = IceFireLeagueScheduler`；`randomSchedulerUsed = false`。
- 双方游标从第1队开始，各场结束后分别移到本场使用队伍的下一位置，循环并跳过淘汰队。
- 败队淘汰，胜队继承实际剩余盾/矛/射；下一场重新装配既有技能状态。最多5场。
- 队伍位置保留在优化候选身份中，优化器使用固定位置调度。
- 五场回归结构：`A1-B1 → A2-B2 → A3-B3 → A1-B2 → A1-B3`。
- Audit 包含 `matchSequence`、`cursorHistoryA`、`cursorHistoryB`。游标记录使用代码中的0起始下标，战斗序列使用界面中的1起始队号。

## 六种地心玩法

| 玩法 / innerEarthMode | inputMode | heroSearchEnabled | ratioSearchEnabled | troopTier | enemyCapacityRule | petRule |
| --- | --- | --- | --- | --- | --- | --- |
| 大地之心 / HEART_OF_EARTH | prediction，锁定 | true | true | 我方现有合法兵级；敌方T10 | 用户填写，每队同容量 | 我方非容量战斗技能，独立优化上下文；敌方无宠物 |
| 英雄之地 / HERO_LAND | prediction，锁定 | true | true | 双方T10 | 用户填写，每队同容量 | 双方无宠物 |
| 群兽洞窟 / BEAST_CAVE | finalReport，锁定 | false | true | 双方T10 | 用户填写 | 无宠物 |
| 宝石矿洞 / GEM_MINE | finalReport，锁定 | false | true | 双方T10 | 固定150000，隐藏容量输入 | 无宠物 |
| 地下研究所 / UNDERGROUND_LAB | finalReport，锁定 | false | true | 我方T10 / T11无火晶 / T12无火晶；敌方T10 | 用户填写 | 无宠物 |
| 装备锻炉 / EQUIPMENT_FORGE | finalReport，锁定 | false | true | 双方T10 | 固定150000，隐藏容量输入 | 无宠物 |

大地之心与英雄之地使用既有 `RandomAliveQueueScheduler` 三队闯关规则，与冰火战歌入口分离。英雄之地我方**每队容量固定190410**，只录入比例。

六种玩法均不使用 Rally Body、专家、大药或宠物出征容量。无英雄四种玩法隐藏英雄、专武、英雄池和英雄优化设置；固定T10的玩法隐藏兵级选择。

## 敌方共享配置及精确比例

所有地心敌方仅有两个预设，配置校验和界面共同限制：

```text
BALANCED:     盾:矛:射 = 1:1:1
SHIELD_HEAVY: 盾:矛:射 = 8:4:3
```

兵数按整数权重分配，再按最大余数补齐容量。不会以33.34/33.33/33.33或53.33/26.67/20的显示近似值计算正式兵数。

例如150000兵：均分为50000/50000/50000，另一预设为80000/40000/30000。

`fixed150kModes = [GEM_MINE, EQUIPMENT_FORGE]`。

## 独立输入结构

```ts
innerEarth: {
  subMode,
  ally: {
    shared: { capacity },
    queues: [
      { heroes, reportHeroes, ratio, expectedReportStats, skillLevels, weaponLevels, reportWeaponLevels },
      // 第2、3队：各自独立的英雄、比例、12项属性
    ],
    counts, reportStats, troopTiers, t12SkillLevels,
  },
  enemy: {
    shared: { capacity, troopRatioPreset, expectedReportStats },
    queues: [{ heroes }, { heroes }, { heroes }],
  },
  petContext, // 仅大地之心
}
```

我方三队属性独立；容量保存在一处。敌方三队共享属性、兵数和容量，队列只保存英雄身份。无英雄玩法使用我方 `counts/reportStats`，不重复显示三队表单。

`normalizeInnerEarthInput` 用于显式模式切换，绑定固定字段；`assertInnerEarthInput` 在导入、保存、战斗和优化边界拒绝非法模式、容量、预设、属性和技能等级。编辑比例时保留临时不等于100%的草稿，提交时校验各队内部合计。

## 宠物与阵容属性

大地之心宠物表单位于优化区域，使用项目已有七种非容量技能等级表。输入属性保持为 `baseStats`，宠物保存在 `petContext`，实际比较由独立配置副本生成有效战斗模型。

`materializeInnerEarthInput` 统一服务于正式模拟、Criterion和Theory，避免理论评分与正式验证使用不同宠物或敌方兵数。手动选择英雄同步当前报告阵容基准；优化更换英雄保留报告基准，再计算阵容差值。

推荐应用只修改我方英雄、比例和关联专武配置，或无英雄模式的兵数；保存的基础属性、敌方配置、宠物上下文保持不变。结果绑定输入版本；输入改变后过期结果不可应用。

## 地下研究所

| 专用兵级 | troopConstant | 火晶技能 | T12技能 |
| --- | --- | --- | --- |
| T10 | 7.4947 | 无 | 无 |
| LAB_T11，T11无火晶 | 8.8437 | 无 | 无 |
| LAB_T12，T12无火晶 | 10.4356 | 无 | 0～3级 |

这些常数通过场景适配中的既有自定义常数接口进入原伤害、生命计算。普通兵种枚举不新增虚构T11/T12等级。T12复用已有已确认技能定义，过滤火晶技能；高于3级或非T12兵级配置非零T12技能会被拒绝。

离开研究所进入大地之心时，专用兵级绑定回合法T10；离开地心进入普通场景时删除地心上下文，避免专用常数影响普通战斗。

## 优化路径

无英雄四模式的固定模板为 `EMPTY_HEAD`，数量是1，不是0。不进入英雄拥有、稀有度、近三代或专武候选筛选。

```text
全部231个5%比例：Criterion + DeterministicTheory
→ Top30 + 原始当前方案：正式20～50场
→ Top10 + 当前方案保护：累计300场
→ Final 3～5 + 当前方案保护：至少1000场
→ 1%局部微调，再按统一最终种子复验
```

当前方案使用原始完整输入和共同种子，作为最终排序的保护基线。搜索通过现有优化Worker执行。普通单撞固定车头仍保持上一轮全231比例正式首筛；本轮Top30限制仅在地心专用路径启用。

## 核心改动边界与验收文件

正式BattleEngine、DamageEngine、HP/伤害公式、行动/索敌/rounding/overflow和英雄技能时序未修改。原72文件检查集合中70个文件哈希未变，两个场景配置文件有必要修改：`scenarioTypes.ts`增加场景枚举；`threeQueueScenario.ts`强制冰火入口使用固定循环调度，并接入敌方精确预设兵数、场景标记与游标审计。具体核对见 `examples/inner-earth-core-boundary-audit.json`，真实场景运行见 `examples/inner-earth-modes-audit.json`。

测试覆盖六种模式字段、输入模式锁定、固定容量、两种精确预设、EMPTY_HEAD搜索、研究所常数与无火晶技能、T12上限、三队独立属性、宠物输入不变、模式切换、旧配置迁移、Worker结果应用，以及冰火战歌五场循环与剩兵继承。

完整门禁结果见 `examples/inner-earth-validation-summary.json`；测试日志见 `examples/inner-earth-test-results.log`。

最终验收：**typecheck / lint / build全部通过；104个测试文件、1147项测试全部通过**，全量测试耗时175.41秒。Vite仍有现有体积级别的chunk提示，构建退出码为0。首次全量检查暴露的旧重复英雄用例已改为合法独立阵容，保留各队属性、增益和技能等级保存检查；最终完整复跑已通过。

复现命令：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd test -- --maxWorkers=2
node scripts/run-tsx.mjs scripts/audit-inner-earth-modes.ts
```

本轮未新增或启动dev server。UI通过实际模块事件、配置保存和Worker消息回归；未进行Edge现场视觉验收。

## 旧配置迁移

配置版本升级为4。旧 `THREE_QUEUE + ICE_FIRE_LEAGUE` 迁移到冰火战歌，保留各队独立属性；旧随机三队配置迁移到地心大地之心。

旧随机配置若存在敌方队列属性差异或自由比例，按新共享规则选取第1队属性并绑定允许的预设；页面显示迁移说明，`legacySceneMigration` 保留原始A/B完整配置快照，JSON再次导出与导入也保留，便于核对和手动调整。
