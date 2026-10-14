# 冰火战歌专家四技能：等级、效果与计算来源

## 本轮修正

此前冰火下拉框只显示等级；底层 `getGarethPenetrationReduction` 已按所选等级计算，没有静默使用满级。本轮把既有规则整理为正式等级表，并消除其他页面重复计算显示数值的表达式。

现有项目数据对应：

| 等级 | 下拉框 | 当前效果 |
| --- | --- | --- |
| Lv0 | Lv0 · 0.0% | 不施加专家穿透减益 |
| Lv8 | Lv8 · 2.0% | 敌方全军穿透降低 2.0% |
| Lv20 | Lv20 · 5.0% | 敌方全军穿透降低 5.0% |

保留项目原有 `level × 0.0025` 小数规则的数值；本轮没有新增或猜测游戏技能数值。技能 ID 为 `expert.gareth.penetration`。

## 唯一解析来源

- `src/pvp/externalBuffs/expertSkills.ts`：等级表、效果结构、`resolveExpertSkillEffect(skillId, level)` 和显示摘要。
- `src/pvp/externalBuffs/reportBonusResolver.ts`：调用同一 resolver，将专家效果归入外部穿透减益。
- `src/ui/expertSkillView.ts`：用 resolver 生成等级选项与说明，冰火、单撞/集结和旧队列表单复用。
- Criterion、Theory、正式 BattleEngine 输入继续经过现有属性构建链，使用上述外部效果；没有修改战斗公式或核心实现。

效果数值使用小数：2% 存储为 `0.02`。A 方专家对 B 方全军施加减益，B 方专家对 A 方全军施加减益。A/B 分别解析自己的等级；每侧三队共享自己的上下文，但一个子战斗只应用一次。

## 审计与缺失数据

优化器返回 `sharedExpertAudit.A/B`，每队转换审计也带同样字段：

```json
{
  "expertSkillId": "expert.gareth.penetration",
  "expertSkillLevel": 8,
  "resolvedExpertSkillEffects": [{
    "attribute": "penetration",
    "effectTarget": "enemy",
    "troopScope": "all",
    "category": "debuff",
    "multiplierGroup": "externalDebuff",
    "value": 0.02
  }],
  "resolvedExpertSkillDisplay": "Lv8 · 2.0%",
  "expertSkillEffectResolved": true
}
```

未知技能或未配置等级显示 `LvN · 数值未配置`，解析结果的效果为 `null`，审计标记 `expertSkillEffectResolved=false`。战斗属性构建报明确错误，不能当成零、满级或其他固定值；当前正式表中 Lv0 的零效果则是有效配置。

## 回归与边界

`src/pvp/tests/iceFireExpertSkill.test.ts` 验证 Lv8/Lv20、零值/缺失区别、UI 效果和作用范围、A/B 独立等级、Criterion/Theory 模板变化、三队正式场景中只应用一次，以及真实优化器审计。`uiStartup.test.ts` 验证 UI 切换和独立自动保存。

本轮没有启动新开发服务器，也没有进行 Edge 现场视觉验收。最终检查见 [验收记录](../examples/ice-fire-expert-skill-validation.json)。
