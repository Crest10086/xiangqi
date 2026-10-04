# 完整强度象棋引擎接入可行性 — 三条路线实测报告

日期: 2026-10-03 · 任务: kanban t_67b32d95 · 实验机: 192.168.10.99 (5700X, 16 逻辑核, Chrome 154.0.8037.93 headless)
统一测试局面 (全部实验): `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1`

---

## 0. 结论摘要（先说答案）

| 路线 | 可行性 | 棋力提升(实测) | 手机端 | 改动量 |
|---|---|---|---|---|
| ① 浏览器 WASM 完整构建 (mistboard pikafish-wasm v0.1.0) | **可行**（Pages 上需 coi-serviceworker 一次重载） | 4线程 **8.6–9.0×** 节点 / +4~7 层；单线程 **2.0–2.2×** | Pages 全域可用；首载 50.7MB 需懒加载 | ~150–250 行 + 50.7MB 网络文件 |
| ② 自编译 Pikafish WASM | **已完成**（两个变体都编出来了；单线程变体需小补丁才能跑） | 同 ①（与 mistboard 版差 <1%） | 同 ① | 已投入：emsdk 2.1GB + ~1 分钟编译 |
| ③ HTTP 服务（.100 原生引擎常驻） | **可行（仅限内网/自建页）**；Pages 直连被浏览器双重拦截（已实测） | **31–38×** 节点 / depth 23→30 | 内网可用（RTT 1.2ms）；外网需隧道/VPS | 服务端已原型完成；前端 ~100 行 |

**推荐: 路线① 为主线**（Pages 保持在线、纯客户端、8.6× 提升、改动可控）；
**路线③ 作为"内网完整棋力"第二入口**（31×+，家里/内网用，延迟 ~1ms）；
路线② 的价值 = 供应链自主（打补丁/改选项/复现构建）。

---

## 1. 基准对照：当前线上 WASM（小网络）

`js/engines/pikafish/`: pikafish.js 54,945B + pikafish.wasm 488,035B + pikafish.data 4,134,154B (含 8MiB 小网络 (4320,1024,15,32,1))，单线程，无 pthread。

本次在 headless Chrome 同环境复测（与任务卡既有数据一致）:

```
BENCH cur 500ms  -> depth 15 nodes  92,589–100,787   (卡内基线: depth 14 / 9.7万)
BENCH cur 2000ms -> depth 17–18 nodes 401,052–429,089 (卡内基线: depth 19 / 41.7万)
BENCH cur 6000ms -> depth 21–22 nodes 1,242,270–1,267,692 (卡内基线: depth 22 / 120万)
```

---

## 2. 路线①：浏览器 WASM 完整构建（mistboard `brianhliou/pikafish-wasm` v0.1.0）

来源: GitHub release v0.1.0（mistboard.com 分析引擎的生产构建）。
- pikafish.wasm 662,419B (sha256 `b437f89c…a83b1`), pikafish.js 80,121B
- 网络 pikafish.nnue **50,706,378B** (zstd 压缩, 解压后 66MB, 内存中解压), sha256 `7d13d735…b900e`（与官方 master-net 一致）
- 引擎自述: `Pikafish dev-20260922-nogit` + `NNUE evaluation using pikafish.nnue (64MiB, (62083, 1024, 32, 32, 1))`
- 构建: emsdk 3.1.74, 源码 6a59ee2f + source.patch (59 行: 增加 `pikafish_initialize/pikafish_command` C 入口)

### 2.1 实测数字（headless Chrome, .99, 同一 FEN）

```
4线程 (Threads=4):
  BENCH mb4 500ms  -> depth 18–20 nodes  821,501–851,520
  BENCH mb4 2000ms -> depth 22–23 nodes 3,441,437–3,492,864
  BENCH mb4 6000ms -> depth 27–28 nodes 10,641,806–10,734,249

单线程 (Threads=1):
  BENCH mb1 500ms  -> depth 18 nodes  199,155–215,602
  BENCH mb1 2000ms -> depth 21–23 nodes 821,358–877,295
  BENCH mb1 6000ms -> depth 25–27 nodes 2,485,982–2,584,120
```

相对当前 WASM 的倍数（取最近一轮同场数据）:

| 时间 | 当前 WASM | mistboard 4线程 | 倍数 | mistboard 单线程 | 倍数(同线程) |
|---|---|---|---|---|---|
| 500ms | 92,589 / d15 | 836,819 / d19 | **9.0×** | 199,155 / d18 | **2.15×** |
| 2000ms | 401,052 / d18 | 3,482,386 / d23 | **8.7×** | 821,358 / d21 | **2.05×** |
| 6000ms | 1,242,270 / d21 | 10,668,991 / d28 | **8.6×** | 2,485,982 / d25 | **2.00×** |

### 2.2 【必答1】线程因素的剥离（threads=1 对照）

- **同线程倍数（1 vs 1）: 2.0–2.2×，depth +3~4 层** —— 这是"完整网络 + 新版本引擎（2026-09 mainline vs 2024-08 构建）"的合计贡献。
- 线程放大: 4线程/单线程 = **4.2–4.3×**（500/2000/6000ms 分别为 4.20/4.24/4.29×）。
- 分解校验: 2.05 × 4.2 ≈ **8.6×** ≈ 实测总倍数 8.6–9.0×。即：**9.1× 里约 2 倍来自完整网络/引擎，其余 ~4.2 倍来自多线程**。
- 纯网络 vs 引擎版本无法在本机进一步剥离（mainline 2026 引擎只认 arch (62083,…) 网络，喂小网络直接 exit(1)，为卡内既有实测）。旁证：同源自编译版（同网络同源码、不同工具链）与 mistboard 版差 <1%，说明工具链影响极小。
- 定点深度对照（单线程，`go depth N`）——同一深度所需代价:

```
mistboard: d18 -> 242,018 nodes /  689ms;  d20 -> 458,009 nodes / 1,222ms
当前WASM : d18 -> 605,684 nodes / 3,038ms;  d20 -> 899,551 nodes / 4,261ms
```

同深度下完整网络版快 **3.5–4.4×**、省一半节点（评估质量更高，每节点更值钱）。

### 2.3 【必答2】COOP/COEP 硬门槛（决定推荐路线）

**裸 GitHub Pages（无自定义响应头、无任何 hack）: 该构建根本跑不起来。** 实测（headless Chrome + 无头服务器的 Pages 模拟环境）:

```
P1: mistboard engine WITHOUT isolation — attempting init
P1 worker env: sab=false coi=false
P1 RESULT: INIT ERROR: unhandled: DataCloneError: Failed to execute 'postMessage' on 'Worker':
           SharedArrayBuffer transfer requires self.crossOriginIsolated.
```

原因: pthread 构建在模块实例化阶段就要把 shared WebAssembly.Memory（SAB）传给 pthread 工作线程池；`crossOriginIsolated=false` 时 `new WebAssembly.Memory({shared:true})` / SAB 传输直接抛异常。**不是"退化为单线程"，而是 0 线程——无法启动。**

**解法（已实测通过）: `coi-serviceworker.js`**（Guido Zuidhof, MIT, 6KB）——Service Worker 把 COOP/COEP 头注入自身站点的响应，使页面变成 cross-origin isolated。实测在"模拟 Pages（无头）"服务器上:

```
coi test: crossOriginIsolated=false SAB=false
not isolated -> registering coi-serviceworker and reloading
SW registered, reloading...
coi test: crossOriginIsolated=true SAB=true
ISOLATED OK, running engine
BENCH START threads=4 ...  （4 线程跑通，数字见 2.1）
```

- 代价: 首次访问多一次自动重载；依赖 Service Worker（GitHub Pages 是 https，SW 可用；桌面 Chrome/Edge/Firefox 均可）。
- **退化为单线程后还剩几倍？** 用 Threads=1 实测: **2.0–2.2×**（即"完整网络"本身的价值）；多线程 4.2× 会失去。
- **另一种单线程方案（自编译无 pthread 变体）实测也不能直接跑**: 编译产物无 SAB 依赖、能加载 50.7MB 网络，但引擎初始化时 `Failed to create search thread` 退出——上游 2026-09 源码的 Thread 构造函数无条件创建 1 个原生线程，没有"无线程"代码路径。要让它跑需小补丁（把 idle_loop 改为主线程直跑，~20–40 行）；**此补丁未做**（见路线②）。
- iOS Safari 注意事项: coi-serviceworker 在 Safari 15.2+ 理论可用（SAB 支持），但需实测；老版本 iPhone 不支持 SAB。**未实测（无 iOS 设备）**。

### 2.4 【必答3】资源体积与首次加载实测

网络文件: 50.7MB (zstd) → 内存解压 66MB。

实测时间线（LAN 服务器, headless Chrome, 时间戳为 worker 内 performance.now）:

```
importScripts        7ms
wasm 模块实例化      46–48ms
net 抓取完成         164–190ms (LAN 本地服务器 50,706,378B)
FS 写入完成          177–203ms
initialize (zstd 解压 50.7→66MB + 引擎就绪)  531–577ms
=> 引擎 ready 总计   0.54–0.59s（LAN 环境）
```

外网下载实测（本机网络）:
- GitHub release CDN: 49,982,985B / **5.35s** (9.3MB/s)
- GitHub Pages 资产速度: 4,134,154B / **1.01s** (4.1MB/s) → 50.7MB 按 Pages 速度外推 ≈ **12s**
- Pages 缓存头: `Cache-Control: max-age=600`（仅 10 分钟，建议文件名带版本 + SW/CacheStorage 持久缓存）

**内存峰值**（wasm 线性内存 + 进程树 RSS 采样）:

```
wasm heap @ ready              = 322,174,976 B (307 MiB)
wasm heap @ Hash=256 设定后    = 573,571,072 B (547 MiB)   ← 引擎侧峰值
Chrome 进程树 RSS 峰值(4线程 bench 期间, 含 8 个 pthread worker 进程) ≈ 1.59 GB
```

- `performance.measureUserAgentSpecificMemory()` 在本 headless 环境不可用（已尝试，返回 mem-na），故用 heap 字节数 + Windows RSS 采样交叉佐证。
- 对手机端的影响: ① 首载 12s（4.1MB/s 网络）→ 必须懒加载（选到"高手/大师"再下）+ 缓存；② 547MiB wasm heap 对 4GB 以下手机偏重，建议移动端把 Hash 降到 64–128MB（-192~-128MB）；③ 4 线程 worker 在手机上按核心数自动降级（Safari 会限制 worker 数）。

### 2.5 【必答4】接入改动量估计（要改哪些文件、多少行）

1. `js/engines/pikafish/` — 替换 3 个文件 + 新增 1 个:
   - `pikafish.js` 80KB / `pikafish.wasm` 662KB 换新（同目录同名可保留）
   - 新增 `pikafish.nnue` 50.7MB（zstd 网络；不再需要 4.13MB 的 `.data`）
   - **`pikafish.worker.js` 重写 ~120–150 行**（基于 mistboard 的 worker.js: fetch net 带进度 → FS.writeFile('/pikafish.nnue') → `cwrap('pikafish_initialize')` → 逐条 `pikafish_command`；外层保留现有 INIT/SEARCH/BEST_MOVE/STOP + seq 协议）。
2. `js/pikafish_bridge.js`（219 行）— **~40–70 行改动**:
   - 去掉 5 个失效选项的发送（`Repetition Rule`/`Draw Rule`/`Sixty Move Rule`/`UCI_LimitStrength`/`UCI_Elo`）——新引擎全部回 `No such option: ...`（实测，不崩但无效）。旧引擎的判例/让子强度旋钮在新引擎上**不存在**，需替代方案。
   - **强度档位重建（1/2 档）**: 旧方案 UCI_Elo=1400/1800 失效；新引擎 **MultiPV 可用**（实测 multipv 1–4 全出，见 2.6），可改用"MultiPV 候选池 + 随机挑"复刻弱档失误率（游戏代码里已有候选处理逻辑，见下）。
   - file:// 单文件模式: 50.7MB 网络 base64 内嵌后 xiangqi.html 会到 ~70MB（现 6.6MB），**建议单文件版保留旧引擎或砍掉引擎**（改动 ~10 行判断）。
3. `index.html`（434 行）— **~10–25 行**:
   - 加载 `coi-serviceworker.js`（新增文件 6KB）+ 未隔离时自动重载（3–5 行）；或自建部署时改用 COOP/COEP 响应头（0 行代码，改部署）。
   - `PF.load()` 由页面加载时预热改为"选到重档时懒加载"（~5 行），避免所有人被 50.7MB 拖慢。
4. 资源: 仓库新增 50.7MB 二进制（Pages 单文件上限 100MB、站点 1GB 均满足）；网络许可证为 Pikafish 团队 "legal use only / 非商用需授权"（与现有引擎同源，无新增合规负担）。

**合计: ~150–250 行 + 1 个新 SW 文件 + 1 个 50.7MB 资产。** 另有可选的"补丁版"工作量: 把上游已删除的 `UCI_LimitStrength/UCI_Elo/Skill Level` 移植回自编译构建（~30–60 行，见路线②）。

### 2.6 选项兼容性实测（接入关键风险）

新引擎 UCI 选项全量（dump）: Debug Log File / NumaPolicy / Threads / Hash / Clear Hash / MultiPV / Ponder / Move Overhead / nodestime / UCI_ShowWDL / EvalFile —— **没有** 当前游戏依赖的 Repetition Rule、Draw Rule、Sixty Move Rule、UCI_LimitStrength、UCI_Elo、Skill Level。

发送旧选项序列实测:

```
OPT!! No such option: Repetition Rule
OPT!! No such option: Draw Rule
OPT!! No such option: Sixty Move Rule
OPT!! No such option: UCI_LimitStrength
OPT!! No such option: UCI_Elo
OPT multipv keys seen: ["1","2","3","4"]     ← MultiPV 4 候选可用（旧构建只出 1 条）
OPT bestmove: ["bestmove g3g4 ponder h7g7"]  ← 引擎正常出着
```

影响: (a) 弱档 Elo 限制失效 → 必须改设计；(b) 判例规则（长将长捉）改为引擎内建（源码 `detect_chases/chase_legal` 常开，实测引擎自带处理），行为需回归测试；(c) 新增能力: MultiPV 候选池可用，可做"候选随机化"弱档。

---

## 3. 路线②：自编译 Pikafish WASM（已完成）

环境: `C:\Users\35165\pikafish-src` 源码 + `pkw-build` worktree（6a59ee2f）+ source.patch（59 行，已应用）+ emsdk **6.0.11**（scratch/emsdk，约 2.1GB）。

### 3.1 两个变体都编出来了

| 变体 | 产物 | 编译耗时 | 说明 |
|---|---|---|---|
| pthread（同 mistboard 配置） | pikafish.js 75,939B + pikafish.wasm **635,889B** (sha `fb0728216cab…52cd0`) | ~1 分钟 | 已在 headless Chrome 实测: 500ms→d17/879,020; 2000ms→d23/3,633,557; 6000ms→d26/10,779,640（4线程，与 mistboard 版差 <1%） |
| 无 pthread（单线程尝试） | pikafish.js 61,428B + pikafish.wasm **597,732B** | **60.2s**（实测） | **不能直接跑**: 加载 OK 但引擎初始化 `Failed to create search thread` 退出（上游 Thread 构造无条件建线程）。需 ~20–40 行补丁才能成为真正的单线程构建 |

- em++ 全量编译实测 60s（16 核），成本极低；emsdk 安装（下载+激活 ~2.1GB）为一次性成本。
- 与 mistboard 分布式 wasm 的 sha 不同（工具链 3.1.74 vs 6.0.11），但性能等价。
- **编译产物位置**: `C:/Users/35165/xiangqi/bench/wasm_build/`（本报告附带的 `pkw-build/dist/wasm` 即为 pthread 产物；无 pthread 变体在 scratch 的 `pkw-build/dist/wasm_nothreads/`）。

### 3.2 价值定位

不是"另一条路线"，而是**供应链自主**: 可打补丁（移植回 Elo 限制/做真单线程版）、可固定版本、可复现构建。`bench/engine_upgrade_evidence/build.sh` + `source.patch` 提供完整复现路径。

---

## 4. 路线③：HTTP 服务形态（原生引擎常驻）

### 4.1 .100 上的服务形态（已原型完成并运行中）

- 服务: `engine_http_server.py`（Python 3.12, 标准库 http.server, 线程安全封装）→ 常驻 `pikafish-bmi2.exe`（原生 4 线程, Hash 256）。
- 接口: `GET /healthz` → `{"ok":true}`；`GET /move?fen=…&ms=…` → `{move, depth, nodes, score, wall_ms}`；CORS `*` 已开。
- 端口 8899，防火墙规则 `pikafish-http-8899-test` 已加；启动/重启脚本（SSH + WMI 独立进程）已就绪；**注意: 目前重启后不自启，需要加计划任务才算生产级**。
- 实测（从 .99 打过去）:

```
HTTP .100  500ms -> wall 507.9ms (server 506ms) depth 23 nodes  3,546,930
HTTP .100 2000ms -> wall 2002.3ms (server 2000ms) depth 26 nodes 13,204,093
HTTP .100 6000ms -> wall 6004.9ms (server 6003ms) depth 30 nodes 38,410,036
healthz RTT: min 0.93 / med 1.23 / max 1.96 ms   （网络开销可忽略）
```

相对当前 WASM: 500ms **38×**、2000ms **33×**、6000ms **31×** 节点；depth d15→d23 / d18→d26 / d21→d30。

### 4.2 Pages 混合内容被拦——已实测，且不止混合内容一层

在真实 `https://crest10086.github.io/xiangqi/` 页面上 fetch `http://192.168.10.100:8899`（headless Chrome + CDP 抓浏览器日志）:

```
[warning] Mixed Content: The page at 'https://crest10086.github.io/xiangqi/' was loaded over HTTPS,
          but requested an insecure resource 'http://192.168.10.100:8899/healthz'. ...
[error]   Access to fetch at 'http://192.168.10.100:8899/healthz' from origin 'https://crest10086.github.io'
          has been blocked by CORS policy: Permission was denied for this request to access the `local` address space.
[error]   Failed to load resource: net::ERR_FAILED
```

两层拦截: ① Mixed Content（http 从 https 页发起，主动内容一律拦）；② Chrome 的 Local Network Access 权限（公网页面访问"本地地址空间"需用户授权，headless 默认拒绝）。对 `http://192.168.10.99:8796`（局域网另一台）同样拦截；对公网 `http://example.com` 也被 Mixed Content 拦。**结论: Pages(https) 无法直连局域网 http 引擎，换 https 也一样过不了 LNA 权限层（Chrome 138+）。**

### 4.3 可落地的替代方案（含实测/成本）

| 方案 | 机制 | 实测证据 | 代价 |
|---|---|---|---|
| **A. 游戏页自建到内网 http**（推荐给"家里用"） | http 页 → http 引擎，无混合内容；LNA 对同源/内网 http 页不拦 | **实测通过**: `http://192.168.10.99:8796` 页面 fetch `http://192.168.10.100:8899/move` → `OK 508ms depth=24 nodes=3,532,390` | 需在内网跑一个静态服务（node/python 均可，5 行）；页面加"引擎地址"配置 |
| B. VPS 部署引擎+页面（公网 https） | 把游戏和引擎都放 VPS，同 https，无混合内容 | VPS RTT 实测 **236–269ms**（TCP 443/22, 5 次采样）→ 500ms 搜索变 ~1.0s 往返；VPS 上跑 Linux 版 Pikafish | 需在 VPS 装引擎（Linux 二进制）+ 部署；外网可用性好 |
| C. Cloudflare Tunnel（.100 → 公网 https） | cloudflared 在 .100 建出站隧道，得到 `https://xxx.trycloudflare.com` → 反代到 8899；Pages 页 fetch https 隧道地址（无混合内容） | **未实测**（.100 未装 cloudflared）；需要安装+保活 | 装 cloudflared + 常驻进程；延迟多一跳（未测） |
| D. 内网 https + 真证书（Chrome LNA 授权） | 给 192.168.10.100 配真证书（域名 DNS-01），Pages 页 fetch https://内网域名 → 仍需用户点 LNA 授权 | 未实测（无证书/域名环境） | 复杂，Chrome-only；不建议现阶段做 |

- 延迟代价对比: A ≈ +1.2ms（内网 RTT，实测）→ 直接可用；B ≈ +250ms/单程（实测 VPS RTT）；C 未知（估 +50–300ms）。
- **推荐组合: 路线① 保 Pages 在线体验；路线③-A 作为"内网满血模式"入口（同一份 index.html，加一个引擎地址开关即可）。** B/C 留给"外网也想满血"的后续需求。

---

## 5. 推荐路线 + 理由（按三项权衡）

**推荐: 路线①（mistboard WASM + coi-serviceworker，部署在 GitHub Pages）为主线。**

理由（棋力提升 / 手机端可用性 / 改动量）:
1. **棋力**: 8.6–9.0× 节点（4线程），depth +4~7；同深度耗时省 3.5–4.4×。对"大师档"体验是质变，且全部发生在用户设备上（不依赖服务器）。
2. **手机端**: 保持 Pages 分发（任何手机浏览器打开即用）；风险点明确且可控——首载 50.7MB 需懒加载+缓存（12s@4.1MB/s，实测外推）、内存建议移动端 Hash=64–128MB、iOS Safari 的 SW 兼容性需上线前用真机回归。
3. **改动量**: ~150–250 行（4 个文件）+ 1 个 SW 文件 + 1 个 50.7MB 资产；没有服务器运维成本。
4. **已知必须处理项**: (a) 强度档 1/2 的 Elo 限制失效 → 改用 MultiPV 候选随机化（新引擎 MultiPV 可用，实测）；(b) 判例选项失效 → 回归测试引擎内建判例行为；(c) 单文件版（file://）保留旧引擎或砍引擎。

**次选/互补: 路线③-A（内网 http 自建页 + .100 常驻引擎）**——31–38× 棋力、RTT 1.2ms，给"在家满血下棋"场景；改动小（服务端已好，前端加一个可配置引擎地址 + fetch 适配）。

**路线② 保留为供应链工具**（要打补丁/做真单线程版/复现构建时用），不单独作为部署路线。

**不建议现在做**: ③-B/C（VPS/隧道）——留待"外网也要满血"的真实需求出现时再上（B 已有 RTT 实测 250ms 可评估）。

---

## 6. 复现命令（原文）

```bash
# 环境: Git Bash, node=C:/Users/35165/AppData/Local/hermes/node/node.exe
# 实验目录: C:/Users/35165/AppData/Local/hermes/cache/scratch/

# ① mistboard 构建（含 COI 测试）: 无头服务器(无 COOP/COEP) + headless Chrome
node serve_upg.js upg_test 8796 <log>      # 模拟 GitHub Pages
bash run_upg_bench.sh                       # 跑 bench_upg.html: P1 无隔离失败 → SW 重载 → P2 mb4/mb1 → P3 当前构建
bash run_depth_test.sh                      # 定点深度对照 (go depth 18/20)
bash run_uci_dump.sh                        # UCI 选项全量 dump
bash run_opt_test.sh                        # 旧选项序列兼容性测试
bash run_nt_test.sh                         # 无 pthread 变体(无隔离)测试

# ② 自编译（emsdk 6.0.11 已装于 scratch/emsdk）
source emsdk/emsdk_env.sh
cd pkw-build && bash wasm/build.sh dist/wasm            # pthread 版（~1min）
bash wasm/build_nothreads.sh dist/wasm_nothreads        # 无 pthread 版（60.2s 实测）

# ③ HTTP 服务（.100）
ssh -i ~/.ssh/id_ed25519_main100 35165@192.168.10.100  # 服务在 .100:8899 运行中
node http_latency_test.js                               # /move 延迟 + healthz RTT
# Pages 混合内容实测: headless Chrome + CDP
node cdp_fetch.js 9335 'https://crest10086.github.io/xiangqi/' cdp_exprA.js
```

关键日志原文见 `bench/engine_upgrade_evidence/`（本报告同目录）。

---

## 7. 未完成项（如实记录）

- **Fairy-Stockfish 路线未产出数据**: 材料已备齐（`fairy-stockfish-nnue.wasm` 1.1.7/1.1.12 已下载 + 象棋子网络 11.26MB CC0 `xiangqi-c07e94a5c7cb.nnue` + 脚本 `bench/fairy_bench.js`），时间预算内未跑。若要做，它是"许可更宽松（CC0 网络）"的备选，预期棋力低于完整 Pikafish 网络，建议作为独立小任务。
- **dffge552/xiangqi-pwa-offline 的 522KB wasm**: 已下载（scratch/pkfull，pthread 构建，44.88MB 网络格式与旧构建不兼容），未做浏览器实测；其上游项目实为 Electron 应用，wasm 价值低，不建议投入。
- iOS Safari 真机兼容性、Cloudflare Tunnel 延迟: 未实测（无设备/未安装），已在文中标注。
- 无 pthread 自编译变体的"真单线程补丁"（~20–40 行）未做——需要时才做。
