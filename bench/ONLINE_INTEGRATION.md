# 线上（GitHub Pages）接入复核 · ONLINE_INTEGRATION.md

卡：t_71b9d753 · 日期 2026-10-05 · 作者 programmer
被测对象：**已部署的线上站点** `https://crest10086.github.io/xiangqi/`，被测 commit `c43acbf`
（= 本地 master = `origin/master`，`git push --dry-run` 回 `Everything up-to-date`）。

> 阶段 1/2（参数一致性、四档单调可区分、两条路径、懒加载）**不在本文里重复**：
> 独立验证结论只有一份正文，在 `E:/hermes-mem/programmer/projects/xiangqi/tests/t_4ac0c5ea-verify.md`
> （7/7 复现，判定"通过"）。本文只做那张卡明确不做的部分：**真实线上 Pages 实测** +
> **把生成器/探针脚本纳入 git**。
> 本机桌面的接线与延迟数据在 `production-engine-integration-2026-10-05.md`（实现方）与
> `TIER_DESIGN_FINAL.md`；本文是**线上部署**这一层，两者不互相替代。

---

## 0. 结论（先看这个）

| 项 | 结论 |
|---|---|
| 线上文件 = 仓库 HEAD？ | **是**。17/17 个浏览器会加载的文件，线上字节 SHA-1 与 `git ls-files -s` 的 blob id 逐个相同（`check_pages_parity.js`，`PARITY ALL-IDENTICAL`） |
| 线上能否跑通完整强度引擎？ | **能**。冷启动（无 SW、无隔离头）→ coi-serviceworker 补 COOP/COEP → 重载 → `coi=true sab=true threads=4` → 50,706,378 B 完整网络加载成功 |
| 四档在线上是否仍按定案参数、仍可区分？ | **是**。4 次 smoke 共 64 行 `SEL|…` 全部出现：三档 300ms/MPV8/Hash64 出 depth 10–16、nodes 49–66 万、`hit=cap|rand|bmiss|above`；大师 MPV1/2000ms/Hash256 出 depth 22–28、nodes 322–394 万、恒 `hit=best gap=0`（逐档统计见 §4.2） |
| 非法局面之后是否恢复正常？ | **是**。`CHECK|BADFEN|×4|rejected=1|critical=1` 后 `RECOVER|OP00|ok=1`、`RECOVER|OP04|ok=1` |
| 真机/手机 | **仍未测**（本机无设备、无 adb）。CPU 节流 ×4 被实测证明**不能**当弱设备替身（见 §5） |
| 生成器是否已在 git | **早已在**（`bench/new_engine/gen_tier_config.js`，blob `b6fe0c4`）。真正的漏洞是 `cdp_run_probe.js` 被 `.gitignore` 的 `cdp_*.js` 排除，而 `run_ui_probe.sh` 按文件名依赖它 → 已修（§7） |

---

## 1. 新增的线上探针（这是本卡交付的工具）

之前所有探针都跑**本地服务器**（`serve.js` 自己发 COOP/COEP，或 `serve_upg.js` 本地不发），
没有任何一个跑过真实部署。补的三个文件：

| 文件 | 作用 |
|---|---|
| `bench/new_engine/cdp_pages_probe.js` | 用 CDP 驱动**线上页面**：记录主框架导航次数、`Cross-Origin-*` 响应头、逐资源传输计时、JS heap；smoke 模式轮询页面自己的 `#log`（页面被重载会清空日志，所以快轮询 + 按顺序并集去重）；ui 模式跑 `ui_probe_expr.js` 并在重载后自动重投探针 |
| `bench/new_engine/run_pages_probe.sh` | 起 headless Chrome（**只开 CDP 端口，不起任何本地服务**）跑线上 URL；`COLD=0 PROFILE_DIR=…` 可测"回头客"（SW 已注册）路径；`THROTTLE=n` CPU 节流；日志落 `bench/new_engine_logs/pages_<mode>.log` |
| `bench/new_engine/check_pages_parity.js` | 线上字节 vs 仓库 blob SHA-1（`sha1("blob <len>\0"+bytes)`）逐文件比对，防"测的是 HEAD、线上是旧构建" |
| `bench/new_engine/run_pages_mem_sample.sh` + `bench/engine_upgrade_evidence/chrome_working_set.ps1` | 页面侧内存 API 不可用时，改从 Windows 采样 Chrome 进程组工作集（见 §4） |

```bash
node bench/new_engine/check_pages_parity.js                       # 线上 == 仓库 HEAD？（§2）
bash bench/new_engine/run_pages_probe.sh smoke 9439 200          # 线上四档接线 + COI 重载（默认冷启动）
COLD=0 PROFILE_DIR='C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-pages-warm' \
  bash bench/new_engine/run_pages_probe.sh smoke 9441 200        # 回头客（SW 已注册）
THROTTLE=4 bash bench/new_engine/run_pages_probe.sh smoke 9439 200   # CPU 节流（结论见 §5）
bash bench/new_engine/run_pages_probe.sh ui 9443 240             # 真实 UI 路径（index.html 四档对局）
bash bench/new_engine/run_pages_mem_sample.sh 9427 260           # OS 侧内存采样（§4.3）
```

---

## 2. 部署一致性（先决条件，不成立则后面全部无意义）

```
HEAD=c43acbf5b654d357541b82a22513338da0ea3bc0  files=17
OK index.html 18810 / engine.js 21149 / coi-serviceworker.js 6028 / online_smoke.html 4937
OK js/tier_config.js 1542 / js/tier_rules.js 8475 / js/pikafish_bridge.js 18640
OK js/book.js 305699 / js/xqbook.js 4874
OK js/engines/pikafish/{pikafish.js 80121, pikafish.wasm 662419, pikafish.worker.js 9893, pikafish.nnue 50706378}
OK js/engines/pikafish/legacy/{pikafish.js 52948, .wasm 488035, .data 4134154}
OK xiangqi.html 6597915
PARITY ALL-IDENTICAL
```

- 线上 `Last-Modified: Sun, 04 Oct 2026 21:51:28 GMT`，与 `c43acbf` 的推送时间一致。
- 50.7MB 网络**已经在线上**（`Content-Length: 50706378`，`Accept-Ranges: bytes`，`Cache-Control: max-age=600`，
  Range 请求回 206，`X-Cache: HIT`，`x-github-edge-region: japaneast`）。
- 仓库侧：`pikafish.nnue` 作为普通 blob 在 git 里（`git check-attr filter` → unspecified，无 LFS）。
  全仓 tracked 内容合计 **130,465,844 B（401 个文件）**，`.git` 119MB。GitHub Pages 的软限是
  **100 GB/月带宽、建议 1 GB 站点**（docs.github.com/pages/getting-started-with-github-pages/github-pages-limits）
  → 站点体积没问题；带宽角度 **100GB ÷ 50.7MB ≈ 1972 次完整首访/月**（缓存命中不算）。
  体积/LFS 的最终决定仍不在本卡判。

---

## 3. 线上真实首访（冷）：COI 重载路径

冷启动做法：先注销该 origin 的 service worker、清 `sessionStorage.coiTries`，再导航——即真访客的第一次。

```
NAV 0.3s https://crest10086.github.io/xiangqi/online_smoke.html
NAV 0.5s https://crest10086.github.io/xiangqi/online_smoke.html      ← coi-serviceworker 强制的重载
coiTries=2  →  SMOKE start coi=true sab=true
READY=true ms=2093 env={"coi":true,"sab":true,"threads":4} net={"netBytes":50706378}
```

隔离头**来自站点根的 coi-serviceworker.js**（GitHub Pages 自己不发这两个头，实测 `curl -I` 无 `Cross-Origin-*`）。
证据是页面内 `fetch(location.href)` 被 SW 接管后拿到的头：

```
{"status":200,"type":"basic","swControlled":true,
 "headers":{"cross-origin-embedder-policy":"require-corp",
            "cross-origin-opener-policy":"same-origin",
            "cross-origin-resource-policy":"cross-origin"}}
```

多次冷启动的 `coiTries` 落在 1–2（上限 2）：重载一次就隔离成功是常态，两次是偶发。
**代价**：冷首访多一次文档请求 + 多一次脚本执行；`index.html` 上表现为第一次点"新对局"时页面会自己刷新一次。
**边界**：若某浏览器 2 次重载内 SW 仍未接管，`ensureIsolated()` 返回 false →
`浏览器未隔离，多线程引擎不可用` → 走内置 AI 兜底（这是设计好的降级，不是崩溃）。

回头客（`COLD=0`，SW 已被上一轮注册）：**1 次导航、不重载**，`coi=true`（`coiTries` 为空，说明
`ensureIsolated()` 第一句就返回了 true），`READY ms=2030`，16 行 SEL 全部正常。

---

## 4. 线上的代价实测（桌面 5700X 类主机，4 线程）

### 4.1 下载与首载

| 测法 | 数字 |
|---|---|
| `curl` 直接拉 `pikafish.nnue` | 50,706,378 B，总 1.43s，35.5 MB/s，connect 0.09s，TTFB 0.53s |
| 浏览器内引擎就绪（`PF.whenReady()`，含下载+WASM+initialize） | 冷启动 **2093ms**（`pages_smoke_cold_visit.log`）；回头客 **2030ms**（`pages_smoke_warm_visit.log`）；UI 探针 `firstLoadMs` **2199 / 2313ms**（`pages_mem_sample.log` / `pages_ui.log`）。本卡全部运行都在 1.6–2.4s 这一档 |

对照实现方留档的本机数字 600–628ms：那是**局域网自建服务器**的数，线上真实首载是它的 **3–5 倍**。
这条要写进口径：对外说"首载 0.6s"只适用于自建/内网，Pages 上应按 **2–4s** 规划（一次/会话，懒加载后才发生）。

### 4.2 每手延迟与搜索量（线上 SEL 行，与本地台架同口径）

| 档 | wall | depth | nodes | 参数（线上读到的） |
|---|---|---|---|---|
| 业余 | 302–305ms | 11–16 | 56.0–65.7 万 | cap80 p0.5 band200 @ MPV8/300ms/Hash64 |
| 进阶 | 303–305ms | 10–15 | 54.0–65.6 万 | cap80 p0 band200 @ MPV8/300ms/Hash64 |
| 高手 | 303–306ms | 10–15 | 49.4–63.9 万 | cap25 p0.1 band200 @ MPV8/300ms/Hash64 |
| 大师 | 2010–2011ms | 22–28 | 322–394 万 | MPV1/2000ms/Hash256 |

（上表是 4 次 smoke 运行、每档 16 行 `SEL|…` 的并集，按 `|` 字段解析后取 min/max，不是单条样本。
参数列在 16 行里恒定不变 → 线上读到的就是定案参数。低档 `hit` 覆盖 `cap/rand/bmiss/above`，
大师 16/16 恒 `best gap=0`。）

`nps` 1.90M–2.13M。UI 侧真实等待（每档 4 手累计，轮询粒度 200ms）：业余/进阶/高手 **1600ms**（≈400ms/手），
大师 **6800ms**（≈1700ms/手），
四档 `src` 全为 `engine`、`engineLastError: null`、无卡死。语义与定案一致（`hit=cap/rand/bmiss/above`，大师恒 `best gap=0`）。

### 4.3 内存（页面侧 API 不可用，改用 OS 采样）

- `performance.memory`（**只有主线程 JS heap**）：2–3MB —— 引擎在 worker 里，这个数**不含**引擎，别拿它当站点内存。
- `performance.measureUserAgentSpecificMemory()`：函数存在但**在 headless Chrome 里 60s 内不 resolve**（实测两次），
  所以页面侧拿不到"页面+worker"总量。这是**工具限制**，不是页面缺陷。
- 替代做法：跑真实 UI 探针的同时，每 2s 采样 Chrome 进程组工作集（`run_pages_mem_sample.sh`）：

```
t=  0.6s   546 MB  (9 procs, 页面刚起，引擎未加载)
t=  8.3s   643 MB  ← 引擎开始加载（10 procs）
t= 13.5s  1465 MB  ← 50.7MB 网络 + WASM + Hash256 TT 就位
t= 26.6s  1473 MB  (峰值)
t= 36.8s  1395 MB
t= 42.0s  1318 MB
t≥ 67.8s  1306 MB  (稳态，四档对局跑完后不再回落)
```

即 **引擎就位带来 ~+0.9GB 峰值、~+0.76GB 稳态**（含 Chrome 自身开销，不是单标签页净增量）。
与台架侧的 WASM heap 547MB（`NEW_ENGINE_TIER_CALIBRATION.md` §8，"内存成本来自 Hash 不是 movetime"）方向一致：
浏览器在 WASM 堆之外还要再叠一层。**这条是桌面数字，不可外推到手机。**

---

## 5. CPU 节流 ×4 不是弱设备替身（负向结论，别再这么测）

`THROTTLE=4`（CDP `Emulation.setCPUThrottlingRate`）下跑线上 smoke：

```
READY=true ms=1647  （不节流时 2030–2293，同一量级）
SEL|OP00|业余|wall=305|depth=13|nodes=596656   进阶 wall=304|depth=14|nodes=558027
SEL|OP00|高手|wall=303|depth=12|nodes=494079   大师 wall=2011|depth=23|nodes=3223412
nps 1958704 / 1978440  （不节流时 1899146 / 2132561）
```

引擎跑在 worker 的 pthread 线程上，**主线程节流管不到它**，所以"×4 慢设备"对棋力/节点数的影响为 0。
要测弱设备只有两条真路：
1. **真机**打开已部署的自检页 `https://crest10086.github.io/xiangqi/perf_probe.html`（已确认线上在位，200 / 2118 B），
   它会给"本机搜索量占桌面基准的百分比"和对应建议；
2. 接真机跑 `run_pages_probe.sh`（本机无 adb、无设备，本卡没做）。

---

## 6. 仍未做 / 已知边界（不许淡化）

1. **手机/真机的内存与首载仍是空白**。`tier_tiers.json` 里大师仍带 `status: "pending-real-device"`；
   本卡只补上了"线上桌面"这一格。
2. **单文件版（`xiangqi.html`）仍用定案前的 legacy 参数**，且线上那份与本地构建逐字节相同（已核对）。
   它和线上多文件版**不同档**是已知设计，不是缺陷，但对外要讲清楚。
3. 线上有两条**无害但存在**的失败请求：`favicon.ico` 404（`index.html` 没声明 favicon，浏览器自动要）；
   smoke 页的 `POST /__log` 在 Pages 上回 405（Pages 不接受 POST；日志因此只存在于页面 DOM，
   探针必须从 DOM 读——`cdp_pages_probe.js` 就是这么做的）。想干净：加 `<link rel="icon" href="data:,">`，
   并把 smoke 页的日志改成纯 DOM 输出。
4. 50.7MB 网络进 git 带来的仓库体积（`.git` 119MB）没有在本卡处理，需要单独决定（LFS / 部署期 fetch）。

---

## 7. 生成器与脚本纳入 git（本卡的第二项交付）

- `bench/new_engine/gen_tier_config.js`、`tier_tiers.json`、`test_tier_config.js`、`run_online_smoke.sh`、
  `run_ui_probe.sh`、`run_single_probe.sh`、`ui_probe_expr.js`、`online_smoke.html` **本来就在 git 里**
  （`git ls-files` 逐个确认）。这条不需要做，只需要知道它成立。
- **真正的坑**：`.gitignore` 里的 `cdp_*.js` 把 `bench/new_engine/cdp_run_probe.js` 排除了，
  而 `run_ui_probe.sh`/`run_single_probe.sh` 按文件名调用它 —— 新克隆的仓库跑不了这两个探针。
  已加显式例外（`!bench/new_engine/cdp_run_probe.js`、`!bench/new_engine/cdp_pages_probe.js`），
  并把本卡新增的 `cdp_pages_probe.js`、`check_pages_parity.js`、`run_pages_probe.sh`、
  `run_pages_mem_sample.sh`、`count_pages_chrome.ps1`、`chrome_working_set.ps1` 一并纳入版本控制。
- 回归确认（改动后重跑，未新增失败）：`node bench/new_engine/test_tier_config.js` → **35 passed, 0 failed**；
  `node bench/new_engine/gen_tier_config.js` 重写后 `git diff js/tier_config.js` 只有 `"generated"` 时间戳一行，
  已 `git checkout` 还原（与 t_4ac0c5ea 报告的处理方式一致）。

---

## 8. 证据文件（都在仓库里）

| 文件 | 内容 |
|---|---|
| `bench/new_engine_logs/pages_smoke_cold_visit.log` | 冷首访 smoke（2 次导航、coiTries=2、16 行 SEL、4×BADFEN 拒绝、2×RECOVER） |
| `bench/new_engine_logs/pages_smoke_warm_visit.log` | 回头客 smoke（1 次导航，无重载） |
| `bench/new_engine_logs/pages_smoke_cpu4x.log` | CPU 节流 ×4（§5 的负向结论） |
| `bench/new_engine_logs/pages_ui.log` | 线上真实 UI 探针（四档全 engine、firstLoadMs、waitedMs、tierParams） |
| `bench/new_engine_logs/pages_memory.log` | 页面侧内存 API 的实测结果（UAMEM 60s 不 resolve） |
| `bench/new_engine_logs/pages_mem_sample.csv` + `.log` | OS 侧内存采样曲线（§4.3） |
