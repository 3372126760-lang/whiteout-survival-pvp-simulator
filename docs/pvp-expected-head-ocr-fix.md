> 2026-10-06：本文的“场景专武在结果后加固定百分点”已被最新确认规则覆盖。当前实现将普通外部 Buff 与专武属性 Buff 同组相加，详见 [专武外部 Buff 乘区修复](pvp-weapon-external-buff-fix.md)。本文中的旧公式和结果仅用于历史追溯。

历史记录说明（2026-10-06）：当时集结最终战报模式的候选比例没有写入实际兵数，相关合成搜索数值不作为当前比例搜索验收。已在优化器配置转换层修复，并重新对照；以 [最新理论优化器报告](pvp-theory-optimizer.md) 为准。


# 预期属性、车头全覆盖与兵种卡 OCR 修复

日期：2026-10-05。范围：属性转换、预期展示、集结搜索及本地 OCR；未修改 BattleEngine、DamageEngine、伤害/HP 公式、技能数值与触发、三队列调度、历史特殊加成反推方向或 T12 技能 OCR。

## 一、为什么会出现 2282.9%

根因是上一轮仍保留“无历史 context、未指定 target 模式”的旧分支：`targetBattleBonuses()` 返回 undefined，场景调用 `resolveReportAttributeBonus()`，把外部 Buff **当作百分点直接加**。UI 却将同一 30% 标为当前 Buff 倍率。这是实际公式和表格公式不一致。

用用户给出的列值，可以复现旧分支：

```text
旧：(100 + 2541.3 + 170.1 + 30) / 1.2 - 100 + 15
   = 2282.833333…
新：(100 + 2541.3 + 170.1 + 0) × 1.3 / 1.2 - 100
   = 2945.683333…
新（加场景专武）：2945.683333… + 15 = 2960.683333…
```

附件没有原始导出 JSON，因此不能确认导致 2282.9 而非按上述舍入列得到 2282.8 的隐藏完整精度。已确认的是旧代码路径与其计算方式，不是猜测从显示列反推另一组缓存值。

### 实际数据来源

- raw：手动历史最终报告经 `sourceReportBonuses` 反推，或 OCR 已反推后保存的 raw。OCR 仍需确认应用，不读取未应用的 recognitionPreview。
- formationDelta：报告英雄/静态专武阵容与当前英雄/静态专武阵容的独立差量，不是官职 additive。
- 当前 +30%：`targetBattleBonuses[troop][stat].buff` 加当前本方 `externalBuffs` 城镇/宠物等明确配置项；只有显式沿用模式读取 source。
- 当前 −20%：当前 target 自定义 receivedDebuff 加当前对手明确配置的 external enemyDebuffs；历史对手环境不自动进入新战斗。
- 场景专武 +15：现有专武 `attributeModifier`，由技能系统准备场景效果后读取其固定属性贡献。

具体这张截图的 +30/−20 各来源子项尚无 JSON 可核对；每行 `bonusSources.currentSelfBuffContributions/currentReceivedDebuffContributions` 输出真实 ID、标签及数值，不把来源未知的量归给专武。

## 二、唯一 canonical expected builder

`src/pvp/validationUi/expectedReportAttribute.ts` 的 `deriveExpectedReportAttribute()`：

```text
expected = (100 + raw + formationDelta + targetAdditive)
           × (1 + targetBuff) / (1 + targetDebuff) − 100
           + weaponModifier
```

- raw、formationDelta、targetAdditive、weaponModifier：百分点；targetBuff/targetDebuff：decimal rate。
- 官职 additive 是加数，不构造独立 multiplier。
- **场景专武保持当前已确认的固定百分点加算**：`weaponSemantics="postReportAdditivePoints"`，特殊乘除完成后加；不偷偷合并为 `targetBuff=45%`，也不更改专武技能规则。
- 静态专武变化归 formationDelta，发生在当前特殊加成乘除前；它与场景专武不是同一字段。
- `pureTroopScenario` 构建正式面板、UI 预期展示、三队列 preflight、optimizer 的同一 compiler 均调用该 builder。旧 forward API `deriveFinalReportAttribute` 也委托该入口；历史 inverse 数学保持原样。
- 旧 `resolveReportAttributeBonus` 仅保留公共兼容 API，当前 scenario/UI/optimizer 已不调用它。
- 未选择沿用、无明确当前外部配置时默认 own A/B/D=0。已有无历史 context 的手工外部配置与 UI 同步解释为 custom，使用新乘区，不再走旧加算分支。历史 context 本身不会激活外部配置。当前对手明确配置的减益仍作用于被攻击方；显式 reuseSource 则严格复制 source 矩阵。

### Calculation audit 与断言

每行包含用户要求的 displayed/actual raw、formationDelta、targetAdditive/Buff/Debuff、weaponModifier，以及 source/target context、formula、calculatedExpected、displayedExpected；另记录实际技能系统投影 `actualEnginePanel`。

表格保留 4 位小数用于复算；audit 的 displayed 数值与该精度一致，计算使用完整精度。开发模式从 displayed 列重新调用 builder，容差 0.1 个百分点；同时检查 canonical 与 engine panel。失败显示“预期属性表计算不一致”，并向 console 输出完整 audit，页面高级调试保留同一数据。

回归包含 2541.3/170.1/30%/20% 例子，孤立和组合乘区、source 默认不进入 target、显式沿用，以及 UI/compiler/BattleTrace 一致性。原固定专武 15 + 外部 5/10/15/20/25/30 的结果仍为 20/25/30/35/40/45（该回归 raw=0）。

## 三、Stage 1 完整车头搜索

旧实现的 `maxCandidates` 先消耗在比例网格，剩余预算只生成少量 formation，因此 3840 是理论空间，46 才是实际生成量。

新流程：

1. `generateAllHeadFormations` 枚举合法 shield × lancer × marksman；不受比例/细筛预算截断。
2. 每个头使用当前比例、34/33/33、60/10/30（去重），默认每比例 20 场真实 FastBattleEngine；Stage 1 不提前淘汰。每个阶段所有候选共享 seed set。
3. 默认保留 Top 64 个独立车头。保留车头完整搜索 5% 网格 231 比例，默认 30 场，再独立筛车身。
4. 后续 2%/1% 邻域，100/150 场；最终候选、合法 B 车头参照和当前方案使用同组独立种子完整 1000 场复验。
5. 只改变 A 的车头、车身、比例，B 保持固定。复用模板缓存、trace-free 模式与现有候选 Worker。

覆盖指标来自实际 Stage 1 战斗结果回调，而非仅从生成列表计数：

```text
legalHeadCandidateCount
evaluatedUniqueHeadCandidateCount
headCoverageRate
evaluatedHeadLineups
```

另输出 fixedBody、availableBodyCandidateCount、bodyCandidateCount。整套单英雄/双英雄车身替换解决旧“每次只换一槽、但当前已用满两种英雄，所有替换被拒”的停滞。车身后续仍按预算筛选，不声称完整穷举全维度最优。

### 实际验证

- `rallyFullHeadCoverage.test.ts`：15×16×16=**3840**，实际访问 **3840**，**100%**。正式 FastBattleEngine 调用；测试每比例 1 场、最多 1 回合，是覆盖性证明，不是胜率证明。
- `rallyHeadSearchRegression.test.ts`：合法 B 车头出现在 Stage 1；参照保留到最后，推荐不低于同种子参照；输入与 B 不变。
- `node scripts/run-tsx.mjs scripts/verify-rally-head-search.ts 1000`：合成等面板配置，当前 **3.5%**、手动 B 车头 **51.3%**、推荐 **72.0%**，8/8 车头访问，100% 覆盖。输出 `examples/rally-head-search-regression.json`。
- 用户当前实际导出配置未提供，不能报告该配置的真实推荐胜率或宣称它已从 28% 提升到某个数。

## 四、六槽 OCR 的原因与修复

旧代码没有真实 portrait detection；卡片上下界主要由等级字体高度的 5/10 倍推导，并要求整个 OCR bbox 落入 ROI。这可能漏掉头像上方的 FC 和字体较小、位置更低的兵数。因此**不能断言旧代码实际把某张截图按 portraitBBox 裁掉**。缺少原始截图/原 OCR bbox，无法证明为什么恰好只剩 A 矛 FC8，或为何恰好漏 A 盾、B 射。

已修复可确认的几何不足：

- 用等级锚点及邻卡中心间距估计 portraitBBox，另保留向上、向右、向下覆盖的 troopSlotBBox。
- FC 首选画像右上区域，另有完整上部备用区域；两个 ROI 只受本槽和图片边界约束，不 clamp 到头像。
- 兵数 ROI 独立位于本槽等级下方。六槽按中心 X 分左三/右三，各侧盾/矛/射排序；等级、FC、count 均从同槽取值。
- 缺失/低置信度字段调用本机 RapidOCR，2–4 倍放大、original/gray/contrast 三路；保留全局坐标与相互冲突时的人工确认。
- 仅本槽 count crop 接受合法千分位标点修复，不拼整行多人数组，不用小数等级或技能数作为兵数。

### 本地 OCR 验证与真实图限制

已把用户**文字转录的 Ground Truth**加入 fixture，另生成明确标记的合成图实际调用 RapidOCR。下表是合成图 OCR 与解析实测结果，**不是缺失原图的 OCR 准确率**：

| 槽位 | 显示等级 | FC | 兵数 | 自动还原 |
| --- | ---: | ---: | ---: | --- |
| A 盾 | 11.0 | 9 | 741805 | T11-FC9 100% |
| A 矛 | 10.3 | 8 | 64035 | T10-FC8 70% + T11-FC8 30% |
| A 射 | 11.4 | 9 | 886378 | T11-FC9 60% + T12-FC9 40% |
| B 盾 | 11.5 | 10 | 4659053 | T11-FC10 50% + T12-FC10 50% |
| B 矛 | 11.4 | 10 | 3616209 | T11-FC10 60% + T12-FC10 40% |
| B 射 | 11.4 | 10 | 3149491 | T11-FC10 60% + T12-FC10 40% |

合成实测：等级 6/6、count 6/6、FC 6/6，A/B 各 3/3；移除字段整图文本后仍通过真实 Python ROI OCR。输出 `examples/ocr-card-regression-result.json` 标记 `syntheticFixture=true`。

官职 canonical 已改为实际“官职赋予部队攻击力/防御力/穿透力/生命值”：normalized exact=1.0，可靠 0/5 自动确认。旧“赐予”保持 alias=1.0。专家穿透 alias 保留。历史反推案例 A 2838.2222、B 2753.4 回归通过；T12 技能仍不参与 OCR。

```powershell
.\.venv-ocr\Scripts\python.exe scripts/generate-ocr-card-fixture.py
node scripts/run-tsx.mjs scripts/verify-troop-card-ocr.ts --local
```

上述命令无需 Vite，结束关闭临时 Python worker。本轮没有新启动 dev server；未完成真实浏览器/原图验收。原始游戏截图和当前配置 JSON 是余下实际验收所需数据。

## 五、检查结果

- typecheck：通过。
- lint：通过。
- build：通过；保留现有 main 包 526.59 kB 超过 500 kB 的构建提示。
- 全量：**70 文件，807/807 测试通过**。
- 本机 RapidOCR 合成图：全部六槽通过。
- 1000 场真实引擎合成配置：推荐 72.0%，高于已知参照 51.3%。

主要代码：`validationUi/expectedReportAttribute.ts`、`reportBonusContexts.ts`、`adapter.ts`、`scenario/pureTroopScenario.ts`、`optimizer/candidateGenerator.ts`、`singleWaveSearch.ts`、`battleReportRecognition/troopCards.ts`、`troopParser.ts`、`values.ts`、`specialBonusRegistry.ts`、`ui/recognizeLocalReport.ts`、`scripts/local-ocr.py`。
