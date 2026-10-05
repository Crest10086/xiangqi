# 两项补充：生成器 cap 单调断言 + perf_probe 内存/线程/首载自检（t_0918db73，2026-10-05）

两张卡的要求：
1. `gen_tier_config.js` 补一条 **cap 单调性断言**（不依赖拟合模型，纯参数级）；
2. `perf_probe.html` 增加 **内存 / 线程 / 首载** 自检，供手机真机自测。

输入证据（用户 2026-10-05 09:03，看板评论）：手机打开线上
`https://crest10086.github.io/xiangqi/perf_probe.html`，状态先「加载中…」后「引擎加载失败」。
→ 本卡把它变成验收标准：**失败必须说得出原因；成功必须给出内存/线程/首载数字，且口径能和 bench 对齐。**

---

## 1. cap 单调性断言（bench/new_engine/gen_tier_config.js）

### 为什么现有闸门不够
`tier_decide.js` 和 `gen_tier_config.js` 原本只有一条单调性闸门：
读 `tier_tiers.json.predictedLoss`，检查 `大师 < 高手 < 进阶 < 业余`。
那个数字是**拟合模型的输出**，要 `tier_fit_out.json` + `new_engine_logs/tier_analysis*.json` 才算得出来。
一个普通 clone 只有 `tier_tiers.json`（401 文件里的一个），没有日志和 fit 文件——
这时手改 `tier_tiers.json`（把 高手 cap 从 25 改成 90、或给某一档加 movetime）能一路走到 `js/tier_config.js` 而没有任何东西报警。

### 新闸门 `capLadderGate(levels, src)`（纯参数，零依赖）
写在生成器里并导出，`test_cap_gate.js` 直接调它。检查八条：

1. 每个存在的旋钮都是有限数：`cap >= 0`、`0 <= p < 1`、`mistakeBand > 0`；
2. 大师是天花板不是档位：不许有 cap / p，必须 MultiPV 1；
3. 三个引擎档共用**同一个**搜索预算（multipv 相同且 >1、movetime 相同、hash 相同），
   并且与决策文件里的 `fixedSearchBudget` 一致 —— 谁单独改了 movetime，就是把搜索预算塞进了阶梯
   （`bench/FINAL_REPORT.md` 基准三之二 实测搜索量不是强度旋钮）；
4. cap 阶梯单调：`cap(高手) < cap(进阶) <= cap(业余)`（业余与进阶同 cap 是契约明文：稳定强度相同、只差 p）；
5. **可达最差着法** `cap + mistakeBand` 同样单调 —— 强档的 band 更大就会让它下出比弱档最差着法更差的棋；
6. 两档不能是**同一条规则**（cap/p/band/各 override 全同）：五档 UI 会静默变成"有一档和另一档完全一样"；
7. 相邻两档 cap 相同时，必须靠 p 区分且方向正确（弱档 p 严格更大）；
8. `hardCap <= cap`：少子形永远不能比常规形更松（hardCap 0 是实测安全值）。

`openingCap` / `openingMistakeBand` 是逐形覆盖、各有自己的实测值，只做类型检查，**故意不进**排序断言。

### 实测：闸门对真决策文件通过，对四种手改都报警并拒绝写文件
```
$ node bench/new_engine/gen_tier_config.js
cap gate PASS  cap 0 < 25 < 80 < 80  reachable 0 <= 225 <= 280 <= 280  p -/0.1/0/0.5  budget 8/300ms/Hash64 == 8/300ms/Hash64 == 8/300ms/Hash64
wrote C:\Users\35165\xiangqi\js\tier_config.js
```
把 `高手.cap` 改成 90：
```
ABORT: cap monotonicity gate FAILED
  - cap ladder not monotone: cap(高手)=90 must be < cap(进阶)=80
  - reachable worst move not monotone: 高手 290cp must be <= 进阶 280cp (cap+band would let the stronger tier play a worse move than the tier below it)
```
把 `高手.movetime` 改成 1500：
```
ABORT: cap monotonicity gate FAILED
  - the three engine tiers must share ONE search budget, got 业余 8/300ms/Hash64 vs 进阶 8/300ms/Hash64 vs 高手 8/1500ms/Hash64
  - 高手(level 3): movetime 1500 != fixedSearchBudget 300
```
两次 ABORT 都没有写 `js/tier_config.js`（生成器改成 `require.main === module` 才写盘，
所以测试文件 `require()` 它不会有副作用）。改完把 `tier_tiers.json` 还原，`git status` 干净。

生成文件本身没有参数漂移：`git diff js/tier_config.js` 只有 `"generated"` 时间戳一行，已 `git checkout` 还原。

### 单测 `node bench/new_engine/test_cap_gate.js` → 22 passed, 0 failed
14 个必须被拒绝的构造（进阶<高手、高手==进阶、业余==进阶同规则、band 0、band 过大、
单独改 movetime/Hash/MultiPV、hardCap>cap、大师给 cap、大师 MultiPV>1、p 越界、cap 是字符串、
缺 cap、band 为负）+ 与 `fixedSearchBudget` 不一致 + **删掉 predictedLoss 仍然能跑**（证明它不依赖模型）。

---

## 2. perf_probe 自检页（perf_probe.html + 引擎/桥接的诊断出口）

### 改了什么（三处，都在生产文件里）
- `js/engines/pikafish/pikafish.worker.js`：新增 `COST`（首载分阶段累计毫秒，与台架 `worker_mb.js` 的 `stamp()` 同口径）、
  `HEAP`（`HEAPU8.length` = 引擎真实内存，与台架 `tier_driver.html` 的 `HEAP|` 行同口径）、
  `HEAPREQ`（主线程主动采样一次）、`ENV.hc`（设备报告的 CPU 数）、`ENV.threads` 改成**实际**拿到的线程数
  （原来报的是请求值）。`importScripts('pikafish.js')` 失败时抛**具名**错误，不再只剩"引擎线程异常"。
- `js/pikafish_bridge.js`：把这些落到页面能读的地方 —— `PF.lastCost.stages` / `PF.lastHeap` / `PF.requestHeap(tag)` /
  `PF.lastLoadError`（`whenReady()` 原来把 reject 吞成 `false`，现在原因留下）。
- `perf_probe.html`：先打印**环境**（UA / 安全上下文 / crossOriginIsolated / SharedArrayBuffer / coiTries /
  `navigator.hardwareConcurrency` / `navigator.deviceMemory`）再加载引擎；失败时打印真实原因 + 按环境推断的判据
  （未隔离 / 无 SAB / 超时 / 初始化失败 / 资源 404 / worker 异常）；成功时打印首载分阶段（对照 bench 记录的桌面基准）、
  引擎 WASM 内存、实际线程数、引擎就绪耗时；再加**大师档自检**（`tierSearch(4)` = MultiPV1/2000ms/Hash256，
  正是 `tier_tiers.json.大师.status = "pending-real-device"` 等的那台真机数字）；末尾一键复制整份报告。
  `?auto=1` 时自动跑一遍，只给 headless 探针用（人和手机仍需按按钮，行为不变）。
- `bench/new_engine/run_perf_probe.sh`：把本页当作可自动化的自检来跑（复用 `cdp_pages_probe.js`，
  `DONE_MARK='自检 DONE'` / `FAIL_MARK='自检 FAIL'`）。`MODE=local` 用 `serve_slow.js` 起本地服务（可控下载速率），
  `MODE=live` 直接跑线上；`ROOT=` 可指向裁剪过的目录用来制造加载失败。

### 顺带修掉的一个真 bug
旧页打印的 `…k 节点/秒` 是 `nodes / 实测毫秒 / 1000`，即**节点/秒被再除以 1000**。
本机 500ms 档 885,312 节点被写成 "2k 节点/秒"（真值 ≈1.7M 节点/秒）。现在按 `nodes/ms*1000` 打印。
这条被 `test_perf_probe.js` 锁住（断言里明确写了 "fixed: the old code printed nodes/1000"）。

### 桌面实测证据（本机 headless Chrome，`bash bench/new_engine/run_perf_probe.sh 9374 220`）
日志已入库：`bench/new_engine_logs/perf_probe_local_desktop.log`（`perf_probe.log` 是同名固定文件，会被后续运行覆盖）。

成功路径（`RATE=104857600`，即本地不限速）：
```
引擎已就绪，本页等待 495ms
引擎侧环境: crossOriginIsolated=true SharedArrayBuffer=true 实际线程=4
首载分阶段(累计ms | 桌面基准ms):
importScripts / wasmModule / netDownload / nnueFsWrite / engineInitialize  → 本次 25 / 59 / 146 / 158 / 460ms
引擎 WASM 内存(初始化后): 307.3MB（桌面基准 307MB）
500ms -> depth 19 节点 885678 (1753818/秒) 引擎内存 307.3MB
2000ms -> depth 23 节点 3388282 (1692449/秒) 引擎内存 547.0MB
6000ms -> depth 27 节点 10324310 (1719858/秒) 引擎内存 547.0MB
tierSearch(大师) -> 着法 c3c4 hit=best depth 22 节点 3403640 (1693353/秒, 实际等待 2010ms) 引擎内存 547.0MB
引擎 WASM 内存(Hash256 大师档): 547.0MB（桌面基准 初始化 307MB → 搜索中 547MB）
```
逐项对得上 bench 记录：初始化后 **307.3MB vs 记录 307MB**、大师档 **547.0MB vs 记录 547MB**、
大师档 2000ms **3,403,640 节点 vs r5 十位置均值 3,447,290（−1.3%）**、wall 2010ms vs 线上 SEL 的 2009–2011ms。
→ **新加的内存/线程/首载读数与既有 bench 口径一致，不是另造一套数字。**

慢下载路径（默认 `RATE=4194304` = 4MB/s，模拟弱网）：`netDownload = 12140ms`，引擎就绪 12,497ms，
其余阶段不变 → 首载变慢时页面能指出**慢在哪一段**（这是原来「加载中…」给不出的信息）。

失败路径（`ROOT=` 指向一个缺 `js/engines/pikafish/*` 的裁剪目录）：
```
=== STATE === FAIL (1.9s)
引擎加载失败（等待 3ms）：引擎线程异常
失败原因判断：
1. 引擎 worker 线程异常退出：常见是 WASM 分配失败或浏览器拒绝了 pthread（见上面的引擎原文）
自检 FAIL
```
页面**没有**再停在笼统的"引擎加载失败"，而是给了可复述的判据 + 完整环境行。
（`importScripts` 具名错误在单测里锁住；浏览器侧这条走的是 worker 顶层 error 监听，措辞仍偏保守。）

### 单测 `node bench/new_engine/test_perf_probe.js` → 33 passed, 0 failed
不是 grep 断言：worker 在 stub 的 worker 环境里**真跑一遍 INIT**，验证
`ENV.threads` 是实际值（请求 8 线程 / 4 核设备 → 报 4）、五段 `COST`、`HEAP` 的 `ready` 与 `HEAPREQ` 应答、
下载失败回 `HTTP 500`、缺引擎脚本回具名错误；桥接侧验证 `COST/HEAP/ERROR` 落到 `PF.lastCost.stages` /
`PF.lastHeap` / `PF.lastLoadError`、`requestHeap` 真发 `HEAPREQ`、未隔离时 `whenReady()` 回 false **且原因非空**
（实测 `lastLoadError = "浏览器未隔离，多线程引擎不可用"` —— 正是手机那次失败最可能的原因）。

### 回归（全部复跑通过）
```
test_tier_config 35/0   test_ui_wiring 32/0   test_tier_rules 29/0   test_cap_gate 22/0   test_perf_probe 33/0
```

---

## 仍未做 / 边界
- **手机真机数字仍然没有**：本机无 adb、无设备。`t_aeedc0a1`（真机复核）保持 blocked。本页现在做的是
  "让手机上跑一次就能把该抄的数字抄回来"（含复制按钮），不是替手机测。
- 页面里的内存是**引擎自己的 WASM 线性内存**，不含浏览器进程；桌面 OS 侧采样（546→1473→1306MB）是另一口径，
  两者不要混用。`performance.measureUserAgentSpecificMemory()` 在 headless 仍不 resolve（既有结论不变）。
- 大师档的 `pending-real-device` 状态**没有**因为这次桌面复跑而解除——解除要真机数字。
- `?auto=1` 只用于探针；线上人工访问路径不变。
