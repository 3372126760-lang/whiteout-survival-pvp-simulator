# 高级模式与开发工具预览

本地开发服务器：`http://127.0.0.1:5173/`。公开顶部切换仅有“普通模式”和“高级模式”。

| 入口 | 用途 |
| --- | --- |
| `/` | 普通模式；首次访问默认进入此模式 |
| `/?mode=advanced` | 玩家使用的高级模式 |
| `/?mode=advanced&dev=1` | 高级模式加开发工具 |
| `/?dev=1` | 当前公开界面加开发工具 |

高级模式按场景、A/B 阵容、兵量与兵阶、折叠属性/Buff/技能/专武/队列、模拟、结果排列。固定种子只在“固定种子复现”中显示。结果主区域显示胜率、平均回合、剩余兵力和总伤害；“详细统计”及结果抽屉包含退出兵数、90% 模拟区间与技能表现。三队玩法显示整场胜率、剩余队伍、兵力与兵损。

`dev=1` 仅显示额外的 `[DEV]` 面板，分为 Simulation Internals、Skill Debug、Damage Debug、RNG Debug、Theory / Criterion、Raw Data。原有 `maxRounds`、固定 N0、原始枚举与覆盖、技能 ID/禁用、伤害事件、原始 JSON、模型审计和存储工具位于此处。开发工具直接读写同一份 canonical config，不生成另一份战斗配置。

验收截图位于 `artifacts/advanced-mode/`：

1. `01-simple-1440x900.png`
2. `02-advanced-1440x900.png`
3. `03-advanced-full.png`
4. `04-advanced-dev-1440x900.png`
5. `05-developer-tools-expanded.png`
6. `06-mobile-simple-390x844.png`
7. `07-mobile-advanced-390x844.png`

补充截图 `advanced-player-statistics.png` 展示高级模式的玩家统计抽屉。`preview.html` 可打开带同一示例阵容的高级模式。`verification.json` 记录浏览器验收。命令：`node scripts/preview-advanced-mode.mjs`。

验收复用了修改前的 `example-config.json` 和 1000 次模拟输出。三个入口的真实 Worker 请求使用相同的规范化输入、次数和种子；结果逐字段与修改前一致：A 胜 477、B 胜 521、平局 2、回合上限 0，平均 16.283 回合。场景切换、随机/固定种子显示、抽屉内部字段隔离和手机横向溢出也经过浏览器检查。
