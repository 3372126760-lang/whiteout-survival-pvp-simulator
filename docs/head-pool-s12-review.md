# S12 Head 候选池修复 · 仅验收到 H0

本轮只修改英雄池的状态映射、旧数据兼容、Developer 审计和对应界面。没有 push、tag、部署，也没有运行完整 J / Criterion / Theory / Formal 优化。

## 问题定位

正常阵容选择器直接使用服务器阶段注册表，S12 的三名 SSR 已存在，没有注册表缺失或 H0 硬编码的问题。优化器另走 `serverHeroIds → ownedHeroIds → optimizationHeroIds → headHeroPoolAudit → H0`。

发现两个独立断点：

1. `ownedHeroIds` 把旧 `availableHeroIds` 列表作为拥有范围。旧列表停在 S11 时，S12 三英雄在 Owned 层被排除。手动选择器此前不更新这一范围，恢复配置也不协调当前已选英雄。界面的“可用”取已拥有且合法的 SSR 数量，因此“34 / 可用34”来自 S1–S11 的 34 名 SSR，并不是 S12 注册表只有 34 人。
2. `enabledOwnedHeroIds` 只要发现已存在的 optimizer pool，就把缺失的 SSR 条目当成 disabled。服务器升级时也未统一初始化，导致理论全部可用模式的旧 S11 pool 继续漏选新 SSR。此分支独立出现时，表现为“34 / 可用37”。

本轮没有直接读取用户正在使用的浏览器 localStorage；具体是显式 `ownedHeroIds` 还是旧 `availableHeroIds`，应由新增的实时审计确定，不能臆造用户保存内容。

## 修复规则

- 未提供拥有列表：明确标为“理论全部可用”，新解锁英雄按注册表补齐。缺失参与条目与首次初始化采用同一默认值，主线程、Worker 输入一致。
- 提供拥有列表：明确标为“我的英雄”，服务器升级不自动声称玩家拥有新英雄。“我的英雄”可逐个确认拥有，也可显式切换全部可用范围。
- 仅有旧 `availableHeroIds` 的配置：迁移为明确拥有列表，只补充当前手动阵容已选择且服务器已解锁的英雄；不补齐整个新世代。历史战报英雄和 Body 来源不作为拥有证据。
- 新的手动英雄选择会加入真实拥有范围。已有明确 `enabled:false` 和专武等级保留；取消拥有再获得也不自动重新勾选。
- 已有明确拥有列表却排除当前手动英雄时，保留玩家设置并提示“未标记拥有”，提供“确认当前阵容英雄已拥有”。已拥有但关闭参与时提示“未勾选参与”。不会静默改写明确的拥有或参与排除。
- S12 → S11 → S12 不再把暂时超阶段的英雄永久写成关闭。
- 新 benchmark 冻结工具保存实际有效的参与集合，避免新默认值被冻结工具重新写成 false。既有冻结文件不做任何修改。
- R/SR 不进入自动 Head 搜索；手动阵容与独立 Body 来源保持原有规则。

## H0 实测

新输入：`benchmarks/optimizer/head-pool-s12-all-available-input.json`。这是明确派生的全可用验收输入，不替换上一轮性能 fixture；双方战斗配置保持一致，仅重新定义拥有范围并补齐旧 S11 参与池。

| 项目 | 结果 |
| --- | ---: |
| serverStage | s12 |
| 注册表已解锁英雄（含 R/SR） | 50 |
| 可用 SSR Head / 已启用 / eligible | 37 / 37 / 37 |
| 盾 / 矛 / 射英雄数 | 13 / 12 / 12 |
| effectiveN | 12 |
| 近三代窗口 | 10 / 11 / 12 |
| 原始 Head 组合 | 1,872 |
| 不含任何近三代英雄的组合 | 810 |
| 最终合法 Head | **1,062** |
| BattleEngine calls | **0** |

三名 S12 在 Server / Owned / Optimization / Eligible 四层均存在：`hero.s12.hervor`、`hero.s12.karol`、`hero.s12.ligeia`。

若真实拥有范围最高只到 S11，则保留 34 名 SSR、n=11、窗口 9/10/11 和 876 Head；不因为服务器 S12 强行变成 n=12。若最高只到 S8，则窗口 6/7/8。S1/S2 不施加近三代组合限制。在 n=12 时，S10 加两名低代英雄仍合法，未要求必须包含 S12。

## 界面验收与复现

`?mode=advanced&dev=1` → 开发工具 → Theory / Criterion → **Head Pool Audit + H0（只检查候选池，不运行战斗）**。审计逐层输出人数、最高代数、S12 ID、每个被拒绝英雄的原因、当前手动英雄与候选池的差异及实际 H0 数量；不需要点击“开始自动配队”。

S12 没有 eligible S12 SSR 时显示：`S12 server stage but no S12 SSR is eligible for Head optimization`。

优化英雄池按世代升序，S12 三人显示在末尾，可分别勾选并独立编辑 A/B 参与状态。生产 dist-ui 浏览器检查确认 37/37、三名 S12 可见、H0=1062、单英雄取消勾选仅影响当前侧、刷新保留选择；没有创建任何 Worker。截图及浏览器检查结果保存在忽略目录 `artifacts/head-pool-review/`。

命令：

```powershell
node scripts/run-tsx.mjs scripts/audit-head-pool.ts
```

Git保留 [精简H0历史摘要](../benchmarks/optimizer/head-pool-s12-all-available-summary.json)；完整audit默认输出到被忽略的 `artifacts/benchmarks/optimizer/head-pool-s12-all-available-audit.json`。再次运行读取原有验收输入，不覆盖输入文件；同时校验旧冻结 fixture 的哈希与 876 Head。

验证结果：typecheck、lint、生产 build 均通过，输出目录 `dist-ui`。11 个相关测试文件共 **151/151** 通过，覆盖 A–I、拥有/参与/专武状态、持久化与导入及 UI 启动；没有运行完整优化 benchmark。H0 脚本另外校验 124 份正式源码的既有哈希，正式战斗引擎、英雄/兵种技能、RNG 和伤害公式未修改。生产浏览器复查五项均通过，Worker 创建数为 0。

本轮文件范围：

- 池同步：`src/pvp/optimizer/heroPools.ts`；新审计：`src/pvp/optimizer/headPoolAudit.ts`。
- 界面与旧数据：`src/ui/main.ts`、`src/storage/configCodec.ts`、`src/storage/configStorage.ts`、`src/storage/storageTypes.ts`；`src/pvp/validationUi/types.ts` 仅补充拥有范围字段注释。
- 回归：新增 `src/pvp/tests/headPoolStageSync.test.ts`，扩充 `src/pvp/tests/uiStartup.test.ts`。
- 工具：新增 `scripts/audit-head-pool.ts`，调整 `scripts/optimizer-benchmark-fixture.ts` 的冻结参与默认值；`scripts/report-joint-gen12.ts` 为旧报告保留性能用途说明。
- 验收输入与精简摘要：`head-pool-s12-all-available-{input,summary}.json`；完整audit归档到忽略目录。文档：本文与 `docs/pvp-canonical-body-gen12-review.md`。旧性能输入和原始记录没有被新结果覆盖。

## 旧性能记录的用途

`joint-rally-gen12-input.json` 的 SHA256 仍为 `7c246a65d82211be091efffd97d216cf5a7c7f0967ad8ed636a9be7f58d74da9`。该冻结输入拥有 S12 英雄，但三名 S12 的 optimizer entries 明确为 false，因此 enabled=34、n=11、Head=876。Git保留原输入和精简A/B summary；完整profiles仅归档在本机忽略目录，历史数字未改。

876 Head 的旧排名只能说明这个受限池的结果，不能用于判断“S12 不如旧英雄”，也不能称为 S12 最优阵容。454.202 秒 / Body 57313 与 408.05 秒仍仅为无完整原输入的历史性能记录。

本轮停在 H0。完整优化应在用户确认候选池和拥有范围后再运行。
