# 冰火战歌三队战报来源残留修复

## 根因

`toValidationThreeQueueConfig` 先展开整方配置，再覆盖每队的模拟英雄。
此前每队没有显式 `reportHeroByTroop` / `reportWeaponLevels` 时，展开对象里的旧整方战报英雄仍生效。
UI 的“不配置”事件只修改 `leaderHeroIds`，没有清理战报基准和专武来源。
因此 UI 模拟英雄为空，却仍从旧 S11 战报阵容扣除静态属性。
此外，错误诊断把所有独立队列属性一律标成 `existingBattleConfig`，未区分手填值和历史导入值。

旧路径在盾攻击 240% 时，使用三名 S11 旧英雄得到：

```text
simulationHeroIds = []
reportHoldHeroIds = [eleonora, lloyd, rufus]
heroStaticDeltaPercent = -1281.02
reportFactor = 1 + 240 / 100 = 3.4
finalFactor = 3.4 - 1281.02 / 100 = -9.4102
```

## 当前来源约束

- 每队显式传递 `reportHeroByTroop`、`reportWeaponLevels`、模拟专武等级；不回退到整方历史阵容。
- 三个英雄槽均为空时，战报英雄、专武基准、模拟专武和英雄技能等级为空，静态修正为 0。
- 英雄修改或清空时，移除旧英雄及相关专武/技能来源；手填属性按当前队伍基准使用，静态英雄修正为 0。
- 手填覆盖丢弃旧历史属性快照和历史加成反推上下文。若队伍原来在历史最终战报输入模式，先反推其余未修改的属性，再切换为原始属性，保留当前战斗 Buff 设置。
- 冰火战歌的不同历史阵容只有存在明确的 `reportLineage` 且属性快照匹配时才参与修正。未标记的旧不同阵容不作为可信历史基准。
- `attributeSource` 随当前属性保存：`manualInput`、`basePanel` 或 `importedReport`。不再把所有属性泛称为 `existingBattleConfig`。
- 优化器单独捕获 `optimizerBaseline`，保持已知当前基准和固定属性；应用后仍保留该基准。手动修改英雄/属性会使其失效。全空队伍仍清空基准。
- OCR 不识别英雄身份，因此新截图应用到指定队伍时不继承旧英雄历史来源。冰火战歌导入只更新所选队伍。

新字段为配置版本 4 的可选字段，兼容已有保存文件：

```ts
attributeSource?: "manualInput" | "basePanel" | "importedReport";
reportLineage?: {
  source: "historicalReport" | "optimizerBaseline";
  attributeSnapshot: ValidationQueueAttributes;
};
```

清理覆盖：进入冰火战歌、英雄修改、属性手填、A→B 复制、交换 A/B、旧 THREE_QUEUE 迁移、方案加载、自动保存恢复/写入，以及正式预检和 Criterion 构建。加载时即便跳过战斗预检，仍执行来源清理。

每队新增折叠的“本队属性来源调试（高级）”，显示 `simulationHeroIds`、`reportHoldHeroIds`、12 项 `heroStaticDeltaPercent` 和带值、来源、路径的 `reportValueSource`。

## 验证

回归覆盖 A–F，以及属性快照失效、真实 UI 事件、优化器基准保存/恢复、Criterion 空英雄基准、OCR 指定队伍导入、Single/Rally 隔离。

可复现审计：

```powershell
node scripts/run-tsx.mjs scripts/audit-ice-fire-report-lineage.ts
```

产物：[六队来源与实际属性审计](../examples/ice-fire-report-lineage-audit.json)、[核心文件哈希核对](../examples/ice-fire-lineage-core-boundary-audit.json)、[全量测试日志](../examples/ice-fire-lineage-test-results.log)。

六队无英雄、240% 基础属性：预检与保存/恢复成功；传入现有战斗状态构建器后盾攻击因子均为 **3.4**。72 个核心战斗、公式、技能和场景文件哈希全部保持不变。未启动新的开发服务器。

验收：typecheck / lint / build 通过；全量 105 文件、1162 项测试通过。新增 15 项回归，其中 2 项直接触发页面事件和自动保存。构建保留此前已有的主包体积提示。未进行 Edge 现场浏览器验收。
