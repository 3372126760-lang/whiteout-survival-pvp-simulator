# S12之后的Head候选池同步

日期：2026-10-18。本地修复，不提交或部署。

## 根因与原有S12引用

没有发现`Math.min(serverGeneration, 12)`或`generation <= 12`这样的搜索上限。
英雄目录包含S13～S16，`SERVER_STAGES`也映射到16；`getValidationCatalog()`缓存的是完整目录，并没有缓存某个阶段的子集。

复现的实际原因是：旧`ownedHeroIds`/`availableHeroIds`保存了S12的完整拥有快照。
UI升代后只调用既有初始化函数，初始化只遍历已拥有英雄，不会把新开放英雄加入拥有列表。
因此输入已是S13，但双方优化器仍从旧37名车头中读取候选。
同一份旧快照在S12/S13/S14的参与数实测均为37，而对应完整服务器池为37/40/43。

另外发现两个S12专用诊断：`src/ui/main.ts`的缺少当代英雄提示、
`src/pvp/optimizer/headPoolAudit.ts`的S12审计字段与警告。它们不参与候选过滤，但无法解释S13以上的问题。
提示和主审计现已按当前服务器代数生成；旧S12字段仅保留为历史JSON兼容别名，不用于筛选或封顶。

## 修复规则

用户最终确认：**所有拥有列表在升代时都自动加入本次新开放的合法车头**。

- `optimizerHeadHeroAllowed`显式统一校验S系列与`generation <= serverGeneration`；无固定代数上限。
- `syncOptimizationHeroPoolForStage(previous,current)`只在用户切换阶段时执行。
  升代会把跨过的所有新代合法SSR车头加入明确拥有列表，初始化双方优化池。
  即使原拥有列表为空或仅有一个英雄，也执行该规则。
- 未拥有的旧英雄不会被补入；原有的参与开关与专武等级保留。
  若新开放英雄此前已有明确的`enabled=false`或自定义专武，仍尊重该值。
- 降代按当前服务器阶段过滤，未来英雄即时隐藏并退出搜索，拥有记录和优化设置保留。
  再次升代会恢复原有设置，不把曾取消参与的英雄重新勾选。
- “理论全部可用”继续直接从完整目录按阶段过滤；不强制改写为拥有快照。
- 不在读取/导入已冻结Benchmark Fixture时猜测扩池，确保既有历史输入和候选范围仍可复现。
- UI计数和Worker读取共用`optimizationHeroIds`、`ownedOptimizationHeroIds`，不维护另一套展示数量。

## 候选数量

下表为完整拥有且全部参与时的数量；保留现有近三代、稀有度、位置与合法性规则。

| 阶段 | Head英雄数 | 合法三英雄Head组合 |
| --- | ---: | ---: |
| S8 | 25 | 426 |
| S11 | 34 | 876 |
| S12 | 37 | 1062 |
| S13 | 40 | 1266 |
| S14 | 43 | 1488 |
| S15 | 46 | 1728 |
| S16 | 49 | 1986 |

自定义列表只补本次新代，例如S12仅拥有1名旧车头，升到S13后变成4名，不会凭空获得其余旧英雄。

## 调用链与缓存

完整catalog → 当前stage过滤 → 拥有与参与设置 → Head合法性/近三代/支配检测 →
J Peak → Criterion → Theory → Formal → Final，均消费同一份当前stage输入。
已检查simple、三队、集结及浏览器Worker入口，没有另外的S12截断。

UI切换stage会生成新input对象，原WeakMap缓存通常会自然失效；没有证据表明这就是37不增加的根因。
为覆盖调用方复用input对象的情况，`heroSearchPolicy.ts`的generation/audit缓存key现显式包含stage。
正式模板和Worker亲和key原本就序列化完整input、包含stage，不需要修改。

## 回归与作用范围

- `headPoolBeyondS12.test.ts`：阶段矩阵、所有拥有列表升级、降级恢复、空列表、旧available列表、
  参与/专武保留、缓存stage依赖，以及S13车头经真实J/Criterion/Theory/Formal1000输出。
- `uiStartup.test.ts`：真实stage change事件下37→40→43→46→49，以及降回37；
  UI显示数量与实际传给Worker的S13池数量一致；自定义拥有列表也新增S13。
- 既有Head稀有度、S12 canonical Body=10185、车身重复上限、原Benchmark输入和Formal完整性回归继续保留。

本轮只修改`src/pvp/optimizer/heroPools.ts`、`src/pvp/optimizer/heroSearchPolicy.ts`、
`src/pvp/optimizer/headPoolAudit.ts`、`src/ui/main.ts`、上述两份测试、本文档和旧`head-pool-s12-review.md`中的拥有规则说明。
没有修改战斗引擎、英雄/兵种技能、RNG、伤害公式、取整、Body规则或J/评分公式。

## 最终验证

- `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build`均通过。
- `npm.cmd test`：132个测试文件全部通过，1633/1633个用例全部通过。
  保留默认`maxWorkers=2`和原有timeout，没有跳过、删除测试或提高全局timeout。
- 使用实际`dist-ui`、GitHub Pages子路径和浏览器原生Worker验证：
  不刷新页面，S12→S13→S14→S15→S16→S13→S12→S13的英雄数为
  37→40→43→46→49→40→37→40；仅切换阶段不会启动搜索Worker。
- 通过实际UI选择三名S13车头Gisela/Flora/Vulcanus，固定空Body、未固定Head，
  实际optimizer Worker及4个候选Worker完成J Peak、双通道召回、Criterion、Theory、
  Formal Ratio和Final1000。结果确实包含该S13车头组合，且`trials=1000`。
  这是缩小候选空间以验证生产调用链的受控输入，不代表全池最优性或真实对局胜率。
- 浏览器没有页面异常或资源请求失败。检查记录及截图位于被忽略的
  `artifacts/head-stage-review/`，运行日志和临时检查脚本位于被忽略的`.tmp/`，均不进入Git。
- 未执行git add、commit、push、deploy或tag。
