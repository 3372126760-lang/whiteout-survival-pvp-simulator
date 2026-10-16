# 默认 npm test 超时复核

2026-10-15；仅本地修复与验证，未 push、未部署。BattleEngine、英雄/兵种技能、RNG、伤害公式和优化器生产源码均未修改。

## 原始6个失败：以用户提供的日志为准

根目录 `test-failures.txt` 的运行时间为20:20:10，结果为125个文件中5个失败，1559项中6个失败。下面名称、耗时和错误均来自该文件，不是根据缓存猜测。原始日志包含本机路径，已加入 `.gitignore`；保留原文件，清理ANSI后的副本位于忽略目录 `artifacts/test-timeouts/user-test-failures-clean.txt`。

全部为 timeout，没有断言失败；其中5项限制为5000ms，1项原有独立限制为30000ms。

| 文件 | 完整test name（suite → test） | 日志耗时 | 实际error / stack |
| --- | --- | ---: | --- |
| `src/pvp/tests/uiStartup.test.ts` | controlled preset dialogs without native prompt/confirm → saves UNDERGROUND_LAB, cancels, overwrites and deletes using application state | 5150ms | `Error: Test timed out in 5000ms.`；`uiStartup.test.ts:160:58` |
| `src/pvp/tests/optimizerRecentHeadConstraint.test.ts` | hard recent generation head candidate constraint → searches all ratios for an old-only fixed head even with legacy switches (adaptive=true) | 8104ms | `Error: Test timed out in 5000ms.`；`optimizerRecentHeadConstraint.test.ts:68:25` |
| `src/pvp/tests/optimizerRecentHeadConstraint.test.ts` | hard recent generation head candidate constraint → searches all ratios for an old-only fixed head even with legacy switches (adaptive=false) | 7033ms | `Error: Test timed out in 5000ms.`；`optimizerRecentHeadConstraint.test.ts:68:25` |
| `src/pvp/tests/scenarioOptimizer.test.ts` | scenario optimizer routing and candidate semantics → searches single ratios with fixed heroes and preserves the other side | 8168ms | `Error: Test timed out in 5000ms.`；`scenarioOptimizer.test.ts:71:3` |
| `src/pvp/tests/threeQueueActivityModes.test.ts` | three-queue activity scheduling → optimizer propagates the activity to formal trials and uses position search only for IceFire | 11584ms | `Error: Test timed out in 5000ms.`；`threeQueueActivityModes.test.ts:222:3` |
| `src/ui/optimizerBenchmarkFixture.test.ts` | complete optimization Benchmark Fixture → reruns the exact same formal candidates and seed results after export/import | 49177ms | `Error: Test timed out in 30000ms.`；`optimizerBenchmarkFixture.test.ts:50:3` |

这些栈是运行时捕获的用例声明位置，不是内层计算阻塞位置。日志生成期间源文件发生了本轮本地编辑，故末尾动态渲染的源码行片段可能与捕获的旧行号错位；以上保留日志记录的原始位置。

## 每个失败在做什么、根因及与优化器改动的关系

1. **UNDERGROUND_LAB preset：A，首次导入与CPU争用导致超时。** `mountStartup()` 先等待 `import("../../ui/main")` 的冷编译与模块执行，再等待 `vi.runOnlyPendingTimersAsync()` 刷新初始任务；之后保存、取消、覆盖、加载、删除均为真实委托事件和同步渲染。日志已经出现初始化和多次后续渲染，没有显示永久悬挂。仅凭注册位置的timeout栈不能精确声称截止的那一刻在哪条await；低并发复跑和timer断言验证了这些步骤都会结束。与新优化器的关系是间接的：同一全量测试中新增/加重的CPU工作与首次UI导入竞争；没有找到preset业务逻辑或fake timer死锁。
2. **fixed old Head / adaptive=true：A，测试工作量加重是相关因素。** while循环同步执行workflow推进、Criterion/Theory以及真实正式战斗；不存在未resolve的await、事件或Worker。测试保留了旧预算 `verificationTrials=3`，但唯一新管线按要求最低Final1000，不再执行旧3场路径。运行工作量增加后，15进程下超过5秒。与本轮集结管线改动直接相关，但不是BattleEngine单场公式变化或候选逻辑断言错误。
3. **fixed old Head / adaptive=false：A，同上。** `adaptiveSearch.enabled=false` 不恢复已删除的旧集结管线，仍然执行同一新管线和Final1000。两种设置的合法性、锁定和搜索域断言全部保留，没有跳过其中一种。
4. **Single ratios：A，CPU密集的比例搜索在高并发下超时。** 同步执行 `optimizeSimpleScenario()` 的数值筛选、比例候选及真实试验，随后验证另一方保持不变；不是等待Promise。单独重跑约2.4秒，默认全量复现约6.6秒。与本轮改动的关系是测试套件资源竞争，未发现Single业务逻辑退化或断言失败。
5. **ThreeQueue activity：A，两个调度模式合计计算时间被放大。** 一个用例内依次优化IceFire和随机模式，包含Criterion/Theory及注入调度runner验证；是同步计算，不等待Worker或事件。单独约3.6秒，默认全量约9.6秒。与新增集结/Fixture测试争用CPU相关；未修改三队列调度业务或减少两个模式的覆盖。这里确实有两个模式在一个用例内，和preset的 `it.each` 结构不同。
6. **完整Fixture复跑：A + 新增集成测试工作量过重。** 导出/导入包含异步SHA-256校验，但实际阶段记录中导出约33ms、导入约7ms；主要时间是两次同步 `runRallyOptimization()`，包括每次Final1000。微型输入缩小容量后，第一次约9.8秒、第二次约9.3秒；每次执行2280场真实战斗，Final阶段约6.9秒，当前配置平均26.4回合。不是crypto、Promise或Worker未resolve。该测试是本轮新增，输入过于耗时使原30秒限制在满并发下失败。修复只调整此测试的微型阵容属性以缩短低伤害对局，完整字段/英雄/专武/T12往返与真实固定seed试验仍由同文件另一用例覆盖。

分类结论：A已通过只改变并发的全量对照验证；新增管线最低Final1000与新增Fixture测试增加了测试工作量，属于相关的测试成本变化，不能据此声称BattleEngine出现单场性能退化（B）。没有发现C类fake timer泄漏是原失败根因，没有D类未完成Promise/Worker，没有E类断言错误。

Vitest对同步测试会在函数返回时再次检查真实墙钟时间；因此同步计算跑完、断言已完成，也会因总时间越限而报告timeout，不能把这些栈当作永久等待的证据。

## uiStartup fake timer核查

- `it.each(["UNDERGROUND_LAB", "HEART_OF_EARTH"])` 生成两个独立test，每个独立5秒，不是同一个test跑两轮preset。
- 原来已有 `finally { vi.useRealTimers(); }`，没有遗漏该恢复路径。
- 没有 `waitFor`；初次挂载显式 `runOnlyPendingTimersAsync()`，需要时显式推进timer。
- preset并未触发Fixture导入、Worker或优化流程；新增断言检查Worker创建数为0。
- preset完成后显式刷新剩余任务并断言 `vi.getTimerCount() === 0`，finally清理timer；afterEach也为仍处于fake timer状态的失败测试提供清理，随后恢复global/mock并reset modules。

## 修改范围

- 新增 `vitest.config.ts`，合并现有Vite配置；只设置 `maxWorkers: 2`。保留默认forks池、进程隔离及默认5000ms；现有个别测试独立timeout不变。
- `uiStartup.test.ts` 增加timer清理与preset无残留timer/Worker断言。
- `optimizerBenchmarkFixture.test.ts` 使用短对局微型输入；仍使用真实引擎、相同完整seed策略、完整阶段及两次Final1000，新增最终场次断言。
- `.gitignore` 忽略含本机路径的 `test-failures.txt`；README和前次验收说明补充实际测试条件。
- 没有提高全局或单项timeout，没有skip/delete测试，没有catch忽略错误。

## 对照运行记录

修复前，先单独运行缓存标出的5个文件，69/69通过，约29.95秒；没有改timeout。

随后默认并发全量复现：4个文件失败、5项timeout，1554通过、总1559；本次preset通过，说明超时会随负载变化。日志为 `artifacts/test-timeouts/full-default-before.log`，JSON同名。

不改源码、不改timeout、保留相同forks池，仅用 `--maxWorkers=2`：125/125文件、1559/1559项通过，约105.89秒。日志与JSON位于 `artifacts/test-timeouts/full-two-workers-before.*`。这一步先验证原因，再将并发设置写入项目，最终验证不依赖命令行覆盖。

## 前次“1559全部通过”为何不等于用户本机默认命令通过

之前保留的 `artifacts/dual-recall-tests.json` 确实记录1559通过，但最终运行命令是 `--pool=threads --maxWorkers=2`；当时未将并发条件写入项目，也没有在汇报中说明。默认Vitest在本机16个逻辑核上使用最多15个测试进程，与该验收条件不同。前次“默认命令已通过”的含义不成立，这是验收覆盖与汇报遗漏，不应归咎于用户，也不能将此次失败抹成历史通过。

## 修复后的最终命令

最终顺序：typecheck和lint完成后，单独运行不带额外参数的 `npm.cmd test`，测试结束后再build，避免本任务的构建与测试并发。四个命令退出码均为0：

| 命令 | 实际结果 |
| --- | --- |
| `npm.cmd run typecheck` | passed |
| `npm.cmd run lint` | passed |
| `npm.cmd test` | **Test Files: 125 passed (125)；Tests: 1559 passed (1559)** |
| `npm.cmd run build` | passed；生产UI输出 `dist-ui`，资源文件名与修复前相同 |

最终裸命令于20:31:30开始，耗时96.48秒；没有CLI的pool、maxWorkers或timeout覆盖，没有减少测试数。完整输出保存在忽略目录 `artifacts/test-timeouts/npm-test-final.log`；构建输出为同目录 `npm-build-final.log`。构建仅有既有的大于500kB chunk提示，退出码0。

最终5个原失败文件均通过，下面是**整文件**总时长，不是某个单项时长：

| 文件 | 项数 | 最终整文件耗时 |
| --- | ---: | ---: |
| `uiStartup.test.ts` | 40 | 4.032s |
| `optimizerRecentHeadConstraint.test.ts` | 5 | 3.491s |
| `scenarioOptimizer.test.ts` | 7 | 2.023s |
| `threeQueueActivityModes.test.ts` | 14 | 3.130s |
| `optimizerBenchmarkFixture.test.ts` | 3 | 9.508s |

Fixture整文件在同为2进程的修复前对照中约27.990秒，最终为9.508秒；是测试输入缩短对局后的成本下降，不能作为真实对局优化器加速比。最终仍然真实运行两次Final1000，原30秒单项限制未增加。没有skip/delete测试、没有catch忽略失败。

本轮修改文件：`vitest.config.ts`、`src/pvp/tests/uiStartup.test.ts`、`src/ui/optimizerBenchmarkFixture.test.ts`、`.gitignore`、`README.md`、`docs/dual-channel-recall-review.md`、本文。正式引擎、技能、RNG、伤害公式未改；124份既有正式源码哈希在全量测试中全部核对一致。未push，未deploy。
