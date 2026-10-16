# 装备锻炉我方属性：9项输入、12项展开

日期：2026-10-09。本修正覆盖装备锻炉我方此前的 `PER_TROOP_PAIRED_6`；敌方与其他玩法规则不变。

## 输入与展开

装备锻炉我方使用 `PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9`。

| 兵种 | 攻击输入 | 防御输入 | 穿透/生命输入 | 展开：攻击 / 防御 / 穿透 / 生命 |
| --- | --- | --- | --- | --- |
| 盾 | shieldAttack=382.9 | shieldDefense=389.6 | shieldPenetrationLife=122 | 382.9 / 389.6 / 122 / 122 |
| 矛 | lancerAttack=284.1 | lancerDefense=290.7 | lancerPenetrationLife=122 | 284.1 / 290.7 / 122 / 122 |
| 射 | marksmanAttack=755.8 | marksmanDefense=762.5 | marksmanPenetrationLife=122 | 755.8 / 762.5 / 122 / 122 |

数据来源：用户提供的真实战报数值。三个穿透/生命字段独立；本次都为122不代表跨兵种共享。

UI每个兵种显示攻击、防御、穿透/生命三个输入。公共 `attributeFieldKey()` 同时服务输入展开与OCR核对分组，攻击、防御分别归入独立字段，穿透与生命才归入同一个字段。

## OCR

- A方预期核对字段数为9，识别计数分母为9；B方仍为2。
- 整图识别保留bounding box；按兵种和属性文字锚点及相对行关系解析。无兵种前缀仅在完整12行且顺序明确时映射盾/矛/射，不完整表不猜测。
- 不检查攻击≈防御。只检查同兵种穿透/生命一致性；跨兵种穿血不同不是冲突。
- 低置信度、缺项、穿血冲突仍需人工核对；单独确认防御不会改写攻击。确认并应用前预览不改正式配置，应用时原子提交12项。
- 本轮测试使用上述数值构造OCR bounding box输入，没有收到原始图片用于现场识别验收。

## 配置兼容与边界

存储继续使用完整12项，不新增配置版本。规范化、存储恢复和正式战斗适配保留每个兵种各自的攻击、防御、穿透代表值，生命按该兵种穿透展开。

旧锻炉6项配置仍可加载，但此前已被攻击覆盖的防御无法自动恢复；应按真实战报重新填写防御。旧共享配置已丢失的兵种差异同样需重填。

装备锻炉B方仍为 `ALL_TROOPS_PAIRED_2`；宝石矿洞仍为我方 `PER_TROOP_PAIRED_6`、敌方 `ALL_TROOPS_PAIRED_2`。没有修改正式BattleEngine、伤害/HP公式、技能规则或队列调度。

## 回归

`src/pvp/tests/equipmentForgeAttributeSchema.test.ts` 覆盖真实数值展开、独立防御编辑、不同兵种穿血、OCR9项、无攻防冲突、穿血局部冲突、缺项与低置信度确认、预览隔离、正式适配及存储恢复。

验证结果：锻炉专项19项通过；相关三文件45项通过；typecheck、lint、build通过；单进程全量109文件、1216项通过。首次全量有一个候选生成测试失败，单独复验和最终全量复验均通过，未改测试超时或搜索逻辑。72个正式战斗相关文件哈希均未变化。

- [检查摘要](../examples/equipment-forge-schema-validation-summary.json)
- 全量测试的原始JSON含本机路径，已归档至被Git忽略的 `artifacts/release-0.3.0-beta/archived-test-reports/`；验收结论保留在本文。
- [核心边界哈希核对](../examples/equipment-forge-core-boundary-audit.json)
