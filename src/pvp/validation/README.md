# PVP 技能自动验收

这一层只比较“基线状态”和“单技能状态”，不会修改战斗公式、技能定义或 RNG。

## 运行

```powershell
npm run validate:skills
npm run validate:skills -- rapid-fire
```

第一条运行 `cases/` 中的全部案例；第二条只运行指定的案例。案例默认使用自身的
`simulationCount`，正式概率案例当前为 10,000 场。

## 新建案例

复制 `cases/rapid-fire.json`（概率技能）或 `cases/shield-wall.json`（常驻/增益技能），
然后填写：

- `skillId`、`targetSide`：要验收的唯一目标技能；
- `sides`：双方三兵种数量、等级和可选 T12 等级；
- `simulationCount`、`randomSeed`、`maxRounds`：可复现的批量参数；
- `probability`：理论概率、允许的绝对偏差、每场预期判定次数；
- `theoreticalImpact`：可选的描述值，用来和模拟等效收益并列展示。

runner 会自动生成两套输入：

1. 基线：目标概率技能强制不触发，或直接禁用目标常驻技能；
2. 单技能：目标技能按正常规则运行；

双方所有其他概率技能都会强制不触发。两套输入使用相同 seed 序列，以减少无关随机
波动。验收报告会检查：

- 理论概率是否与引擎当前技能等级一致；
- 判定次数是否符合 `expectedChecksPerTrial`；
- 实际概率是否落在容差内；
- 非目标概率技能是否发生误触发；
- 平均伤害、剩余兵、回合数、承伤和胜率的差值。

批量过程只保留聚合统计；每场 BattleTrace 在消费后立即释放。
