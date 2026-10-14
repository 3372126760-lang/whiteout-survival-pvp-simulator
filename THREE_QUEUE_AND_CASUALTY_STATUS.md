# 三队列与战后伤亡交付（2026-09-27）

## 三队列流程

`runThreeQueueScenario` 位于 `src/pvp/scenario/threeQueueScenario.ts`。A/B 各三队，每方配置一个 **每队** 出征容量；每队独立配置车头英雄、盾/矛/射的攻防穿血战报百分比、兵种等级和比例。手动比例按 0.01% 转为整数基点，再用最大余数法转为整数兵数；三个队列分别占满同一容量。旧的侧级属性和等级会迁移为三队相同的初值。

场景 seed 派生出 A/B 各自的洗牌 seed。前三场使用洗牌顺序一一配对。之后双方存活队列按当前顺序继续交战，直至一方无队列。每场调用现有单场 BattleEngine，生成新的 `BattleState`；胜队仅携带盾/矛/射剩余兵数，临时效果、护盾、眩晕和技能状态重新初始化。结果保留每场完整 `BattleTrace`、配对及战前后兵数、场景 seed、洗牌 seed、初始顺序、剩余队列和总场数。单场到达回合上限而未分出淘汰时，调度器报错，提示提高每场回合上限。

页面顶部的“三队列模式”已开放。A/B 各显示共享的每队容量，以及三队各自的英雄、最终战报属性、兵种等级、比例和实际兵数。比例合计不为 100.00%、精度超过 0.01% 或容量无效时，页面禁用开始模拟和批量模拟并提示。单次结果展示全部场次、每场完整战斗日志和双方伤亡汇总。批量模拟按完整三队淘汰赛逐次执行，显示胜率、失败 trial、平均剩余队列/兵数及战后伤亡。

## 战后伤亡

`src/pvp/postBattle/casualtyResolver.ts` 在战斗结束后读取初始人数与存活人数：`exited = initial − survivors`。普通模式把退出人数按损失/受伤/轻伤 `0/35/65` 分类，掏炉子按 `35/10/55` 分类。总量及兵种分配均使用最大余数法，保持整数守恒；`defeated = loss + injured`。若战斗状态保留等级构成，先求每个等级实际退出人数，再在对应兵种的伤亡总额内按等级分配，并在结果中保留 `byGrade`。该分类不影响回合伤害与 HP。

## 代码与边界

- 场景类型、整数比例与计算：`src/pvp/scenario/threeQueueScenario.ts`、`src/pvp/scenario/threeQueueRatios.ts`、`src/pvp/scenario/index.ts`。
- UI 输入、批量统计与转换：`src/pvp/validationUi/types.ts`、`src/pvp/validationUi/adapter.ts`、`src/pvp/validationUi/threeQueueBatch.ts`、`src/ui/main.ts`、`src/ui/batchWorker.ts`、`src/ui/styles.css`。
- 战后分类与测试：`src/pvp/postBattle/casualtyResolver.ts`、`src/pvp/tests/threeQueueScenario.test.ts`、`src/pvp/tests/scenarioFirstPhase.test.ts`。

BattleEngine、伤害公式、HP 公式、兵种和英雄技能实现均未修改。三队列优化器已接入，搜索英雄和比例时保留每队属性及等级；单场达到回合上限仍需玩家提高上限，批量模拟会将该 trial 计入失败。最新实现详见 [三队列批量模拟交付](THREE_QUEUE_MONTE_CARLO_STATUS.md) 与 [场景优化说明](SCENARIO_OPTIMIZER_STATUS.md)。

## 验收

`npm run typecheck`、`npm run lint`、`npm run build` 均通过；46 个文件、630 个测试通过。测试覆盖每队属性与等级跟随配对进入战斗、相同英雄不同属性的真实轨迹差异、旧存档迁移、百万容量、整数基点、固定 seed 洗牌、淘汰续战、批量 trial、伤亡守恒及等级拆分。
