# Benchmark 数据

本目录只保存完整回归输入、必要测试基线与精简历史摘要。逐文件分类与依赖见 [暂存数据审计](../docs/benchmark-staging-audit.md)。

- `optimizer/*-input.json`：完整canonical配置和优化参数；冻结输入不可跟随当前默认值静默改写。
- `optimizer/*-summary.json`、`joint-peak-microbenchmark.json`：精简的历史计数、耗时、候选结果、输入哈希和来源哈希，省略完整诊断树、逐候选轨迹及重复配置。
- `optimizer/*-history.json`：用户提供的历史观察。缺失的完整配置保持未知，不伪造复现。
- `optimizer/formal-engine-integrity.json`：正式源码完整性快照，用于回归核对。
- `*-pre-freeze-*.json`：冻结前的历史输入及对照，保留以解释与正式冻结输入的差异。

本轮发布整理不会更新历史输入、性能数字或输入哈希。历史报告中的v0.2.0-beta保留为原开发版本记录；当前公开应用为v0.3.0-beta。

`joint-recall-gen12-input.json` 从原recall profile提取实际运行的完整canonical配置、优化参数、引擎快照和精确种子。它与未经codec规范化的Head Pool原始输入不同，不能只留后者替代。四份原有输入保持原字节内容，新输入也不重新推断任何字段。

完整 `*-profile.json` 和 `*-audit.json` 默认写入 `artifacts/benchmarks/optimizer/`，整个artifacts目录被Git忽略；本次原始输出归档在其中的 `archive-staged/`。`benchmarks/optimizer/` 也显式忽略这两类生成文件，防止再次误加。旧C0流程已删除，因此旧profile不能用当前代码重跑；它们作为本机历史原件归档，仓库保留原输入及精简记录，不声称当前仍能执行旧A/B。

没有完整profile被测试直接读取。`canonicalJointPipeline.test.ts` 直接使用冻结Gen12输入、提取的recall输入和124份源码哈希基线；这些均属于必须保留的fixture。

临时运行请显式将输出写入被Git忽略的目录，例如：

```bash
npm run benchmark:joint-recall -- --fixture path/to/fixture.json --output artifacts/benchmarks/local-profile.json
```

不传参数时，联合benchmark使用 `optimizer/joint-recall-gen12-input.json`，输出完整profile到忽略目录；Head/Body audit与J微测量同样默认写入忽略目录。两个历史报告生成器读取Git内的精简摘要，可以在没有完整profile的检出中工作。

将新结果纳入长期基准前，应核对输入、配置、共同种子和比较口径，并移除本机绝对路径。
