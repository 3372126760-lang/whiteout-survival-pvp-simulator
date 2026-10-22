# Advanced场景状态与属性输入整理

日期：2026-10-20。本地修改，不提交、不推送、不部署、不打tag。

## 场景覆盖的原因与新存储

原来只有一份活动`ValidationBattleInput`和一组优化参数。切换场景直接改写这份input的场景类型，
随后地心/冰火归一化继续改写其属性模式和专用配置；离开地心还会删除`innerEarth`。
因此不同场景共享/覆盖字段，没有能恢复原配置的场景快照。

新增`AdvancedScenarioStates`，按`SINGLE`、`THREE_THREE_THREE`、`RALLY`、
`ICE_FIRE_LEAGUE`、`INNER_EARTH`分别保存完整input、模拟次数和三类优化参数。
其中包含双方英雄、专武、Body、兵量、属性、Buff、T12、服务器阶段及场景专用设置。

- 当前活动场景继续保存在`wos-pvp.autosave`，沿用原有codec和分享/方案格式。
- 各场景归档保存在`localStorage["wos-pvp.advanced-scenarios"]`；每个值都是现有版本的完整配置envelope。
- 切换前保存原场景，目标有记录时恢复记录；首次进入才创建一套独立默认值。
- 内存保存深拷贝草稿，读取也深拷贝；某场景暂时无效的草稿仍能在页面内恢复。
  无效配置不伪装为已持久保存，保留现有校验并提示。
- A/B复制、交换、属性复制和导入只修改当前场景；其他场景归档不受影响。
- 恢复默认阵容也只重置当前场景，保留其服务器阶段与其他场景记录，不跳回单撞覆盖其配置。
- 正常修改沿用400ms自动保存；`beforeunload`会同步尝试保存尚未写入的有效配置，覆盖立即刷新。
- 场景归档损坏不会阻止当前活动自动存档恢复。分享和命名方案仍表示当前场景，不打包其他场景的私有配置。

## T12限制

`validationUi/inputPolicy.ts`用实际`scenarioType`判断：`RALLY`最高24，其他场景最高3。
仅旧配置缺少场景时按原`battleContext`推断。Lv0沿用原有关闭语义。

该输入规则用于UI、导入/保存及普通/多队列战斗构造边界，覆盖A/B、队列及地心专用T12字段。
非集结旧高等级归一为3；UI拒绝输入超上限等级，不提供Lv4+选项。
集结归档不在切换时降级，返回集结恢复原Lv24。
大地之心的输入限制也改为3；其他地心玩法原有禁用T12或研究所限制仍保留。

没有修改T12技能定义、系数、触发时序或任何战斗取整规则。

## 总出征与比例

单撞A方的常规单等级配兵默认显示总出征与盾/矛/射比例，B方维持原输入。
地心无英雄的单队玩法A方同样使用总出征与比例；三队玩法沿用每队共用容量和各队比例。
保留折叠的精确人数输入，混等级实验继续使用已有等级构成编辑器。

新视图通过`allocateDeployment`复用现有`allocateRallyTroopsByRatio`，没有另写三个独立round。
覆盖0/1/2/7等小总数、100001、190410以及100/0/0、0/100/0、0/0/100、33/33/34、两位小数比例。
比例有效时盾+矛+射严格等于总出征；未填满100%的比例是可见草稿，当前战斗保持上次有效配兵。

## 城镇和宠物快捷操作

`combatBuffPresets.ts`使用既有`DEFAULT_EXTERNAL_BUFF_CONFIG`结构和`TOWN_BUFF_RATES`的
`small`/`large`定义，城镇预设直接选择既有枚举，不另造百分比表。
小药/大药只设置现有六项城镇战斗增减益。

按用户最终澄清，**不实现宠物按服务器阶段解锁**。
宠物全开使用当前七项combat宠物的各自等级表，最高等级依次为：

| 项目 | 最高等级 | 来源 |
| --- | ---: | --- |
| 攻击/防御/穿透/生命 | 10 | `STANDARD_PET_LEVELS` |
| 敌方防御降低 | 10 | `PET_DEFENSE_REDUCTION_LEVELS` |
| 敌方穿透降低 | 8 | `PET_PENETRATION_REDUCTION_LEVELS` |
| 敌方生命降低 | 7 | `PET_LIFE_REDUCTION_LEVELS` |

一键关闭清空本快捷模块的城镇/宠物combat设置，专家等级保持原值。
冰火/大地之心仅展示相关宠物快捷项；所有快捷操作均不改写出征比例、出征容量增益、
集结百分比/固定容量、宠物容量等级或其他deployment字段。应用后仍能手动修改单项。
地心宠物手动下拉也使用各自合法上限，不再错误地给减穿/减血提供Lv10。

## 两条当前属性链

1. **最终战报·已含增益**：输入12项最终战报值，构造层直接送入战斗。
   既有最终战报分支已经跳过普通城镇/宠物/专家面板Buff和静态英雄/专武贡献，继续保留该保护。
   实际英雄、专武等级及runtime技能仍传入；T12也独立于12项面板。
2. **基础面板·另行配置增益**：输入基础值，经正规城镇/宠物/专家来源与已建模英雄/专武贡献构造预计最终属性。
   基础值已包含参考英雄/专武时，注明参考阵容，只计算与实际阵容的差值；完全未包含则留空。
   使用现有属性构造公式和专武外部Buff分组，没有改Combat Engine公式。

发现的实际旧链问题是：`targetBonusMode`能让已填写的正规Buff被历史元数据屏蔽，
也能将`targetBattleBonuses`手填矩阵再次合并到同一当前Buff链，产生重复输入/幽灵加成风险。
另有地心最终战报在运行时隐式反推历史条件，未能直接使用最终值。
现已取消这些分支；当前外部增益只来自正规配置，最终战报地心输入也保持原值。

预计最终属性使用原`previewExpectedReportBonuses`，在打开属性区域后显示12项计算结果，
与实际构造和优化器的Formal编译边界共用规则。

## 历史反推与旧配置兼容

历史字段仍保留为工具记录，包括`sourceReportBonuses`、`sourceReportAttributes`及迁移诊断。
普通当前属性输入不再自动调用`rawReportSide`；更改历史Buff/Debuff不会改写当前战斗属性。

显式调用链为：

`从历史战报反推基础属性` → 独立历史12项输入和历史条件 → 点击`还原并填入基础属性`
→ `rawReportSide`/`deriveRawReportAttribute` → 明确写入当前基础属性，切到基础面板模式。

历史OCR导入仍属于用户主动确认的导入行为，按所选输入模式处理；地心最终战报导入保留最终值，
历史条件保存在`reportHistory`，不在每次运行时再次反推。
既有冲突历史矩阵的迁移诊断仍保留，原始历史值可追溯，不猜测缺失数据。

删除当前特殊加成的选择器、手填矩阵和编辑分支，停止写入`targetBonusMode`及用户的`targetBattleBonuses`。
codec接受包含这些字段的旧JSON，但忽略字段内容，不再校验或使用其中的旧加成。
历史树迁移和输入策略会删除旧字段，因此自动保存、导入/导出、分享、复制、交换和优化配置复制均不传播它们。
类型仅保留带`@deprecated`的旧读取兼容声明。

内部Engine scenario的同名`targetBattleBonuses`仍是**从正规Buff计算出的只读结果**，
并非用户手填矩阵；保留这个内部数据接口以避免改动战斗公式或技能机制。
Developer计算审计可显示历史来源，但这些历史值不参与当前数值构造。

## UI说明

英雄、属性、外部Buff、专武、T12和集结设置增加一行用途说明及折叠的“查看详细说明”。
属性/Buff区域根据最终战报或基础面板显示同步提示，说明普通增益是否进入计算。
专武明确区分静态属性和runtime技能；T12说明当前场景上限与Lv0关闭；
集结设置说明场景独立恢复；历史反推提供穿透3000%、Buff20%、Debuff2%的例子。
冰火当前基础属性与参考阵容也和历史反推入口分开，编辑当前属性不剥离历史条件。

## 本轮文件范围

- 输入构造：`src/pvp/validationUi/inputPolicy.ts`、`adapter.ts`、`reportBonusContexts.ts`、
  `historicalBonuses.ts`、`queueConversion.ts`、`types.ts`。
- 地心输入：`src/pvp/innerEarth/adapter.ts`、`rules.ts`；OCR映射：`src/pvp/battleReportRecognition/mapping.ts`。
- 存储：`src/storage/configCodec.ts`、`src/ui/advancedScenarioState.ts`。
- UI：`src/ui/main.ts`、`advancedHelp.ts`、`combatBuffPresets.ts`、`troopDeploymentView.ts`、
  `innerEarthView.ts`、`iceFireView.ts`、`historicalBonusView.ts`、`sideConfigActions.ts`、`applyRecognizedReport.ts`。
- 测试：`src/ui/advancedScenarioState.test.ts`、`simpleMode.test.ts`、
  `src/pvp/tests/uiStartup.test.ts`、`reportBonusContexts.test.ts`、`battleReportRecognition.test.ts`、
  `innerEarthRules.test.ts`、`weaponExternalBuffRegression.test.ts`、`expectedReportAttribute.test.ts`、
  `iceFireSharedConversionPermutations.test.ts`、`validationUi.test.ts`。
- 审计：本文档；`benchmarks/optimizer/formal-engine-integrity.json`只更新两项地心输入文件的哈希，
  对应历史条件不再隐式反推和输入上限24→3。战斗核心、技能定义、RNG和伤害/生命/rounding文件保持本轮修改前内容。

没有修改optimizer J、Criterion、Theory评分逻辑，也没有重建或改写历史benchmark输入。

## 验证

- `npm.cmd run typecheck`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd test`：**133个文件全部passed，1659/1659个用例全部passed**，本轮最终全量耗时127.39秒。
  默认`maxWorkers=2`、全局timeout和现有测试保留；未通过skip或吞掉异常规避失败。
- `npm.cmd run build`：退出码0，产物仍为`dist-ui`；仅有既有的大chunk非阻断提示。
- 实际使用`dist-ui`与GitHub Pages子路径，在浏览器验证：
  集结Lv24/3500属性与地心Lv3/2800属性往返恢复；立即刷新仍保留当前场景；
  恢复默认仅影响当前场景；单撞和地心100001总兵数均准确分配为33000/33000/34001；
  宠物全开使用10/10/10/10/10/8/7；快捷操作保留容量和专家；历史字段编辑不改变当前属性，
  仅明确点击还原才写入；当前特殊加成UI消失。
- 桌面1440px和手机390px截图均已检查，手机无页面横向溢出；浏览器无页面异常、无资源请求失败。
- 浏览器记录、截图和临时检查脚本位于被忽略的`artifacts/advanced-state-review/`和
  `artifacts/advanced-state-browser-review.mjs`；命令日志位于被忽略的`.tmp/advanced-state-*.log`。
  它们不会进入Git。
- 未执行git add、commit、push、deploy或tag；保留本轮开始前已有的未提交工作。
