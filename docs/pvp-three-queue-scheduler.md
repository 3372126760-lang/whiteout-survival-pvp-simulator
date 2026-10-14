# 三队列存活队伍调度

`src/pvp/scenario/threeQueueScheduler.ts` 只决定下一小场双方哪一队出战。每小场仍调用正式 BattleEngine；旧的前三场固定 A1–B1、A2–B2、A3–B3 配对已移除。

当前可复现的暂定调度为：每场从 A/B 双方各自存活队列池中均匀随机抽一队，使用项目的 seeded RNG。胜队保留本场实际盾、矛、射剩余数，之后可能连战，也可能休息再出战；败队永久淘汰。任一方无队可出时结束，因此最多五小场。

`ScenarioResult.threeQueueScheduler` 记录 `rule: "uniformAliveRandom"`、`ruleStatus: "provisional"`、seed，以及每场出战队伍、战前/战后兵数和淘汰队伍。当前战报只确认“每场可从存活池重新选择”，尚未确认官方抽取概率；**均匀分布仍是暂定机制**。三队列 Monte Carlo 对每次 trial 使用不同 seed，同时覆盖调度与战斗技能随机性。

优化器快速路径与常规模拟复用同一调度器。快速路径仅返回胜方、场数、总回合数、各队剩余兵数，不保存 BattleTrace。
