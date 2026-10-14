> 2026-10-09最新职责：识别属性 **与特殊加成**，只取消兵种/火晶/图标推断。请求模式为 `reportAttributesAndSpecialBonuses`（Python兼容旧 `attributes`）；仍为本地整图OCR，保留所有文字框。详见 [冰火历史转换与六排列](pvp-ice-fire-shared-conversion-permutations.md)。

> 2026-10-09 最新修正：装备锻炉我方为 PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9（9项），攻击、防御独立；只检查同兵种穿透/生命配对，三兵种穿血不共享。宝石矿洞我方仍为 PER_TROOP_PAIRED_6（6项）；两者敌方仍为 ALL_TROOPS_PAIRED_2（2项）。缺少兵种前缀时，仅完整12行属性表按相对行序映射盾/矛/射；不完整/歧义表保留人工确认。没有恢复兵级、图标、火晶或兵量识别。详见 [装备锻炉9项修正](pvp-equipment-forge-schema.md)。

# 本地属性 OCR 与人工确认（2026-10-08）

当前识图入口只读取攻击、防御、穿透、生命数值。兵种卡片、图标、等级、火晶、数量及特殊加成不再由新 OCR 自动识别。它们来自玩法规则或手动配置。

## 本地运行

项目使用 `.venv-ocr` 中的 RapidOCR / ONNX；不调用云端或付费 API，不改系统 Python。沿用当前已安装的项目环境：

```powershell
.\.venv-ocr\Scripts\python.exe scripts\test-local-ocr.py
npm.cmd run dev
```

使用现有单实例启动脚本，不重复启动 Vite。本地 `/api/local-ocr` 仅在上传后启动常驻 Python worker，后续图片复用引擎；打开网页不加载 OCR 模型。单独部署静态 UI 时仍需要本机 OCR 服务。

## 属性流程

```text
整图（原图 + 增强）→ 文字/置信度/bounding box
→ 属性文字锚点与同行/左右关系
→ 当前玩法 Schema 的1/2/4/12项校对
→ 显式应用到目标侧或队伍
```

保留完整 OCR 检测框；不以固定绝对坐标识别字段。不再发出 troopCards 请求或推断单位等级。中文兵种名称只作为12项属性名称的一部分，如“矛兵攻击力”；不会由图标推断兵种配置。

通用锚点支持攻击、防御、穿透、生命、全属性，重复属性按模式归并。`468.O%` 等数字容错保留。真正不同的共享数值不自动取平均，低置信度、缺失及双通道异议均需人工核对，可手动补齐到0.01%精度。

预览与正式配置隔离。点击确认前不更新战斗输入；确认后只提交属性，保留手选等级、数量、英雄和宠物。地心敌方共享属性一次应用到三个敌队。

OCR复制数值，不再识别特殊加成或自动假定历史反推完成。历史最终战报需要在已有历史属性配置中手动提供对应加成；不混用旧战报来源。旧解析器保留作历史配置/数据回归，不在应用新OCR入口调用。

完整字段数量、测试、运行日志和核心边界见 [本轮交付](pvp-inner-earth-ui-search.md)。以前的兵种卡片识别过程存档于 [历史文档](pvp-local-report-ocr-history.md)。
