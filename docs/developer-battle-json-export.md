# Developer 单场战斗 JSON 导出

仅在 URL 带 `?dev=1`（已有query时使用`&dev=1`）时提供。
运行单场战斗后，展开 Developer → Raw Data → Raw BattleInput / Raw BattleResult，
可在每个区域的 Copy JSON 旁点击“导出 JSON”。大数据推荐下载文件。

## 导出内容与文件名

- BattleInput：直接使用本场 `result.input`，包含其全部canonical字段。
  修改页面配置后，仍导出原战斗输入及原seed；该区域的Copy JSON也使用同一个对象。
- BattleResult：直接使用本场 `result.simulation`，与既有Raw BattleResult含义一致，
  保留完整finalState、rounds、trace、events、技能判定、effects、targeting、HP/伤亡等实际字段。
  不从DOM、32,000字符预览或已展开的回合内容重建。
- 格式为compact UTF-8 JSON，无replacer、截断、HTML转义或额外包装。
- 文件名使用浏览器本地时间：
  `whiteout-pvp-battle-input-YYYY-MM-DD-HHmmss-SEED.json`、
  `whiteout-pvp-battle-result-YYYY-MM-DD-HHmmss-SEED.json`；无seed时省略对应后缀，seed=0正常保留。

## 内存与作用范围

`src/ui/battleJsonExport.ts`仅在主动点击时执行`JSON.stringify(data)`，随后创建Blob并触发下载。
不在render阶段生成完整JSON，不缓存完整JSON字符串，也不将其拼入HTML。
Raw折叠面板继续沿用既有懒加载和预览预算，展开时也只序列化有界副本。

临时anchor触发下载后立即移除，Blob URL在1秒后释放；下载触发异常时也会安排释放。
公开普通/高级模式不渲染按钮，事件处理也拒绝非Developer调用。
导出不修改输入或结果，不调用战斗、优化器或RNG，不新增依赖。

## 回归覆盖

- `src/ui/battleJsonExport.test.ts`：输入/结果文件名、seed省略及0、UTF-8 compact内容、URL释放、异常清理。
- `src/pvp/tests/developerRendering.test.ts`：真实UI事件、Developer按钮、两种公开模式、编辑后的原战斗输入、Copy JSON保留、
  首次render/未展开/展开面板均不提前序列化完整对象、超过5MiB结果的完整rounds/events下载、
  实际战斗结果不变、无额外战斗调用或RNG调用。

生产浏览器检查的下载文件、截图和校验结果保存在ignored的 `artifacts/battle-json-export/`。
本轮未修改BattleEngine、技能、伤害公式、取整、RNG、optimizer或canonical语义。

## 验证结果（2026-10-17）

- `npm.cmd run typecheck`、`npm.cmd run lint`：通过。
- `npm.cmd test`：131个文件全部通过，1618/1618个用例通过；默认maxWorkers=2和默认timeout保持不变。
- `npm.cmd run build`：通过，生产页面输出到 `dist-ui/`；既有chunk体积提示不阻塞构建。
- Edge实际运行 `dist-ui/` 的GitHub Pages子路径，使用现有S12 canonical输入并显式选择fixedSeed=502926396进行下载检查。
- BattleInput文件19831字节，BattleResult文件139091159字节（约132.65MiB），包含全部36回合及完整事件。
  真实下载文件的UTF-8字节数与SHA-256均匹配点击时对完整原对象的序列化结果。
- 记录对象身份的stringify计数：两个完整原对象各只在主动点击时序列化一次，首次render与Raw面板展开均未提前序列化。
- 下载无Invalid string length、OOM、页面异常或资源请求失败，两个Blob URL均释放。
- 导出前后使用同一seed重跑，summary及逐回合伤害完全一致；公开simple/advanced模式均不显示导出按钮。
- `git diff --check`通过；下载文件、截图、日志及临时检查脚本均位于ignored目录，不进入Git。

本轮实际修改文件：`src/ui/main.ts`、`src/ui/battleJsonExport.ts`、`src/ui/battleJsonExport.test.ts`、
`src/pvp/tests/developerRendering.test.ts`、本文档。
未执行git add、commit、push或deploy。
