# 大师档棋力上限诊断：引擎构建与评估网络（2026-10-03）

结论：**当前最高档弱于完整 Pikafish，原因不在搜索时间，而在浏览器引擎本体——裁剪版 wasm + 8 MiB 小评估网络。**

## 1. 引擎实际加载的网络

`bench/net_probe.js` 抓到的引擎自述：

```
info string NNUE evaluation using pikafish.nnue (8MiB, (4320, 1024, 15, 32, 1))
```

- `js/engines/pikafish/pikafish.data` = 4,134,154 B（内含 4.99 MB 的 `pikafish.nnue`）
- 官方主网络 50.7 MB；2024-08-31 release 内网络 27.7 MB
- 即评估网络比官方小约 6 倍

## 2. 同一初始局面的搜索能力对比

FEN `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1`

| 思考时间 | 当前 WASM（小网络，单线程） | 原生 Pikafish 2024-08-31 bmi2（完整网络，4线程） |
|---|---|---|
| 500ms | depth 14 / 9.7 万节点 | depth 21 / 313 万节点 |
| 2000ms | depth 19 / 41.7 万节点 | depth 26 / 1234 万节点 |
| 6000ms | depth 22 / 120 万节点 | depth 29 / 3722 万节点 |
| 90000ms | depth 31 / 1674 万节点 | — |

差距约 **30 倍搜索量、6 层深度**。复现：`node bench/net_big.js`（默认小网络）、`node bench/native_probe.js`（原生引擎，需先解包 `Pikafish.2024-08-31.7z`）。

## 3. 只加思考时间的收益有限

`TIMES=6000,30000,90000 node bench/net_big.js` → depth 22 / 27 / 31。要追平原生 6 秒的搜索量，浏览器里需要思考约 90 秒，且网络仍是小的那个。所以"把大师档时间拉长"不是解决棋力上限的办法。

## 4. 为什么不能直接把大网络塞进现有引擎

- 把 22.9 MB 的 2024-08 网络包（单层 zip，内含 27.7 MB nnue）作为 `.data` 喂给当前 wasm → 引擎打印 UCI 选项中途 `Program terminated with exit(1)`
- 把 4,134,154 字节的**全零**内容喂进去（与正常 `.data` 同尺寸）→ 同样 `exit(1)`，且崩在同一行
- 50.7 MB 官方主网络、双层 zip 封装 → 同样失败
- wasm 内存段 initial=1024 页(64 MiB)、max=16384 页(1 GiB) → **不是内存上限问题**

判据实验说明失败与体积无关，是**格式/架构不被接受**：这个 488 KB 的 wasm 只认现有小网络，读不懂就直接退出，不会退回传统评估。复现：`node bench/net_big.js <data路径>`，配套 `bench/pk_big*.js`、`bench/pk_8.js`、`bench/pk_same.js`（改 `pikafish.js` 内嵌的 `end:` / `remote_package_size:` 字节数）。

## 5. 未收口

换完整引擎构建（浏览器 WASM 完整构建 / 自编译 Pikafish wasm / 原生引擎走 HTTP 服务）的可行性与棋力实测，见 `bench/ENGINE_UPGRADE_FEASIBILITY.md`（由 kanban 卡 t_67b32d95 产出）。本文件只记录已实测的事实。
