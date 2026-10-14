# 历史记录：已由属性专用OCR入口覆盖

# 本地战报 OCR 与人工确认

## 运行方式

识图只在本机执行。项目使用 RapidOCR 的本地 ONNX 模型，不调用付费或云端 OCR API。当前 Windows 机器的 Python 3.14 已通过安装和中文、数字、bounding box 实测；OCR 依赖隔离在项目的 `.venv-ocr` 中，不修改系统 Python 环境。

```powershell
python -m venv .venv-ocr
.\.venv-ocr\Scripts\python.exe -m pip install -r scripts\local-ocr-requirements.txt
.\.venv-ocr\Scripts\python.exe scripts\test-local-ocr.py
npm.cmd run dev
```

如另一台机器的 Python 3.14 与依赖不兼容，可用已安装的 Python 3.11 或 3.12 创建同名项目 venv。不要更改当前项目主 Python 环境。`vite.config.ts` 在本地 dev/preview 服务提供 `/api/local-ocr`；Python 子进程只读取上传图片并返回文字、置信度、四点 bounding box。前端经 `battleReportRecognition` 解析，BattleEngine 不接触 OCR。单独部署 `dist-ui` 时需同时提供同一路径的本地 OCR 服务。

本地服务现在在首次上传时才创建常驻 Python worker，并复用同一个 RapidOCR 实例。打开页面、刷新、展开详情不会创建模型；后续图片复用已加载模型。请求按顺序处理，错误请求不会污染正式配置。服务器退出或 OCR 脚本变更时停止 worker；下一次识别再创建。首屏、OCR 耗时和固定端口说明见 [开发启动与性能检查](pvp-dev-startup.md)。

## 模块与页面识别

`scripts/local-ocr.py` 对整图分别运行原图和 2 倍放大、增强对比度与锐化后的本地 OCR；大图只增强对比度和锐化。增强通道的检测框折回原图坐标。OCR 层只返回文字、置信度和检测框，不判断游戏字段或 A/B 方。前端 `recognizeLocalReport.ts` 先取得整图结果，再通过 `troopCards.ts` 定位六张卡；缺失或低置信度的火晶/兵数会发送本张卡的相对 ROI，复用同一 Python worker 做原图、灰度、对比度三路 OCR。ROI 检测框带缩放与裁剪偏移还原到原图坐标，结果只归属对应 cardId/field。

`battleReportRecognition/layout.ts` 根据页头和文字锚点判断 `attributes`、`specialBonuses`、`troops`、`unknown`。`attributeParser.ts` 以 12 个属性名为锚点，用随文字高度变化的同行容差找到左右最近的百分数；`specialBonusParser.ts` 同样解析一行左右两个数值。`troopParser.ts` 只读取显示兵级、火晶显示值和兵数，兼容明确写出的合法等级；发现同一行六个小数等级框时，按 OCR bounding box 的横向顺序定位左右各三张卡，并以相邻框中点构成相对卡片区域。低结构置信度的兵种推断仍须确认。解析不使用固定像素裁图，T12 技能不进入 OCR 数据结构。

`specialBonusRegistry.ts` 管理官职加算、部队/宠物/守城/集结增益，以及罪人/专家/敌方减益的属性、兵种范围、作用目标和别名。匹配顺序为 canonical `exact` → `alias` → `fuzzy`，前两项名称匹配度均为 100%。“守城部队攻击力”和“城镇被攻击时守城部队攻击力”是不同 canonical 项目。无法匹配的项目保留原文、归一化文本、数值及规则候选，进入待确认表格。

官职赋予部队攻击力、防御力、穿透力、生命值四项按 exact 匹配；旧“赐予”保留为 100% alias；“敌方穿透力减益（专家技能）”按明确 alias 匹配。数值 `0%` 与 `5%` 都有效，完整且置信度足够的行自动通过单项识别确认；资料是否完整仍由用户选择三状态。

特殊加成页列出的效果已在该场战斗生效，不再按守城、集结等场景二次过滤。当前只有官职属于 `additive`；同属性且同兵种范围内的 `buff` 先相加后乘一次，`debuff` 先相加后除一次。减益内部保存正幅度，例如战报 `-20%` 存为 `0.20` 的乘区量。方向只在本份历史战报的左右列内由 `effectTarget` 决定；旧 `sourceArmy` 标签不参与方向判定。

## 三状态与独立历史上下文

| specialBonusCompleteness | 用户选择 | 行为 |
| --- | --- | --- |
| `incomplete` | 尚未提供完整特殊加成 | 默认状态；提示“特殊加成信息尚未完整，无法可靠反推属性。” |
| `complete` | 已提供完整特殊加成 | 使用本份战报左右双方经过核对的数据；未归类或低质量数值仍须确认 |
| `explicitZero` | 本场特殊加成按 0 处理 | 用户主动选择；本份上下文的 additive、buff、received debuff 全为 0；保留但不采用 OCR 特殊加成候选 |

三个值互斥，使用同组 radio。上传新资料会回到 `incomplete`，系统不自动选择 `explicitZero`。清除一方草稿也会恢复该方的 `incomplete`。

预测模式使用 `recognitionState.A/B`，每方独立保存 `selectedSourceSide`、`reportContext`（含 left/right）和 `specialBonusCompleteness`。A 读自己的历史战报左侧时，其受到的 enemy 减益只来自 **A.reportContext.right**；B 读自己的历史战报右侧时，减益只来自 **B.reportContext.left**。A 的历史对手不是当前模型 B。上传、编辑、删除和应用一方都不读取或重算另一方。预览会输出 `receivedDebuffContributions`，包括 targetModelSide、sourceRecognitionState、sourceReportSide、canonicalLabel 和 value。

重新上传属性页会替换本方历史上下文；追加特殊加成图片则只合并本方。异步识图使用本方请求版本号，清除或后续重传后，旧请求不能重新填回草稿。最终战报模式另用 `finalReportDraft`，通过显式左右映射绑定同一份双边战报，和预测模式分开。

## 重叠截图与真正冲突

同一上下文、同一历史列、同一 canonicalLabel、相同数值自动去重，不重复累计效果。每项保留 sources（图片、原文、归一化文本、bbox、matchType、label/value/structural/final confidence、顶部/底部边缘和裁切标记）。合并优先级为完整行、exact/alias/fuzzy、结构置信度、数值置信度、最终置信度。

完整高质量的 +10% 会胜过低置信、边缘裁切的 +0%，不产生 conflict。两个不同数值都来自非边缘、完整、exact/alias 且各项置信度至少 0.85 的行时，才记为真正冲突；弱 OCR 之间的异议仍需数值核对，但不记作高质量冲突。冲突详情列出各候选来源与质量，提供“采用该数值”按钮。正常重复只在高级来源中显示“已自动合并”。

## 识别与写入边界

1. 整图识别，保留每行的四点 bounding box 和置信度。利用“盾兵攻击力”“矛兵穿透”“特殊加成说明”等文字锚点、同行左右值和重复卡片关系抽取字段。
2. 只读取兵种等级、火晶显示值、数量、每方 12 项属性和特殊加成。英雄与专武由用户选择；T12 技能由正式配置中的输入框手填，识图应用保留原值。
3. 预期模式在桌面上分 A 左、B 右两栏，各方识图草稿与人工修改相互独立。主界面显示属性 12 项、兵种 3 项和特殊加成识别/待确认数量；属性详情与紧凑的特殊加成表默认折叠。用户选择图片左/右与模型 A/B 的映射，修改有误项目，再点击应用。应用后属性与兵种直接写入 A/B 正式配置。最终置信度结合 OCR、同行结构、格式和双通道一致性；低于 0.85、两通道冲突、非法等级或特殊加成冲突都不能直接应用。可靠识别的 `+0.00%` 和 `-0.00%` 是合法数值。缺少 12 项中的任一项会列出具体字段。
4. 百分数最多两位小数，兵数必须是非负安全整数，显示兵级支持 1–12 的一位小数，火晶显示值为 0–10 的整数。拆分后的兵种组必须在项目真实等级枚举中；非法或无法识别的数值仍须补充、核对。
5. 预期模式分别上传 A/B 属性页及特殊加成说明，各自选择完整性状态。使用原有反推函数：`R_raw = (100 + R_report) × (1 + D) / (1 + B) - 100 - A`，其中 `A` 是官职百分点，`B`、`D` 是本份历史战报内合并后的十进制乘区量。战报一位小数作为计算中心值，反推值显示约一位小数。应用动作一次性保存属性、兵种和特殊加成组。
6. 最终战报模式上传一张双边图片。左右可互换映射；最终属性直接输入，不再叠加专武或外部属性。最终模式隐藏专武等级。

识别草稿在点击“确认并应用”前只用于核对，不参与正式 BattleConfig 的三队列预检、模拟或自动保存。未知攻击项只阻塞 attack，已确认的 defense/penetration/life 仍可预览。三队列应用只更新选定队伍的属性、特殊加成、等级和真实混兵组；兵数换算为队内盾矛射比例，其他队伍保留原值。真实混兵比例随队列容量缩放，三队列匹配与优化器搜索变量保持原样。预检报错中的 `reportValueSource` 标明正式配置路径，`additiveContributions` 只列官职百分点；阵容差值单列。

正向公式为 `R_report = (100 + R_raw + A) × (1 + B) / (1 + D) - 100`。反推只检查 `rawFactor = reportFactor × debuffFactor / buffFactor - A / 100 > 0`；`A` 是百分点，不构造独立的乘法因子。

战报显示 `11.4 / FC10` 时默认生成 T11-FC10 60% / T12-FC10 40%；`11.0 / FC10` 为 T11-FC10 100%。人数按比例分配到真实组且合计守恒，不创建小数等级或插值常数。保存 displayedTroopLevel、displayedFireCrystalLevel、resolvedTroopComposition 与 `resolutionSource=battleReportApproximation`。整数 FC 的展示精度只产生一条非阻塞 warning，不降低兵种 3/3、不增加待确认数、不阻止应用或模拟。

正式配置可手动修改等级、FC 或混兵比例，随后标记 `resolutionSource=userOverride`（队列对应 troopResolutionSources）。普通 render 与配置保存/恢复保留修改值，只有重新上传并明确应用才能覆盖。识图导入的真实混兵组在单撞、集结和三队列适配中保留；未标记导入来源的旧集结隐藏混兵数据继续采用原有单等级归一化。

`scripts/test-local-ocr.py` 生成中文合成图片，测试两次实际 RapidOCR 和本地 HTTP 桥接；`src/pvp/tests/battleReportRecognition.test.ts` 与 `battleReportImporter.test.ts` 验证布局、缩放、裁切、左右映射、多图冲突、兵级推定、双通道分歧、反推及人工确认。

## 当前识别限制

不同战报截图可能使用不同字体、排版和词汇。漏识别、错读的小数点、特殊加成类别和作用范围仍需人工核对。系统无法证明图片外的特殊加成列表已完整，需用户明确选择状态。六卡检测依赖可识别的等级框；不能从纯图标唯一判断真实 FC 混兵，但可按已识别显示值近似还原。现有回归使用合成 OCR 框，真实截图视觉验收仍需补充。

## 上轮三状态与上下文隔离验证记录（2026-10-04）

- `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build` 均通过。构建仍提示主包超过 500 kB，此提示不属于识图逻辑错误。
- 新增上下文隔离、重叠合并与兵种近似还原回归共 22 个用例，全部通过；另外更新既有导入、数据链路与首屏 UI 测试。
- 全量测试 757 项：756 通过、1 失败。失败为既有 `rallyBodySkill.test.ts` 的四个重复车身英雄用例，因战斗状态初始化要求英雄 ID 唯一而抛错。本轮没有修改 BattleEngine 来处理此问题。
- 兵种回归覆盖真实等级拆分、人数守恒、正式 T12 手填值保留、单撞/集结/三队列配置适配、用户覆盖保存及战斗初始化；没有改动伤害或 HP 公式。
- 已复用当前 5173 开发实例，没有新增 dev server。Edge 自动化连接仍报 `nodeRepl.fetch request failed`，因此本轮未完成真实截图与页面视觉验收。

页面验收时，打开当前开发服务器地址并刷新：核对 A/B 三状态默认均为“尚未提供完整特殊加成”；分别上传不同战报，修改或清除一方后确认另一方不变；上传重叠特殊加成图，核对正常重复只计一次、真正冲突可选择候选；确认 `11.4 / FC10` 显示为两个真实兵种组，精度提示不增加待确认数；最后应用并确认正式配置的 T12 技能手填值仍保留。

## 最新五项修复与验收（2026-10-04）

1. **火晶链路**：旧六卡路径只接受 `11.0` 这类小数等级，并要求数字带 `FC/火晶` 前缀。整数 `11` 会漏掉锚点，图标旁的裸 `10` 不进入 displayedFireCrystalLevel。现在支持整数和小数锚点，在本卡火晶区域读取裸整数，接入 ROI 复识别，再生成真实等级组。可靠火晶值在预览只读展示；低置信度仍可核对，未读到时提示重传，不要求先填写空输入，也不默认成 FC0。
2. **兵数链路**：旧路径只在整图文本中取卡片区域下方第一个可解析兵数，不做逐卡复识别；跨卡聚合行只看中心点，漏检/合并/偏移后就可能缺失或归错卡。现在拒绝跨卡文本，支持标准千分位、全角逗号和分组空格；仅在同一卡片内修复紧邻数字碎片。复识别候选按路径一致性和置信度选取，可靠候选互相矛盾时保留待确认。属性与兵种卡同图时，缺失兵数也阻止应用，不能沿用旧正式配置的兵数。
3. **名称匹配**：移除 direct-rule 的固定 `.75` 回退，统一 Unicode 归一化后的 canonical exact → alias exact → 实际编辑距离相似度。另修复合并选择 exact 候选后仍继承旧 matchConfidence 的问题；获选候选同步更新 matchType、matchScore、matchConfidence。官职四项可靠 `0%/5%` 自动确认，界面分别显示名称匹配和数值置信度。
4. **顶部统计**：每个模型上下文分别显示“左侧历史战报 N项 / M待确认”“右侧历史战报 N项 / M待确认”，不再用左右合计 46项作为主要统计。A/B 历史上下文继续独立，T12 技能继续不参与 OCR。
5. **重复车身**：见 [集结优化说明](pvp-rally-optimizer.md) 的运行时身份章节。旧失败已修复，不再检查车身定义 ID 的唯一性。

以上第一、二项为代码路径和合成图可复现的原因；尚未收到本轮原始游戏截图，不能据此断言具体截图的字体描边、背景或裁切因素。

验收结果：typecheck、lint、build 通过；全量 **65 个测试文件、776 个测试全部通过**（原 757 项，加 19 项回归）。原重复车身英雄 ID 测试已通过。构建仍有主包超过 500 kB 的提示。

本机 RapidOCR 实测使用明确标记的合成图，验证六张卡兵数、六个 FC10、11.4 的真实 60%/40% 还原，以及原图/灰度/对比度 ROI 返回坐标。验证时移除相应整图字段，确保断言依赖实际 ROI OCR，而不是残留整图结果。保留 [合成图](../examples/ocr-card-regression.png) 和 [识别结果](../examples/ocr-card-regression-result.json)。

```powershell
.\.venv-ocr\Scripts\python.exe scripts\generate-ocr-card-fixture.py
node scripts/run-tsx.mjs scripts/verify-troop-card-ocr.ts http://127.0.0.1:5173/
```

脚本复用给定开发服务器，不启动额外实例。Edge 浏览器连接仍报 `nodeRepl.fetch request failed`，真实截图页面验收尚未完成；可在当前 5173 页面刷新后核对新预览与左右统计。

## 2026-10-05 历史加成与当前战斗加成

导入确认仍只更新指定方/队伍；新增保存 `sourceReportBonuses`、历史原始百分比与 raw 标记。历史特殊加成默认只用于反推，不进入新战斗；用户明确选择沿用或配置自定义 `targetBattleBonuses` 后才应用。手动历史报告与 OCR 历史报告遵守相同语义。OCR 卡片、文字匹配、完整性和待确认逻辑没有调整。详见 [上下文分离与回归结果](pvp-report-bonus-and-head-search-fix.md)，最新全量 792/792 通过。

## 最新扩展槽位与真实文字修复（2026-10-05）

- 以等级锚点和相邻卡片间距推导 `portraitBBox`（估计头像区域）和 `troopSlotBBox`（完整槽位）。不依赖固定屏幕坐标；FC 裁剪只限制在槽位与图片内，不能限制在头像内部。
- 缺失或不可靠的 FC 使用右上角裁剪和完整上部备用裁剪；缺失兵数使用本槽等级下方独立裁剪。最多 18 个 ROI，每个执行 original/gray/contrast，放大 2–4 倍并返回原图坐标。可靠多路结果冲突仍待人工确认。
- 仅在本槽兵数区域修复千分位误识别标点，如 `3|149|491`；不把整行多兵数拼接，也不把 `11.4` 当人数。
- 官职 canonical 为“官职赋予部队…”：exact、score=1；旧“赐予”为 alias、score=1。数值置信度及完整性校验继续执行，T12 技能仍手填。
- 用户转录 Ground Truth 已加入 `src/pvp/tests/fixtures/userReportTroopGroundTruth.ts`。原始游戏图片尚未提供；不能把合成版测试通过写成原图准确率。
- 已实际调用本机 RapidOCR，对包含上述六组数值的**合成图**验证等级/兵数/FC 各 6/6 及完整混兵拆分。输出仍是 `examples/ocr-card-regression-result.json`，其中 `syntheticFixture=true`。

无需开发服务器即可验证本地 Python 链路：

```powershell
.\.venv-ocr\Scripts\python.exe scripts/generate-ocr-card-fixture.py
node scripts/run-tsx.mjs scripts/verify-troop-card-ocr.ts --local
```

脚本启动临时本地 Python OCR worker，结束后关闭；不会启动 Vite。也可传当前实际开发 URL 复用已运行实例。
