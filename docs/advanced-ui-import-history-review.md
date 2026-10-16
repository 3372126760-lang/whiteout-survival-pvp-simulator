# 高级模式：兵种卡、配置导入与历史加成本地验收

2026-10-15，v0.2.0-beta，仅本地修改。无 push、tag、deploy。

1. 原拥挤来自外层三兵种卡与内层通用 troop-fields 双列/宽屏四列叠加；一张小卡又将比例、等级并排。
2. 现在每个比例/数量/兵阶控件整行排列；卡内纵向。侧栏容器足够宽时三列，小于 540px 两列，小于 370px 一列；手机 600px 以下始终一列。图标与名称后只保留“兵阶 · 兵数”摘要。生产 Edge 在 1440、1024、768、390px 检查，390px 无页面横向溢出，T12-FC10 完整可辨。
3. 顶部第一行：保存阵容 / 导入配置 / 分享阵容 / 配队优化；第二行：A→B 复制 / 交换 A/B。手机“阵容操作”含这六项。
4. “导入阵容配置”弹窗支持分享链接、分享 payload、配置 JSON、已有 .json 文件；先解析预览再载入。包含裸 canonical BattleConfig JSON 和已有持久化 envelope。
5. 分享继续调用 decodeSimpleShare；JSON/文件继续经 createPersistedEnvelope、parsePersistedJson、restorePersistedConfig，统一用 applyRestoredSetup 回显，无第二套 Advanced 配置。场景、stage、Head/Weapon/Body/Tiers/Ratio/属性/Buff/T12 等保留。
6. 原历史加成直接复用了当前可分兵种的 ValidationReportBonusMatrix，所以误渲染成 3×4 行。recognizedSpecialBonuses 本身是带属性/scope 的 OCR 原始证据数组，并非造成 12 行的字段；它继续作为识别元数据保存。
7. 现在 canonical 的 sourceReportBonuses 为 attack / defense / penetration / life 四属性，每项 additive / buff / debuff 百分点。保留项目现有 additive 名称（官职加算），不新造另一套字段。旧矩阵类型仅用于兼容旧输入；新保存不再输出 importedReportModifiers 旧别名。
8. sourceReportBonuses() 在反推边界将四属性展开到三个兵种的十二个独立战报项。历史 attack Buff +30% 分别用于盾/矛/射攻击，三个最终报告属性和裸属性仍独立；rawReportSide 继续复用原 deriveRawReportAttribute 公式。当前特殊加成由独立 targetBonusMode / targetBattleBonuses / externalBuffs 决定；历史不会自动进入当前战斗或另一方。
9. JSON、分享、保存、OCR/报告导入共用 normalizeHistoricalTree：旧三兵种同属性值一致时直接合并。冲突时分别保留原反推的裸属性，记录 sourceReportAttributes、historicalBonusMigration（冲突值与 preserveRawAttributes 策略）；四属性表冲突项置零，不任意选一个兵种。若旧配置明确选择沿用历史，则显式转成独立当前自定义矩阵。Developer 展示冲突说明/明细。新数据和再次保存均输出四属性结构。未更改三兵种各自战报属性结构。
10. 修改文件：src/ui/advancedMode.css、advancedModeView.ts、main.ts、appDialog.ts；新增 configImport.ts、historicalBonusView.ts；src/pvp/validationUi/types.ts、reportBonusContexts.ts、queueReportLineage.ts，新增 historicalBonuses.ts；battleReportRecognition/attributeImport.ts、mapping.ts；innerEarth/types.ts；src/storage/configCodec.ts、configMigration.ts；相关新增/迁移断言测试与本报告。此前优化器修改独立记录于 pvp-joint-pipeline-review.md。
11. 新增 26 项导入/迁移专项测试；浏览器验证分享/JSON/文件三入口、4 行历史表、T12-FC10、纵排、390px 无溢出、导入后完整回显；生产 Worker Final1000 与串行结果相同，推荐应用仍为四独立 Body runtime。截图与浏览器检查在本地 artifacts/advanced-ui-review/（按 .gitignore 不提交）。完整测试 1502/1502 通过，typecheck、lint、build 均通过。
12. 正式 BattleEngine、伤害/技能公式、技能时序与 RNG 未修改。124 个受保护引擎文件 hash 不变；已有固定输入的 1000 场批量输出逐项不变。历史输入数据结构与反推边界按本次要求修正。

本地预览运行 `npm run dev`，打开高级模式。Developer 可用 `?mode=advanced&dev=1` 查看旧格式冲突及优化器诊断。
