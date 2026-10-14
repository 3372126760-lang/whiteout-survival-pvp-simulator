# 三队列基点比例、独立等级与批量模拟交付（2026-09-27）

## 改动文件

- `src/pvp/scenario/threeQueueRatios.ts`：0.01% 输入转整数基点、严格求和校验、最大余数分兵；分别定义手动步长 `1 bp` 与未来优化器步长 `100 bp`。
- `src/pvp/scenario/threeQueueScenario.ts`：三兵种独立最高等级、旧配置读取、基点配置、未决子战斗错误类型、逐场对战和战后汇总。
- `src/pvp/scenario/index.ts`、`src/pvp/validationUi/index.ts`：导出新接口。
- `src/pvp/validationUi/types.ts`、`adapter.ts`：UI 的 `highestTroopLevels` 及新场景配置转换。
- `src/pvp/validationUi/threeQueueBatch.ts`：整场三队列 Monte Carlo 与聚合统计。
- `src/ui/main.ts`、`styles.css`、`batchWorker.ts`：各兵种等级选择、严格比例验证、批量按钮与结果展示、Worker 路由。
- `src/pvp/tests/threeQueueScenario.test.ts`、`threeQueueBatch.test.ts`：基点、等级迁移、淘汰、可复现、100 次批量与失败 trial 回归。
- `THREE_QUEUE_AND_CASUALTY_STATUS.md`、`PVP_MODEL_STATUS.md`、本文：同步状态。

## 配置与整数比例

新 `ThreeQueueScenarioConfig` 包含 `id`、`seed`、`maxRoundsPerBattle`、`casualtyMode`、`attacker`、`defender`。每方有 `deploymentCapacity`、`highestTroopLevels: {shield,lancer,marksman}` 和三支队伍；每队新配置使用 `ratiosBp: {shield,lancer,marksman}`、`id`、已装配的玩家共享属性和本队英雄 `side`。类型仍允许读取旧的 `highestTroopLevel`、`availableTroopLevels` 和百分比 `ratios`；适配器新输出只写三兵种等级及 `ratiosBp`。

UI 以百分数输入，`step=0.01`。转换先校验每项恰为百分之一的整数倍，再要求三个整数基点之和恰好 `10000`；`33.33/33.33/33.34` 对应 `3333/3333/3334`，`33.33/33.33/33.33` 会报错。兵数由 `capacity × bp ÷ 10000` 的整数商和余数分配，等余数顺序为盾、矛、射。优化器仍预留 `100 bp = 1%` 步长，本轮没有启动搜索算法。

## 单次与批量流程

单次运行 `runThreeQueueScenario`：用玩家各兵种最高等级准备六队，双方各自以 seeded RNG 洗牌，前三组一一对战，之后按存活顺序继续淘汰。每场调用现有单场 BattleEngine 并创建新 `BattleState`，胜队只继承剩余兵数。`battleResults` 保留每场完整 BattleTrace。子战斗未决时抛出 `ThreeQueueUnresolvedError`，不判输赢。

批量 `runThreeQueueBatchSimulation` 先把 UI 输入编译为场景配置，每个 trial 都调用上述完整调度器。固定模式以 UI seed 为 `rootSeed`；随机模式从 `crypto.getRandomValues` 取得 root seed。第 `i` 次使用现有 `deriveBatchSeed(rootSeed, i)`（uint32 加 `i` 取模）；场景 seed 再派生 A/B 独立洗牌 seed，子战斗 seed 从场景 seeded RNG 顺序生成，技能与闪避使用子战斗 seeded RNG。三队列及其新批量路径均未使用 `Math.random()`；项目其他模式的旧随机 seed 兜底逻辑仍存在于 `randomMode.ts`。

批量结果统计 `simulationCount`、A/B 胜、`failedTrials`、胜率、平均子战斗场数、双方平均剩余队列/兵数、平均损失/受伤/轻伤，并记录 root、首尾 trial seed 及失败 seed。胜率以全部 trial 为分母；均值以已完成 trial 为分母。子战斗达到回合上限时该 trial 计为失败，所以 `A 胜 + B 胜 + 失败 = 模拟次数`。批量只返回聚合结果；单次仍保留完整逐场日志。

## 战后伤亡与不变范围

`PostBattleCasualtyResolver` 继续在战斗结束后按 `exited = initial − survivors` 分类：普通 `0/35/65`，掏炉子 `35/10/55`，`defeated = loss + injured`。总量、兵种和现存的等级构成均作整数守恒分配。BattleEngine、DamageEngine、伤害和 HP 公式、技能及单撞/333 战斗行为均未改动。

## 验证与剩余项

`npm run typecheck`、`npm run lint`、`npm run build` 均通过；全量 `npm test -- --run`：41 个文件、592 项测试通过。已覆盖比例精度与不规则容量、每队百万容量、三兵种不同等级、旧等级读取、固定 seed 复现、续战、100 次真实三队批量、root seed 复现、未决 trial，以及既有伤亡和单撞回归。

三队列配队优化器仍未开发。单次子战斗未决时须提高最大回合数；批量会显示未决 trial 数量及 seed。当前环境没有可用的浏览器 UI 自动化，页面已通过构建，但未做截图视觉核对。
