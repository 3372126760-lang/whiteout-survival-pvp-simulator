# 芮妮重复来源与 S12 专武映射审计

日期：2026-10-17。基于 v0.3.0-beta 和本地格雷格/Developer 修正继续修改，保留旧标签，不提交或部署。

## 证据边界

单来源惊梦留痕的目标、时序、闪避/眩晕、每2次有效矛攻计数维持原确认。
本次只改变重复来源的伤害合并：首来源2B，后续每来源追加1B。
该子规则标记为 `BATTLE_REPORT_SUPPORTED / PROVISIONAL`，不宣称已由固定N0控制实验最终证明。

| 来源数m | 历史战报触发数 | 历史左方总退出 | 新延迟系数 | 1500有效矛攻的正式回归触发数 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 750 | 636 | 2B | 750 |
| 2 | 1500 | 713 | 3B | 1500 |
| 3 | 2250 | 1030 | 4B | 2250 |
| 4 | 3000 | 1349 | 5B | 3000 |
| 5 | 3750 | 1692 | 6B | 3750 |

历史m≥3场次的右方总兵数、N0以及新增攻击来源同时变化，不能直接用退出人数相减估算边际伤害。
未补造历史双方属性或据此拟合基础伤害公式。

## Formal 实现

- `src/pvp/heroSkills/definitions/s6Heroes.ts`：typed `duplicateSourceStacking` 描述首来源/追加来源规则和证据状态。
- `src/pvp/heroSkills/targetMarkStacking.ts`：Formal/J/Criterion/Theory 共用系数规则与同类来源分组。
- `src/pvp/heroSkills/resolveHeroSkills.ts`：各 runtime 仍独立走原攻击计数、判定和触发 trace。
  同侧、同技能、同触发批次、同绑定目标合并成一份 mark，`stackCount=1`。
  标记记录来源 runtime ID 及系数，首来源在下一回合生成唯一合并的 skillDamage/extraDamage。
  目标死亡不转移，普通攻击当前目标改变也不改变旧标记绑定。
- `src/pvp/types/effect.ts` / `src/pvp/heroSkills/types.ts`：添加可审计的贡献来源、合并系数、暂定状态及报告计数标记。
- `src/pvp/validationUi/skillSummary.ts`：施加标记的每来源触发仍各计1；延迟结算 trace 的
  `reportActivationCount=0`，不再第二次计入触发总数或触发目标次数。实际伤害事件数单独记录。

1500回合时，偶数攻击施加750批标记；R1500的标记要到R1501才结算，所以战斗内只有749个合并伤害事件。
每个 runtime 的触发计数仍是750，m个来源共750m；合并一个伤害事件不等于只触发一个来源。
二、三技能只按标记存在应用一次，矛兵同组150%+75%=225%，射手75%，不乘m。
对旧单来源保持2B。对新合并事件照常使用既有 `Math.round(modifiedDamage)`，没有修改取整算法。

## 优化器估值

| 模块 | 双芮妮旧值 | 新值 | 说明 |
| --- | ---: | ---: | --- |
| Formal 单批延迟伤害 | 4B | 3B | 唯一 skillDamage/extraDamage，延迟1回合 |
| J 的20回合通道 | 1.8B/主攻 | 1.35B/主攻 | 保持原有限时域：9批结算/20回合；不是长期1.5的替代公式 |
| Criterion | 旧版忽略复杂mark通道 | 1.5B/主攻 | 使用长期平均proxy，并明确提示延迟/索敌相关性近似 |
| Theory static | 旧版忽略复杂mark通道 | 1.5B/主攻 | 共享系数的静态平均proxy |
| Theory round | 旧版忽略复杂mark结算 | R3起每偶数矛攻后的下一回合3B | 保存目标与延迟payload，条件增益按存在状态应用；概率分支仍是期望近似 |

没有把原本忽略mark的Criterion/Theory声称成“旧版一直精确计算4B”。
J跨Head/Body组合也会消除重复的“首来源奖励”，例如Head芮妮+双Body合计4B，不是2B+3B=5B。
特征抽取提供 `delayedSkillCoefficient` 和 `averageDelayedSkillPerAttack`，诊断记录来源数、系数与PROVISIONAL。
自动Body合法性代码未修改，同canonical effect最多2份，S12自动Body仍为10185；手动Head+四Body可测试5来源。

## S12 专武

根因在UI选英雄时只写 `leaderHeroIds`，没有给新选英雄写入对应的 `simulationWeaponLevels`；
优化器独立的默认Lv10并不代表当前战斗也已写Lv10。

`src/ui/simulationWeaponSelection.ts` 在公开英雄选择事件中，对A/B共用同一映射：
有专武的新选英雄缺省写Lv10；已显式保存的Lv0或自定义等级保持不变。
不从 optimizerHeroPool 偷换当前战斗等级，不把历史缺失字段猜成满专武，也不改变底层遗漏值回退语义。
`src/ui/main.ts` 的A/B选择均调用该函数；导出canonical、存档和分享链接保留实际写入值。

回归对S12盾/矛/射分别验证双方Lv10、相同heroStatCorrection及非零simulationWeaponContribution、
专武runtime均启用且等级正确。在相同战斗角色下验证专武实际效果对称。
正常集结进攻/防守的专武场景限制仍不同，不为追求表面“对称”修改其场景机制。
UI事件测试另验证B方的Lv10保存与主动改回Lv0。

## Seed与典型阵容

保留参考 `seed=502926396`，A Head赫尔薇尔/劳埃德/格雷格，Body双芮妮/加托/亨德里克，比例60/39/1；
B Head赫尔薇尔/加罗尔/丽姬娅，Body双诺拉/加托/亨德里克，比例49/1/50。

最初附件未提供完整输入；用户随后提供原始canonical JSON，已原样保存到
`benchmarks/optimizer/joint-rally-60-39-1-vs-49-1-50-seed-502926396-input.json`。
文件SHA-256：`3dde023d1bb73889978721e693df6cff76566e131431e780f28ba819beace1cb`。
`.gitattributes` 对该文件固定LF，避免Windows checkout自动换行转换破坏原文件校验值。
双方均1800000兵，A为60/39/1、B为49/1/50，双方当前英雄的专武均Lv10，原始maxRounds=1500。
输入中的原始属性、Buff、兵阶、T12技能、英雄池及其他字段全部保留，没有从截图重新手填或修改原JSON。

原文件只有战斗输入，没有历史optimizer config。
本次将当前默认参数和共同Final1000种子永久保存在 `benchmarks/optimizer/renee-duplicate-source-fixture.json`，
明确标注为本次固定参数，不声称复原了历史retain、优化目标或锁定条件。

`src/pvp/tests/fixtures/reneeDecapitationChain.ts` 保存原输入路径、seed及历史optimizer参数缺失状态，另提供受控机制fixture：
C=1、合成HP=1e12、双方10000兵、给定比例、英雄Lv5/专武Lv10。
测试显式控制R20奇袭及格雷格proc，验证R20双标记→R21唯一3B、劳埃德150%+格雷格40%、
矛克射和敌方防御减益25%。这是链条机制回归，不冒称复原原seed的真实随机路径。
独立固定seed测试保证相同输入重复结果一致，增加重复来源不增加公共RNG调用。

`src/pvp/tests/reneeCanonicalFixture.test.ts` 直接读取用户原输入，验证校验值、双方专武、部署兵数、
共同种子及固定seed复跑，并回归真实R20矛奇袭→双芮妮标记→R21对右射唯一3B的随机轨迹。
已有Developer导出/导入入口保留；本次raw canonical及实验清单通过下述专用CLI复跑。

## 原始 canonical 的新旧规则对照

复跑命令：`npm.cmd run benchmark:renee-stacking`。
脚本扫描完整1062 Head × 10185 Body（10816470组合），计算目标方案的精确J峰值排名。
Formal固定用户原阵容和60/39/1比例，双方使用同一组1000个Final种子。
不进行两次完整Criterion→Theory→Formal优化推荐搜索；这里的“排名”是完整J空间排名，不是正式胜率排名。

旧规则在ignored的当前源码副本中，仅移除芮妮`duplicateSourceStacking`策略。
这使Formal恢复每来源独立2B事件及独立取整，J恢复2mB；保留格雷格已修正机制和其他所有当前代码。
脚本断言副本只有该定义文件发生精确策略移除，并确认新旧输入、引擎配置、候选空间和Final种子哈希一致。
这是隔离芮妮叠加规则的严格同输入对照，不将整个v0.3.0-beta旧实现（含旧格雷格机制）混入比较。

| 指标 | 旧规则：独立2B×2 | 新规则：合并3B |
| --- | ---: | ---: |
| 原60/39/1比例J | 3488388690543.632 | 3029477793994.3384 |
| 该Head×Body的J峰值 | 3532381722184.979 | 3091401933474.565 |
| J峰值全局排名 / 10816470 | 468246 | 934493 |
| 同Head内的Body排名 / 10185 | 1 | 78 |
| 同Body内的Head排名 / 1062 | 98 | 118 |
| Global Top10000覆盖 | 否 | 否 |
| PerHead Top1覆盖 | 是 | 否 |
| 原阵容Formal1000胜场（A） | 717 | 615 |
| 原阵容Formal胜率（A） | 71.7% | 61.5% |
| 平局 / 超回合 | 0 / 0 | 0 / 0 |
| seed502926396终局 | A胜，32回合 | A胜，36回合 |

1000个配对种子中，615场新旧均A胜，102场由A胜转为B胜，283场新旧均B胜，无由B胜转A胜。
正式胜率下降10.2个百分点，不能解释成随机抽取了两组不同种子的噪声。
新规则下，该方案不再被J双通道自动召回；项目已有的currentConfig保护复验仍保留，本轮没有扩大召回K值或改变搜索合法性。
J高低及排名不等于Formal胜率顺序，本次也不据此宣称全局J第一就是最优正式胜率方案。

真实seed的R20两份标记仍绑定右射；R21普通矛攻已打右盾，延迟伤害仍锁定右射。
新规则R21只生成一包3B skillDamage，roundedDamage=25492534379；旧规则对应两包独立2B。
此诊断仅保留前21回合轨迹，原seed终局和全部1000场统计仍使用原1500回合上限。

精简结果保存在 `benchmarks/optimizer/renee-duplicate-source-summary.json`（约6KB）；
完整逐种子profile、R20/R21事件及旧规则源码哈希放ignored的 `artifacts/benchmarks/optimizer/renee-stacking/`。
原输入、固定实验参数和精简摘要进入正式fixture体系，不提交可重建的大profile或源码副本。

## 修改文件（本轮）

除以上实现和文档外，本轮修改：
`src/pvp/heroSkills/runtime.ts`、`src/pvp/heroSkills/data/expeditionHeroes.ts`、`src/pvp/heroSkills/README.md`、
`src/pvp/optimizer/jointPipeline/coefficients.ts`、`src/pvp/optimizer/criterion/signatures.ts`、
`src/pvp/optimizer/criterion/compiler.ts`、`src/pvp/optimizer/criterion/types.ts`、
`src/pvp/optimizer/criterion/bodyPreprocess.ts`、`src/pvp/optimizer/theory/templateBuilder.ts`、
`src/pvp/optimizer/theory/expectationProgram.ts`、`src/ui/bodySkillPresentation.ts`、
`src/pvp/tests/uiStartup.test.ts`、`docs/pvp-skill-inventory.json`、`docs/pvp-skill-inventory.md`、
`hero_skill_inventory.md`、`benchmarks/optimizer/formal-engine-integrity.json`。

新增回归：`src/pvp/tests/reneeDuplicateSources.test.ts`、`src/pvp/tests/s12WeaponSymmetry.test.ts`、
`src/pvp/tests/reneeCanonicalFixture.test.ts`。
复验补充：`scripts/benchmark-renee-stacking.ts`、`scripts/renee-stacking-worker.mjs`、package.json的复跑命令，
以及上述原始输入、实验清单、精简摘要和`.gitattributes`的输入换行约定；更新seed参考fixture的输入可用状态。
完整性基线只更新本次授权的芮妮定义/运行/类型/计数/说明，并新增共用系数文件的哈希；其他条目保留。
上一轮格雷格和Developer懒加载改动保留，不回退。

没有修改伤害根号公式、HP公式、N0、取整、公共RNG、奇袭、连射、索敌、鲁弗斯或其他英雄定义。

## 验证结果

- `npm.cmd run typecheck`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd test`：补充真实canonical回归后，130个测试文件全部通过，1607/1607个用例通过；默认并发仍为2。
- `npm.cmd run build`：通过，生产页面输出到 `dist-ui/`。保留既有大于500kB的chunk提示，本轮没有扩展到拆包重构。
- 完整性回归覆盖125个受保护文件；本次授权更新之外的基础公式、公共RNG、战斗流程等哈希保持一致。
- 实际 `dist-ui/` 在 `/whiteout-survival-pvp-simulator/` 子路径通过浏览器检查：
  B方新选择有专武英雄后保存Lv10；双芮妮60回合共60次来源触发；R3 Developer诊断显示唯一3B合并伤害；
  相同输入/seed再次运行结果完全一致；Raw预览为25268字符，未超32000字符上限；无页面异常或资源请求失败。
  此处使用明确标注的合成受控输入，并非原始历史实验。
- 自动Body仍10185，同canonical effect最多2份；格雷格/鲁弗斯模板和Developer懒加载回归全部通过。
- `git diff --check` 通过；本地临时脚本、日志及浏览器检查结果留在ignored的 `.tmp/` 和 `artifacts/`。

原始canonical的J、精确J峰值排名、Formal1000胜率及真实seed轨迹复验现已完成，结果见上表。
历史optimizer config未提供，仍不声称本次排名复原了其历史搜索设置。
未执行git add、commit、push、deploy或移动标签。
