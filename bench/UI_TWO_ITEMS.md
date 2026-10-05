# UI 两项：引擎下载可见提示 + 落子高亮（t_f51aab68）

日期: 2026-10-05 ｜ 卡片: t_f51aab68

用户原话（07:39）:「下载 50M 的大文件时，界面上应该有提示」「移动完棋子后，被移动的棋子也应该高亮显示」
运营者补充（08:5x，小米浏览器实测）:「之前用小米浏览器是可以正常玩的，只不过开头几秒下完一步就会变回刚开局的状态，过几秒后再下就正常了」

## 1) 引擎下载可见提示（index.html + js/pikafish_bridge.js）
- 新增 `#engLoad` 面板（`#engLoadTxt` 文案 + `#engBarFill` 进度条，默认 hidden；样式 `.engload/.engbar/.engload.err`）。
- 文案与 50.7MB 数字单一来源在桥接层：`NET_BYTES=50706378` / `NET_LABEL` / `loadText(p)`；页面不重复数字与措辞。
- 触发：`ensureEngine()`（用户点「新对局」+ 引擎档；或 AI 首次要搜棋）。发起后立即显示
  「正在准备引擎：首次对局需下载 50.7MB 强度网络…」，消掉首字节前 1–2s 空窗。
- 进度文案：「正在下载引擎强度网络 P%（x.x/50.7MB），只需一次，之后走缓存」；
  完成：「强度网络已下载完（50.7MB），正在初始化引擎…」。
- 无 Content-Length 时回退 shipped total（不出现 NaN）；超总进度不显示 >100%。
- file:// 单文件版（引擎内嵌、不发生下载）：`PF.netDownloadNeeded()===false` →
  「正在准备内置引擎…（无需下载）」，不谎称在下载。
- 懒加载约定保持（t_9c93fb06）：页面首次自动 `newGame()` 不触发下载；仅用户点「新对局」/AI 需要时。

## 2) 落子高亮（index.html 渲染层）
- `draw()` 记录 `lastMove` 终点 `movedIdx`：终点亮环 `#f1c40fcc`、起点淡环 `#f1c40f33`。
- `drawPiece(i,c,moved)`：被移动棋子加金色发光（shadowBlur）+ 内圈（sc(2)）+ 外框加粗（sc(3.5)）。
- 纯 canvas 渲染：棋子几何/点击命中判定不变；新对局/悔棋清 `lastMove` 时高亮同步消失。

## 3) 小米浏览器「开头几秒下完一步变回开局」（运营者补充）
- 根因：冷首访无 COOP/COEP → 引擎懒加载时 `ensureIsolated()` 注册 coi-serviceworker 并强制
  `location.reload()`（恰在第一步前后）→ 页面重开、对局清空；重载后 SW 生效（「过几秒后再下就正常」）。
- 修法：
  - 每步快照：`snapshotIfNeeded()`（renderLog 触发）→ sessionStorage `xqRestore`
    `{side,level,handicap,moves,armed,tries,at}`（30 分钟有效期、隐私模式失败静默）。
  - 重载后恢复：启动 `if (!restoreGame()) newGame();`；`restoreGame()` 经 `game.move()` 重放并重建
    `lastMove`，随后直接 `checkEnd()`（覆盖绝杀/三次重复等终局），轮到 AI 时照常走。
  - 在途下载续跑：`saveGameForReload()` 记 `armed: engineLoadArmed`；恢复时 `d.armed` 且未就绪 →
    `ensureEngine()` 接着下载（提示不消失）。
  - 恢复提示「已恢复刚才的对局」受 `game.inCheck()` 保护（将军优先）；用户点「新对局」= 放弃旧局
    （`sessionStorage.removeItem('xqRestore')`）。

## 证据（2026-10-05，最终代码复跑）
| 项 | 命令 | 结果 |
|---|---|---|
| 接线单测 | `node bench/new_engine/test_ui_wiring.js` | **32/32 PASS**（面板/懒加载/高亮/重载恢复） |
| 档位配置 | `node bench/new_engine/test_tier_config.js` | 35/35 PASS |
| 档位规则 | `node bench/new_engine/test_tier_rules.js` | 29/29 PASS |
| HTTP+COI 全 UI | `bash bench/new_engine/run_ui_probe.sh 9471` | exit 0；四档 src=engine、depth20、coi+sab+4线程 |
| file:// 单文件 | `bash bench/new_engine/run_single_probe.sh 9481` | exit 0；四档 src=engine |
| 视觉终跑 | `COI=1 SLOW_KBPS=4000 bash bench/new_engine/run_ui_visual.sh 9491 ui_visual_final` | 面板文案/进度条全程一致（准备→8%→…→64%→下载完）；高亮像素比 dst 0.775–0.817 vs 无关格 0 |
| 单文件面板 | `bash bench/new_engine/run_single_panel_check.sh 9501` | SINGLE-FILE-PANEL-OK-NO-DOWNLOAD-CLAIM（无需下载文案，加载后面板自动隐藏） |
| 重载修法 | `bash bench/new_engine/run_reload_probe.sh 9381` | GAME-PRESERVED-ACROSS-RELOAD（重载后保留 兵九进一+砲8平4、coi:true、引擎就绪） |
| 自对弈回归 | `node test.js`（仓库根） | 44/44 PASS |

高亮判据：终点格 24×24 像素采样黄色占比 dst≈0.78–0.82 / 起点淡环≈0.21–0.37 / 无关格对照 0。
截图：`bench/new_engine_logs/ui_visual_final/`（01 下载提示、03-loading-* 进度、02/05/06 落子高亮）；
改前对照 `ui_visual_before/`；慢速下载全程 `ui_visual_download/`。

## 线上复核（推送 904e78c 后，2026-10-05 11:07）
- 部署一致性：`node bench/new_engine/check_pages_parity.js` → **PARITY ALL-IDENTICAL**（17/17 文件，线上与 HEAD 逐字节相同）。
- 真部署重载实测（冷 profile、无缓存）：`bash bench/new_engine/run_pages_reload_probe.sh 9511` →
  **GAME-PRESERVED-ACROSS-RELOAD**：第一步 兵九进一 后 coi-serviceworker 强制重载（NAVIGATIONS=2），
  重载后对局保留（hist 仍为 兵九进一、lastMove 恢复）、引擎下载续跑（面板「正在下载引擎强度网络 49%（25.2/50.7MB）」）、coi=true。
  日志：`bench/new_engine_logs/pages_reload_probe.log`。

## 复跑命令
- 视觉证据：`COI=1 SLOW_KBPS=4000 bash bench/new_engine/run_ui_visual.sh 9431 ui_visual_x`
- 重载修法（本地）：`bash bench/new_engine/run_reload_probe.sh 9381`
- 重载实测（线上）：`bash bench/new_engine/run_pages_reload_probe.sh 9511`
- 探针：`bash bench/new_engine/run_ui_probe.sh 9441` / `bash bench/new_engine/run_single_probe.sh 9461` / `bash bench/new_engine/run_single_panel_check.sh 9501`
