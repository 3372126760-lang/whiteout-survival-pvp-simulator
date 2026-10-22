# 格雷格律令震慑与 Developer 渲染审计

日期：2026-10-16。基于 v0.3.0-beta 的本地修改；未提交、推送、部署或移动标签。

## Developer 大型字符串

原 `renderDeveloperTools` 在折叠状态仍序列化整份 BattleResult、BattleTrace，
并映射所有回合的 RNG 日志。结果内包含战斗状态和重复引用，JSON 展开会放大体积；
折叠 HTML 不会阻止这些表达式执行，可能触发 `Invalid string length` 或 renderer OOM。

Developer 外层及 Simulation / Skill / Damage / RNG / Theory / Raw 分组现在均使用
`LazyDetails`。Raw Input / Result / Trace、回合和逐事件内容分别按需生成；关闭后移除其 DOM。
预览限制为 10 回合、每回合 20 个事件；Raw / RNG JSON 先按节点、深度、数组和字符串预算
抽取有限副本，再序列化，最多 32,000 字符；富文本事件先限制集合，再在拼接片段前检查同一字符上限。
完整 JSON 只在主动复制时生成。
无需增加 Node 或浏览器内存上限。打开面板的状态保留，重复模拟仍使用相同预览限制。

自动测试使用 1500 回合的共享对象 trace、禁止完整序列化的 `toJSON` 哨兵，
验证初始折叠、展开预览和连续 6 场均不执行完整序列化；另比较 dev 与非 dev 的实际战斗输入、
seed 和 BattleResult。旧 UI 集成测试现在显式展开要检查的设置面板，事件桩也保留同名事件的所有监听器。

## 最终技能语义

技能 ID 保留 `hero-skill.gelaige.law-deterrence`，效果 ID 保留
`hero-effect.gelaige.law-deterrence`，保证已有配置继续引用同一技能。
中文名称改为“格雷格·律令震慑”。

| 字段 | 定义 |
| --- | --- |
| 模板 | 直接展开 `RUFUS_VIOLENT_BLAST`，替换身份、槽位、等级表和来源说明 |
| trigger / timing | beforeAttack / mainAttackAttempt |
| probability | 20%，盾、矛、射的每次主攻击尝试独立判定 |
| kind / attribute / group | attributeReduction / penetration / enemyPenetrationReduction |
| recipient / scope | enemyArmy；source=army，target=currentTarget，damageType=all |
| Lv1–5 | 10% / 20% / 30% / 40% / 50% |
| 生命周期 | immediate，2 rounds，replace |
| 闪避 / 跳过 | 判定先于闪避；stun / skip 未形成主攻击尝试则不判定 |
| 刷新 / 目标切换 | 同一目标覆盖刷新；不同目标独立持有状态 |
| 公式 | P / (1 + Σ enemyPenetrationReduction)，不是 outgoing/received damage reduction |

格雷格一技能在 roundStart 自己 roll，二技能在各主攻击尝试时自己 roll。
未增加格雷格专用运行分支，未修改鲁弗斯三技能、共享 RNG、索敌、基础公式或取整。
Skill Debug 和 Head 展示读取更新后的定义；通用属性减益摘要注明“当前目标”和概率。
Body 仅使用第一远征技能，本次二技能修正不改变 canonical Body 注册表或自动 Body=10185。

## 可复现 1500 回合 fixture

输入与说明：`src/pvp/tests/fixtures/gregLaw1500.ts`。
回归：`src/pvp/tests/gregLawCorrection.test.ts`。

原战报没有完整 canonical config。本 fixture 仅固定已知兵数、兵阶、伤害系数和面板：
A=100 T10-FC7 矛；B=1 T11-FC10 盾 + 1 T10-FC7 矛；A矛防御754.8%，
B盾攻击1242.4%/穿透448.2%，B矛攻击621.5%/穿透379.3%。
其余缺失攻、穿、防明确置零；生命使用合成的 1e9 加成，保证各栈存活至 R1500。
无专武、外部 Buff 或 T12。保留盾打矛 ×1.10，隔离其他兵种技能，
使普通主攻击的定量 oracle 唯一。双方均运行普通英雄技能；B方保留原战报中的加托，
缺失的加托等级明确选择 Lv5 作为 fixture 输入，非还原截图未提供的等级。属性按最终战报输入处理。
这是机制回归输入，不是原战报全机制或原始 canonical 输入的复原。

| 指标 | 固定 seed=20261016 的引擎结果 |
| --- | ---: |
| 回合 / 二技能主攻击尝试数 | 1500 / 1500 |
| B加托二技能成功数 | 1500 |
| 一技能成功数 | 276 |
| 二技能成功数 | 294（19.6%） |
| 二技能全部目标 | B.shield |
| R1500 二技能 | 未触发 |
| 实际受影响的 B盾攻击 | 294 |
| B盾未减益 / 减益伤害 | 189 / 126 |
| B矛每次普通主攻 | 178 |
| B盾累计伤害 | 264978 |
| 相比无二技能 283500 减少 | 18522（6.5333%） |

测试逐回合根据前一回合实际 proc 验证本回合盾伤害，不用覆盖率近似替代。
盾先行动，A矛本回合施加的状态不能追溯影响已完成的盾攻击；R1500 之后没有 R1501。

原战报 311/288/1 次单独保留为历史观察：288/1500=19.2%，
二项期望300、标准差约15.49、z约−0.775。没有将 288 或 311 硬编码为本 fixture 的输出。
孤立情况下旧 outgoing /1.5 与正确 penetration /1.5 数值偶合，189→126 不能独自证明 bucket。
另设已知20%穿透减益的正式引擎测试，正确同组分母=1.70，排除错误异组分母1.80。

## 优化器与诊断

J / 特征抽取按 typed effect 读取新属性组，和已知常驻穿透减益在同一组编译。
J 保留现有有限时域覆盖率代理，与鲁弗斯一致；不是精确逐目标时序或正式胜率。
Criterion 对 currentTarget 减益保留 `target-bound debuff` omittedMechanisms，
不将它近似灌入敌方全军。Theory 保留 `target-bound debuff correlation` 与多回合概率相关性提示，
沿用同样的预闪避依赖策略；默认数学期望为 .20×.50=.10，这不是正式战斗覆盖率。
这些模块无需另写格雷格特例，相关测试验证分类、代理和诊断变化。Formal 使用完整通用运行机制。

## 完整性与 benchmark

5 份完整优化输入和 10 份精简历史/摘要保持不变；7 份完整 profile 仍只在 ignored 本机归档。
新增机制 fixture 属于测试输入，不包含生成的完整运行 profile。
`benchmarks/optimizer/formal-engine-integrity.json` 仅更新本次明确授权改动的4项：
`s3Heroes.ts`、`expeditionHeroes.ts`、`skillPresentation.ts` 和技能目录的 `README.md`。
其余120项哈希继续约束引擎、RNG、公式、兵种技能、鲁弗斯定义与运行逻辑。

## 修改文件清单

| 范围 | 文件 |
| --- | --- |
| Developer UI | `src/ui/main.ts`、`src/ui/debugPreview.ts` |
| 技能定义与展示 | `src/pvp/heroSkills/definitions/s3Heroes.ts`、`src/pvp/heroSkills/data/expeditionHeroes.ts`、`src/pvp/skillPresentation.ts` |
| 新机制测试与输入 | `src/pvp/tests/gregLawCorrection.test.ts`、`src/pvp/tests/fixtures/gregLaw1500.ts` |
| Developer 回归 | `src/pvp/tests/developerRendering.test.ts` |
| 适配现有断言与事件桩 | `src/pvp/tests/s3Heroes.test.ts`、`src/pvp/tests/uiStartup.test.ts`、`src/pvp/tests/externalBuffsAndValidationRefactor.test.ts`、`src/ui/simpleMode.test.ts` |
| 文档与审计 | `src/pvp/heroSkills/README.md`、`docs/pvp-skill-inventory.json`、`docs/pvp-skill-inventory.md`、`hero_skill_inventory.md`、本文 |
| 完整性基线 | `benchmarks/optimizer/formal-engine-integrity.json` |

共18个新增/修改文件；临时脚本、日志、浏览器截图和生成结果均位于 ignored 的 `.tmp/` / `artifacts/`，
未加入暂存区。未修改 BattleConfig、战斗运行器、公式、公共 RNG、兵种索敌或鲁弗斯定义。

## 最终验证

- `npm.cmd run typecheck`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd test`：127 files passed；1577/1577 tests passed，默认 maxWorkers=2，无 timeout 调整。
- `npm.cmd run build`：通过；生产前端输出 `dist-ui/`，引擎输出 `dist/`。
- `git diff --check`：通过。

生产浏览器：Headless Edge，通过静态服务器按 `/whiteout-survival-pvp-simulator/` 加载实际 `dist-ui`。
全新 `?mode=advanced` 和 `?dev=1` 页面均运行单场；切到固定种子后各重复5次，
摘要和29回合逐回合伤害完全一致。Developer 展开技能、Damage、RNG、Raw 和事件预览后再运行3次，
没有完整 trace 序列化或浏览器异常，页面 HTML 约176,315字符。

另用明确的长生命 UI 配置连续运行5次真实1500回合战斗，最后2次保持 Raw/RNG 预览展开。
Raw Trace 预览25,268字符，低于32,000上限，无 OOM、Invalid string length、页面错误或资源加载失败。
这是 UI 长战斗检查；定量伤害与触发次数以上述独立机制 fixture 为准。
日志、截图及完整浏览器验证数据保留在本机 `artifacts/greg-developer-review/`，不进入 Git。
