# 全局服务器阶段交付说明

## 阶段数据表

页面默认选中 S11；该默认值对应当前玩家进度。阶段表按解锁顺序排列，兵种上限是可选最高等级，低于上限的已开放等级仍可手动选用。

| 阶段 ID | 页面名称 | 英雄最高代数 | 兵种最高等级 |
| --- | --- | ---: | --- |
| `s1_t10` | 一代 T10 | S1 | T10 |
| `s2_t10` | 二代 T10 | S2 | T10 |
| `s2_fc3` | 二代 火3 | S2 | T10-FC3 |
| `s3_fc3` | 三代 火3 | S3 | T10-FC3 |
| `s3_fc5` | 三代 火5 | S3 | T10-FC5 |
| `s4_fc5` | 四代 火5 | S4 | T10-FC5 |
| `s4_t11` | 四代 T11-FC5 | S4 | T11-FC5 |
| `s5_t11` | 五代 T11-FC5 | S5 | T11-FC5 |
| `s5_fc8` | 五代 火8 | S5 | T11-FC8 |
| `s6_fc8` | 六代 火8 | S6 | T11-FC8 |
| `s7_fc8` | 七代 火8 | S7 | T11-FC8 |
| `s7_fc10` | 七代 火10 | S7 | T11-FC10 |
| `s8_fc10` | 八代 火10 | S8 | T11-FC10 |
| `s9_fc10` | 九代 火10 | S9 | T11-FC10 |
| `s10_t12` | 十代 T12 | S10 | T12-FC10 |
| `s11` | 十一代 | S11 | T12-FC10 |
| `s12` | 十二代 | S12 | T12-FC10 |
| `s13` | 十三代 | S13 | T12-FC10 |
| `s14` | 十四代 | S14 | T12-FC10 |
| `s15` | 十五代 | S15 | T12-FC10 |
| `s16` | 十六代 | S16 | T12-FC10 |

## 统一可用性规则

- 阶段定义与 `isHeroAvailableAtStage`、`getAvailableHeroes`、`isTroopLevelAvailableAtStage`、`getAvailableTroopLevels`、`clampTroopLevelToStage` 位于 `src/pvp/progression/serverStage.ts`。英雄按目录代数过滤；未标注代数的 R/SR 英雄按一代处理。
- 兵种限制读取各阶段的显式等级枚举，不按连续等级推导。例如四代 T11-FC5 阶段允许 T11-FC3/4/5 和 T10-FC5，不允许基础 T11 或 T10-FC6；T12 阶段允许 T12-FC7/8/9/10。不存在的基础 T11、T11-FC1/2、基础 T12、T12-FC1～6 始终拒绝。完整表见 [兵种模型规则](docs/pvp-troop-level-rules.md)。此规则不绑定 T12 兵种技能等级、专武等级或其他技能等级。
- 页面最上方的全局战斗设置先选阶段，随后显示英雄与兵种上限。单撞、333、三队列和集结共用同一阶段。英雄选择器过滤车头、三队列各车头、战报英雄及集结车身一技能来源；兵种选择器过滤单等级、混等级和各模式的最高等级。
- 333 复用 `highestTroopLevels { shield, lancer, marksman }`。三队列可为每队分别选择盾、矛、射等级；旧配置仍以侧级 `highestTroopLevels` 作为迁移或缺省值。所有等级均受全局阶段约束。
- `src/pvp/validationUi/stageConfig.ts` 在适配场景进入战斗引擎前校验双方配置，包括兵种等级、混级组成、车头、战报英雄、三队列车头、车身技能来源和专武映射。旧版未携带 `serverStage` 的程序输入按 S16 解释，以保持已有调用兼容；新页面默认 S11。
- 降低阶段时，`sanitizeConfigForStage` 清除超代英雄及对应车身技能、专武记录，把越界兵种等级降到新阶段上限，并合并降级后重复的混级项以保留兵数。页面在发生清理时提示用户。
- 配队优化器的候选英雄和车身来源直接读取全局阶段；原独立 `maxGeneration` 控件与约束已删除。固定车身技能若越界会被拒绝。当前优化器搜索的是阵容和兵种比例，兵种等级沿用经阶段校验的输入配置，比例搜索步长仍为 1%。

## 集结车身技能边界

集结车身槽现在逐个展示阶段内可用的“英雄 · 一技能 Lv5 · 效果”，不显示专武等级、专武场景技能或英雄属性。单撞、333 与三队列不显示车身槽。

`src/pvp/validationUi/bodySkillConfig.ts` 把每个选择收敛成 `BodySkillConfig { heroId, skillId, expeditionSkillSlot: 1, skillLevel: 5 }`，按技能 ID 精确绑定来源英雄，并拒绝英雄重复占槽。`src/pvp/validationUi/adapter.ts` 只把该一技能映射为战斗阵容的车身条目；即使旧配置额外携带 `bodyHero`、专武等级、二三技能或静态属性，这些字段也不进入引擎场景。

阵容装载层对 `member` 强制使用专武 Lv0 且不装载专武技能；预测模式的阵容属性修正只统计车头英雄，不统计车身英雄。`src/pvp/tests/rallyBodySkill.test.ts` 验证同一车身英雄专武 Lv0/Lv10 生成相同输入和状态，只有一技能进入日志，非集结模式没有车身技能。

## 验证

`src/pvp/tests/serverStage.test.ts` 覆盖阶段映射、历史等级解锁、英雄和车身来源过滤、333/三队列独立等级、越界注入、S15 降到 S5 后的配置清理、混级兵数保留、无须清理时的状态及优化器候选上限。

2026-09-27：`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build` 均通过；`npm.cmd test -- --run` 为 43 个测试文件、604 项测试通过。本次没有修改 BattleEngine、DamageEngine、伤害或 HP 公式及技能概率逻辑。
