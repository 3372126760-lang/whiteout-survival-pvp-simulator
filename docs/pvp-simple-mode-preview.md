# 普通模式本地 UI 预览

本阶段仅修改界面、UI 状态映射和结果展示；未部署。

## 打开与复现

- 开发服务器：`http://127.0.0.1:5173/`。首次访问默认为普通模式。
- 完整示例：`http://127.0.0.1:5173/artifacts/simple-mode/preview.html`。载入后点击“开始模拟”。
- 重新启动：`npm run dev`。
- 重新生成截图和浏览器验证：`node scripts/preview-simple-mode.mjs`。脚本使用本机已有 Playwright 和 Edge，可用 `PLAYWRIGHT_MODULE`、`BROWSER_EXECUTABLE` 指定路径；不会安装依赖。

示例双方均使用赫克托 / 米娅 / 格温，总兵力各 100,000，配比 49 / 1 / 50，输入全部十二项最终战报属性，Buff 沿用完整默认配置。模拟 1000 场得到 A 胜 477、B 胜 521、平局 2，平均 16.283 回合。

## 一份配置、两个编辑视图

唯一战斗状态仍为 `src/ui/main.ts` 中的 `input: ValidationBattleInput`，唯一批量次数仍为已有 `batchCount`。普通模式不会创建额外战斗配置。

| 普通模式字段 | 现有配置字段 / 处理路径 |
| --- | --- |
| 服务器阶段 | `input.serverStage`，沿用 `sanitizeConfigForStage`；现有模型只支持双方共用阶段，UI 明确注明 |
| 盾 / 矛 / 射英雄 | `input.sideA/sideB.leaderHeroIds[troop]`，沿用 `leader` 事件与原英雄目录 |
| 兵量 | `sideA/sideB.troops[troop].count` |
| 总兵力与配比 | 使用现有 `allocateRallyTroopsByRatio` 分配整数兵数并写回上述 `count`；总兵力不丢失 |
| 十二项属性 | `troops[troop].attack/defense/penetration/life`，仍为百分数点；1376.4 表示 1376.4% |
| 城镇 / 宠物 / 专家 | `sideA/sideB.externalBuffs`，复用原 selector、数据源与事件 |
| 英雄专武 | `simulationWeaponLevels[heroId]`，沿用原输入模式下的适用规则 |
| 车身英雄 | `bodySkills` / `selectedMemberSkillIds`，复用现有集结选择器 |
| 模拟次数 | 已有 `batchCount`；默认 1000，可选 100 / 1000 / 10000，保留高级模式自定义次数 |
| 随机模拟 | `input.simulationMode`；取消后使用保存的原 seed，不展示 seed |

独立保存的只有 UI 偏好：普通 / 高级模式、数量 / 比例输入方式、折叠状态及未完成的百分比输入草稿。比例不等于 100% 时不写入配置，禁止启动模拟和分享。切换视图只重绘，不运行初始化、清空隐藏字段或重新模拟。切换数量与比例不会对现有兵量进行舍入。

普通模式继续调用原 `runBatch` → 原 `batchWorker.ts` → 原正式批量引擎。该 Worker 本次未修改。

## 保留的语义与第一阶段边界

- 最终战报模式中，外部增益与专武静态属性已经包含在十二项属性内，普通模式明确说明并只读展示相关外部属性配置，避免重复叠加。
- 基础面板预测模式继续沿用高级模式的历史阵容、当前加成及专武规则；更多 Buff 设置复用原控制组件。
- 高级模式的混编兵、预测集结容量、333、冰火战歌及地心队伍保持原配置。复杂配兵提示到高级模式编辑，不将多队配置转换成单队。多队批量结果使用现有专属汇总，其他统计在高级模式查看。
- 英雄头像使用字形占位与兵种标记，未引入外部游戏素材。
- 目前代码中的 `supported` 只说明模型已实现，不等同于战报验证；映射为“模型已实现 / 尚未完整战报验证”。`TENTATIVE`、`RULE_UNKNOWN`、显式冲突及战报验证状态分别映射为玩家可读提示。
- 主要差异只计算已有平均伤害、剩余射手、剩余总兵与技能实际触发次数。现有批量结果缺少盾兵退出回合、技能覆盖时长、独立承伤汇总，因此不生成这些结论。
- 伤害沿用已有“结算前取整、含溢出”口径。90%模拟区间为本批次 P5–P95，未解释为均值置信区间。
- 分享链接使用现有配置 codec 校验，携带战斗设置，不携带存档名称、OCR 来源或优化器英雄库存。链接通过 hash 传递，不请求远程服务。

## 验证结果

- TypeScript 类型检查通过，前端构建通过。构建保留原大型模块的体积提示，未为此重构模型。
- 6 个相关测试文件、85 项测试通过：普通模式 11 项、原高级启动测试 36 项，另包含布局、批量模拟、服务器阶段和存储回归。
- 真实浏览器中，两种模式各运行 1000 场，完整 Worker 结果深度比较一致，切换后仍保留结果。
- 浏览器验证包含：模式切换、比例草稿、模拟按钮防重复、运行期间主线程响应、分享链接在无本地存档的新会话恢复配置、属性复制、键盘关闭抽屉、结果不显示内部技能 ID。
- 1920×1080、1440×900、1366×768 与 390×844 均无页面横向溢出；桌面 A/B 双栏，手机上下排列，结果卡片单列。
- 对修改前后 `src/pvp`、`src/storage` 的 351 个文件计算 SHA-256；唯一变化为高级 UI 测试夹具。战斗公式、技能、RNG、Battle / Theory / Monte Carlo 及模型参数文件均未修改。

截图与机器可读证据位于 `artifacts/simple-mode/`：

- `desktop-1366x768.png`、`desktop-1440x900.png`、`desktop-1920x1080.png`：桌面全页。
- `mobile-390x844.png`：手机全页。
- `desktop-1366x768-viewport.png`、`mobile-390x844-viewport.png`：首屏。
- `details-desktop.png`：详细结果抽屉；`attributes-mobile.png`：手机展开属性。
- `example-config.json`、`simulation-result.json`：完整示例配置与真实统计。
- `browser-verification.json`、`model-integrity.json`：浏览器验证与模型文件完整性报告。

## 修改文件

| 文件 | 变更 |
| --- | --- |
| `src/ui/main.ts` | 模式路由、共享事件接入、分享恢复、属性百分数显示、已有进度展示 |
| `src/ui/simpleMode.ts`（新增） | 明确字段映射、配比输入映射、十二项属性复制、可信度文案 |
| `src/ui/simpleModeView.ts`（新增） | 普通模式页面、统计卡片、主要差异、无内部 ID 的详细抽屉 |
| `src/ui/simpleMode.css`（新增） | 深色卡片样式及桌面 / 手机布局 |
| `src/ui/simpleShare.ts`（新增） | 版本化分享编码、验证恢复与来源信息排除 |
| `src/ui/simpleMode.test.ts`（新增） | 模式切换、双向回显、相同配置结果一致及映射 / 分享测试 |
| `src/pvp/tests/uiStartup.test.ts` | 原高级模式测试显式选择高级 UI 偏好；测试主体未改 |
| `scripts/preview-simple-mode.mjs`（新增） | 真实 Worker 一致性、浏览器操作验证、截图生成 |
| `index.html` | 中文标题与描述 |
| `docs/pvp-simple-mode-preview.md`（新增） | 本预览说明与改动清单 |

另更新本地前端构建产物 `dist-ui/`，生成预览证据 `artifacts/simple-mode/`；未进行生产部署。
