# 开发服务器、启动异常与性能检查

## 单实例启动

在项目目录运行 `npm.cmd run dev`。`scripts/start-dev.mjs` 先检测 127.0.0.1:5173：

- 空闲：启动 Vite，使用固定端口和 `strictPort`，输出实际 URL。
- 当前项目已运行：读取 `/__pvp/dev-server` 的项目根目录和 PID，复用该实例后退出启动脚本。
- 被其他服务占用：明确报错并退出，不自动杀进程，也不递增到 5174/5175。

本轮已核实并关闭旧 Vite PID 21148（5174）、39392（5175），保留 PID 37300（5173）。旧实例命令行均指向本项目 `node_modules/vite/bin/vite.js`。现在使用 **http://127.0.0.1:5173/**。已有服务器时，Codex 后续验证直接连接此 URL，不重复启动。

Windows 检查：

```powershell
netstat -ano -p TCP | Select-String ':517[345]\s'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'vite|npm.*dev|start-dev' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

关闭终端里的 dev 服务使用 Ctrl+C。发现遗留进程时，先核对命令行确实属于当前项目，再结束对应 PID。

## HMR 与白屏

`reportAttributes` 和 `blankOcrBox` 现在声明于第一次 `render()` 之前；原问题是声明顺序造成 TDZ，没有同名 shadowing。`bootstrap.ts` 在动态加载主模块前安装错误兜底。启动、渲染或未处理异步异常会显示错误文本与“重新加载”；开发模式还显示 stack。错误文本通过 `textContent` 写入。

主 UI 代码修改后 Vite 可以发送 full reload。启动失败期间收到更新也会刷新，避免崩溃模块无法安装 HMR handler。修改 Python OCR 脚本时，旧 OCR worker 会停止，Vite 广播 full reload；下一次上传才初始化更新后的模型。

连接检查可在已有服务器上执行，脚本不启动服务器：

```powershell
node scripts/verify-dev-server.mjs http://127.0.0.1:5173/
```

它验证本项目身份、Vite HMR WebSocket 握手，临时加入无行为变化的测试注释，检查 main.ts、前端 OCR parser 与 Python OCR 脚本的更新通知，随后恢复原文件。探测前完整读取模块，确保 Vite 已分析模块依赖；只接受与目标文件对应的通知，避免把上一次恢复文件的消息当成本次成功。它验证的是服务器消息，浏览器是否实际收到并刷新还需在 Edge 中检查。

## 首屏工作量

- 首次 render 前只恢复配置数据；自动恢复不构建 BattleState。完整战斗预检保留在明确操作中。
- 普通 render 不创建战斗状态、不模拟、不启动优化器或 OCR。
- 英雄 catalog 只解析一次；战斗输入及预期属性预览按不可变输入对象缓存。
- OCR parser 用 dynamic import 在上传后加载。RapidOCR/ONNX 模型在本地 Python 中，不在前端 JS bundle 内。
- OCR 编辑详情、特殊加成表、原文/bbox、英雄池、高级调试、Top 候选、BattleTrace 都按展开状态创建。关闭时移除详细 DOM。
- 优化器关闭时不调用英雄池渲染。打开优化器后，英雄池仍默认只构造摘要。
- 保存配置只在输入或优化参数引用变化时重新序列化；折叠切换不会触发配置保存。

## 实测与待完成验收

2026-10-04 本机已测得：

| 项目 | 结果 | 测量范围 |
| --- | --- | --- |
| 初次 OCR | 3105–3737 ms | 两轮本地 HTTP，900×240 合成中文图片，原图+增强双通道 |
| 初次模型初始化 | 539–787 ms | Python 中 RapidOCR 构造；HTTP 总耗时还含进程和依赖启动 |
| 第二次 OCR | 1148–1366 ms | 同一图片，同一 Python PID，`engineReused=true` |
| OCR worker 数量 | 1 | 两次请求后 `workerStarts=1` |
| 上传前 OCR worker | 未创建 | `/__pvp/ocr-status`: `started=false`、`requests=0` |
| HMR main.ts 通知 | 56–62 ms | 修正探测后两次 WebSocket 收到 `full-reload`，不等于浏览器刷新完成耗时 |
| HMR Python OCR 通知 | 62–2179 ms | 修正 Windows 路径匹配后两次收到对应文件的 `full-reload` |
| HMR 前端 OCR parser 通知 | 55 ms | 收到 `recognize.ts` 对应的 `full-reload` |
| Python OCR 更新后的 worker | 已停止 | 更新前 `workerStarts=1`、`requests=2`；更新后 `started=false`，下一次请求创建新 worker |

测量脚本：`.\.venv-ocr\Scripts\python.exe scripts/profile-local-ocr.py http://127.0.0.1:5173`。

浏览器自动化连接连续返回 `nodeRepl.fetch request failed`。因此**还没有修复前/后的浏览器首屏时间，也不能认定哪个阶段占浏览器启动时间最多**。旧页面在预测模式中无法完成首次渲染。以下数据是构建产物大小，不是浏览器耗时：原主 JS 521.98 kB；当前 main 500.16 kB，OCR parser 14.41 kB 延迟加载，入口 1.38 kB、共享 preload 3.37 kB、共享兵种数据 9.41 kB。主模块仍有大于 500 kB 的构建警告。无 OCR 模型文件被打入首页。

Edge 手动验收：

1. 打开 5173，按 F12 → Console，确认页面和 A/B 识图区出现且无 ReferenceError。
2. 不上传图片，打开 `/__pvp/ocr-status`，确认 worker 未启动（如先前已识图，需重启现有唯一 dev 实例才有冷启动状态）。
3. 分别普通进入、Ctrl+R、Ctrl+Shift+R，在每次完成后执行 `pvpStartupPerformance()`，记录返回 JSON。它含 navigation、JS resource 时序、main 初始化、首轮 render、UI 可交互、双 requestAnimationFrame 后可见 UI，以及 DOM 数量。
4. Network → WS 应显示 Vite 连接，Console 应显示 `[vite] connected`。修改 main.ts 后应收到更新/刷新；OCR 脚本变更后下一次上传使用新 worker。
5. 优化器未打开时 `.hero-pool-row` 数量为 0；识图详情关闭时 `[data-scope="report-field"]` 数量为 0。展开后创建，关闭后移除。
6. 第一次、第二次上传同一图片，Console 读取 `[perf] OCR upload to preview` 和 `[perf] OCR backend`，第二次 `engineReused` 应为 true。

开发模式性能日志包括 main loaded、state restored、initial render start/end、report importer render、optimizer render。普通打开页面不会产生 OCR 识别日志。恢复配置不会自动跑 Monte Carlo、优化或识图。

## 回归检查

`typecheck`、`lint`、`build` 通过；全量 Vitest 735 项，734 项通过。启动兜底、保存预测配置首屏不构建 BattleState、折叠内容按需生成、OCR 与配置相关测试通过。本轮开始前已有的 `rallyBodySkill.test.ts` 重复车身英雄测试仍失败，原因是战斗状态创建处要求 heroId 唯一；本轮未调整该战斗规则。
