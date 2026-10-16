# CHANGELOG

## v0.3.0-beta — 2026-10-15

- 集结优化改为 Head×Body J 联合搜索：H0 → B0 → J Preparation → J Peak → Recall Merge → Criterion 5% / 1% → Theory → Formal → Final。
- 建立 canonical Body 体系；S12 全可用自动池保留21种效果，四槽无序、同效果最多两份，自动 Body 共10185组。实际候选数仍受阶段、拥有池和锁定条件约束。
- 英雄候选池随服务器阶段和启用的自有英雄动态生成，自动 Head 保留 SSR 与近三代约束。
- 删除旧 C0/C1/C2/C3 集结优化执行流程及旧切换开关，历史报告和可复现输入继续保留。
- 接入 Criterion 5% / 1% 局部筛选与 Theory 排序，再由正式战斗验证。
- 增加 Formal Ratio 两阶段复核：共同20场筛选比例，Top2比例累计100场复核；随后进入Formal300和Final1000。
- 增加 Global Top10000 + PerHead TopK 双通道召回；默认K=1，去重后合并，记录重叠与来源。当前配置和保护引用独立复验。
- Developer 显示 J峰值检查点、截断阈值、Formal比例的J保留率、Head/Body内部排名及Recall诊断。
- 支持完整 Benchmark Fixture 下载、复制、导入和一键复跑，保存双方canonical配置、有效候选池、优化参数及精确共同种子。
- 默认测试 `maxWorkers=2`，修复高并发下的本机超时；补充timer清理，缩短Fixture测试对局，保留真实Final1000验证和原有timeout。
- 页面、npm包、锁文件根版本及新导出Fixture统一为v0.3.0-beta。

本版仍为非官方公开Beta。战斗机制的不确定项继续以项目文档为准；缺失完整输入的历史实验不作为严格同输入A/B结果。
