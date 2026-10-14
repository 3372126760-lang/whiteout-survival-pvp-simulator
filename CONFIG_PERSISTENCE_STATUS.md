# 配置持久化交付说明

## 范围和存储格式

页面通过 `src/storage/` 的 `LocalStorageConfigStorage` 访问浏览器 `localStorage`，战斗核心不访问浏览器存储或文件 API。当前 `schemaVersion = 2`，自动存档使用 `wos-pvp.autosave`，方案库使用 `wos-pvp.profiles`。没有使用 IndexedDB。

自动存档和 JSON 导出共用 `PersistedConfigEnvelope { schemaVersion, savedAt, data }`。`data` 保存当前战斗输入、批量模拟场次和优化器界面参数（包括种子），不保存 BattleState、HP、Buff、RNG 内部状态、Worker、BattleTrace 或模拟结果。三队列比例使用整数 `ratiosBp`；例如 33.33% / 33.33% / 33.34% 写作 3333 / 3333 / 3334。

单撞／333 搜索选项作为可选字段 `simpleOptimizerOptions` 保存，三队列搜索选项作为可选字段 `threeQueueOptimizerOptions` 保存；旧存档缺失时使用默认值。搜索结果、Beam 状态、候选缓存和排名不持久化。每个三队列队伍各自保存四项战报属性（攻、防、穿、血，按盾／矛／射分别输入）、三个兵种等级、英雄与整数基点比例。

页面配置修改后延迟 400 ms 保存，页面顶部显示“保存中”“已自动保存”或失败状态。`localStorage` 不可用、数据损坏或空间不足时，页面继续可用于模拟。启动时优先恢复有效自动存档，否则使用默认配置；“恢复默认配置”清除自动存档并保留命名方案。

## 恢复边界

所有自动存档、命名方案与导入 JSON 共用 `migratePersistedConfig → 结构与数据校验 → sanitizeConfigForStage → 场景预检 → UI`。未知英雄、未知兵种等级、非法场景、非法车身技能、错误的三队列基点总和和过新版本都会返回清晰错误。已知但超出服务器阶段的英雄、车身技能、兵种等级和优化器英雄约束在恢复时清除或下调，页面显示调整提示。旧的完整 `bodyHero` 字段不会进入战斗输入。

当前迁移链实现 `v0 → v1 → v2`：v0 的 `highestTroopLevel` 展开为盾、矛、射三个 `highestTroopLevels`；旧 `bodyHero`/`bodyHeroes` 仅提取精确英雄的一技能及技能等级，丢弃静态属性、专武和二三技能；旧三队列浮点百分比转换成整数基点。v1 的三队列配置把侧级战报属性和兵种等级分别复制到三个队伍；载入旧三队列自动存档或方案时提示玩家按实际战报调整。未来版本可继续向迁移表添加逐版本转换。

## 方案库与导入导出

命名方案采用稳定 UUID，与显示名称分离，保存创建及更新时间和版本化配置。页面可保存、加载、重命名、复制、删除和导出方案；删除方案不影响当前自动存档。导入文件先完成迁移、校验与阶段清理，展示服务器阶段、场景、双方车头和调整提示，用户确认后才覆盖当前编辑配置；载入方案也会更新自动存档。导出文件名会清理特殊字符。

## 验证

`src/storage/configStorage.test.ts` 覆盖自动保存重启恢复、三队列独立属性与优化选项、基点精度、v0/v1 迁移、旧车身字段过滤、阶段清理、方案库操作、损坏 JSON、过新 schema、非法英雄/兵种/场景/车身/比例，以及相同输入与种子的战斗结果回归。

没有修改 BattleEngine 或 DamageEngine。未来若需要大量 BattleTrace 历史记录，可单独引入 IndexedDB；本轮没有实现云端同步或历史战报数据库。
