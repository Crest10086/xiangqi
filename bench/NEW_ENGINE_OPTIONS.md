# 新引擎（mistboard 完整强度 Pikafish WASM）选项 / MultiPV / 判例 — 结论报告

卡: t_624cc298（纯收尾，未跑基准）。生成时间 2026-10-04 02:1x。
被测引擎: `pikafish.js 80121 B` + `pikafish.wasm 662419 B` + `pikafish.nnue 50706378 B`，`id name Pikafish dev-20260922-nogit`。
对照引擎: 线上生产 WASM，`id name Pikafish dev-20240816-b41514ac`（选项清单见 `bench/new_engine_logs/old_engine_uci.txt`）。

原始证据（全部为已落盘日志，本报告不新增基准）：

- `bench/new_engine_logs/new_engine_uci_options.log`（1855 行；选项全量 + 逐项 setoption + MultiPV 12 组步骤）
- `bench/new_engine_logs/new_engine_multipv.log`（681 行，其中 558 行带 `multipv` 字段）
- `bench/new_engine_logs/old_engine_uci.txt`（旧引擎选项对照）
- `bench/new_engine_logs/new_engine_rule.log` / `new_engine_rule2.log` / `new_engine_rule3.log`（t_624cc298 的判例探针，三轮全部构造失败，见第 3.5 节）
- `bench/new_engine_logs/new_engine_rule4.log` … `new_engine_rule11.log`（t_b7958865 的判例判定探针，第 3.1–3.3 节的全部数字来自这 8 份日志；机械解析结果 `bench/new_engine/rule_evidence.json`）
- 跑法: `bench/new_engine/run_driver.sh <task.json> <logname>`（无 COOP/COEP 的 `serve_upg.js` + headless Chrome + `driver.html`/`worker_mb.js`），与前两轮完全一致

解析口径（本节所有数字都按此口径从日志提取，非人工转述）：把每个 `go` 到 `bestmove` 之间视为一次搜索；按 `multipv` 槽位分组，取该槽位最后一条 `info` 作为该候选的最终评估；`nodes`/`depth` 是整次搜索的总量（引擎对每个候选打印同一总量）。

---

## 1. 选项对照表

### 1.1 新引擎选项全量（`uci` dump，11 项，逐字照录）

```
option name Debug Log File type string default <empty>
option name NumaPolicy type string default auto
option name Threads type spin default 1 min 1 max 1024
option name Hash type spin default 16 min 1 max 33554432
option name Clear Hash type button
option name Ponder type check default false
option name MultiPV type spin default 1 min 1 max 128
option name Move Overhead type spin default 10 min 0 max 5000
option name nodestime type spin default 0 min 0 max 10000
option name UCI_ShowWDL type check default false
option name EvalFile type string default pikafish.nnue
```

（清单逐字取自 `new_engine_uci_options.log` 的 `S|UCI_DUMP|OUT|` 行，共 11 条 option + `id name`/`id author`/`uciok`。）

### 1.2 与旧引擎逐项对照

旧引擎共 22 项，新引擎 11 项。**共有 11 项**（名称、类型、取值范围完全一致）：Debug Log File / NumaPolicy / Threads / Hash / Clear Hash / Ponder / MultiPV / Move Overhead / nodestime / UCI_ShowWDL / EvalFile。
**新引擎没有任何新增选项**。**旧引擎有、新引擎没有的 11 项**如下。

| 旧引擎选项（原文） | 新引擎状态 | 证据 |
|---|---|---|
| `Skill Level type spin default 20 min 0 max 20` | **被拒** | `S\|OPT_SKILLLEVEL\|CMD\|setoption name Skill Level value 10` → `S\|OPT_SKILLLEVEL\|OUT\|No such option: Skill Level` |
| `Mate Threat Depth type spin default 1 min 0 max 10` | **不存在**（未出现在 option 全量清单；未单独发送验证） | `new_engine_uci_options.log` UCI_DUMP 全量 11 项中无此项 |
| `Repetition Rule type combo default AsianRule var AsianRule var ChineseRule var SkyRule var ComputerRule var AllowChase` | **被拒** | `S\|OPT_REPETITION\|CMD\|setoption name Repetition Rule value AsianRule` → `No such option: Repetition Rule` |
| `Draw Rule type combo default None var None var DrawAsBlackWin var DrawAsRedWin var DrawRepAsBlackWin var DrawRepAsRedWin` | **被拒** | `S\|OPT_DRAWRULE\|CMD\|setoption name Draw Rule value None` → `No such option: Draw Rule` |
| `Sixty Move Rule type check default true` | **被拒** | `S\|OPT_SIXTYMOVE\|CMD\|setoption name Sixty Move Rule value false` → `No such option: Sixty Move Rule` |
| `Rule60MaxPly type spin default 120 min 1 max 150` | **不存在**（同上，未单独发送验证） | UCI_DUMP 全量中无此项 |
| `MaxCheckCount type spin default 0 min 0 max 1000` | **不存在**（同上） | UCI_DUMP 全量中无此项 |
| `UCI_LimitStrength type check default false` | **被拒** | `S\|OPT_LIMITSTRENGTH\|CMD\|setoption name UCI_LimitStrength value true` → `No such option: UCI_LimitStrength` |
| `UCI_Elo type spin default 1280 min 1280 max 3133` | **被拒** | `S\|OPT_ELO1400\|CMD\|setoption name UCI_Elo value 1400` → `No such option: UCI_Elo` |
| `UCI_WDLCentipawn type check default true` | **不存在**（未单独发送验证） | UCI_DUMP 全量中无此项 |
| `LU_Output type check default true` | **不存在**（未单独发送验证） | UCI_DUMP 全量中无此项 |

结论：**当前生产配置依赖的 6 个选项（Skill Level / Repetition Rule / Draw Rule / Sixty Move Rule / UCI_LimitStrength / UCI_Elo）在新引擎里全部不可用**，其中 6 项已逐项 `setoption` 实测被拒，另外 5 项（Mate Threat Depth / Rule60MaxPly / MaxCheckCount / UCI_WDLCentipawn / LU_Output）未出现在新引擎选项全量中（未逐个发送验证，但既然不在 `uci` 清单里，发送必被拒——同一日志里的 `setoption name Zzz Not A Real Option value 1` 得到 `No such option: Zzz Not A Real Option`，证明该构建对未知选项统一回 `No such option`）。

### 1.3 共有选项的实测行为（接入时需要注意的细节）

| 选项 | 实测 | 日志片段 |
|---|---|---|
| Threads | 生效，1→4 均正常；16 核机器上报告可用处理器 | `S\|OPT_THREADS1\|OUT\|info string Using 1 thread`；后续 `info string Available processors: 0-15`、`info string Using 4 threads` |
| Hash | 静默接受，无回显 | `S\|OPT_HASH64\|END\|lines=0` |
| MultiPV=99 / Threads=99 / Hash=99999 | 静默接受，`isready`→`readyok`（三者都在各自声明上限内，因此本探针只证明"范围内取值不报错"，**未测试越界取值的行为**） | `S\|BOUNDS_PROBE\|END\|lines=0` |
| EvalFile | 生效，改路径后重新加载并如实回报新路径 | `setoption name EvalFile value /pikafish.nnue` → `readyok`，随后 `info string NNUE evaluation using /pikafish.nnue (64MiB, (62083, 1024, 32, 32, 1))` |
| nodestime=200 | 被接受（无 `No such option`），但**本轮未验证其效果**：`go infinite` 未在驱动 20 s 超时内返回，`info` 里的 `time` 仍按真实时间增长（d28 / 6,437,838 节点 / time 15311） | `S\|NODASTIME_PROBE\|...`、`S\|NODASTIME_PROBE\|TIMEOUT` |
| UCI_ShowWDL=true | 被接受，但**整轮没有出现任何 `wdl` 字段**（全日志 ` wdl ` 出现 0 次）；该步骤实际多出的是 314 行 `info depth N currmove X currmovenumber M` | `S\|SHOWWDL_PROBE\|OUT\|info depth 28 currmove b2b9 currmovenumber 2` |
| （无选项）NNUE 内存 | 每次 `go` 都打印网络副本情况：共享内存不可用，退化为本地副本 | `info string Network replica 1: Local memory. Shared memory not supported by the OS. Local allocation fallback.`（两个日志共 38 处，覆盖 26 个搜索步骤） |
| `position fen` 非法局面 | 引擎回一行 CRITICAL ERROR 后**继续执行后续命令，且沿用上一条有效局面**——不会重置、也不会拒绝后续 `go` | `S\|RULE_PROBE1\|OUT\|info string CRITICAL ERROR: Command \`position fen 1k7/pp7/...\` failed. Reason: Unsupported position. WHITE pawn(s) on invalid positions.` 紧接着 `go depth 26` 正常搜索并给出 `bestmove c7c8` |

最后一条是接入侧的硬约束：**前端必须检查 `CRITICAL ERROR` 并丢弃该次结果**，否则会把"上一个局面的着法"当作当前局面的着法用出去。

---

## 2. MultiPV 行为

### 2.1 候选是否真正独立 —— 是

`new_engine_multipv.log` 共 558 行带 `multipv` 字段（槽位分布：1→170 行、2→149、3→129、4→110），`new_engine_uci_options.log` 里同类行 1199 行。每个槽位给出**不同的 pv**，且 `bestmove` 始终等于槽位 1 的首着。

两个日志合计 37 次完整搜索（`go` → `bestmove`），其中 MultiPV≥2 的 33 次里，32 次的各槽位**首着互不相同**。唯一例外是 `MPV4_NODES2000` 的一次运行（只搜到 depth 3，槽位 2 与槽位 4 首着同为 `c3c4`）——节点预算极小导致候选退化。另有 4 次 MultiPV=1 的搜索作为对照。全部 37 次里 `bestmove` 都等于槽位 1 最后一条 pv 的首着（37/37 一致）。

### 2.2 各候选 score 差异的真实数字

开局局面 `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w`（4 线程，Hash 64）：

| 步骤 | MultiPV | 到达 depth | 总节点 | 各槽位最终 score | 槽1→槽N 差 |
|---|---|---|---|---|---|
| MPV2_MT1500 | 2 | d21 | 2,715,515 | cp 25 / cp 22 | 3 cp |
| MPV3_MT1500 | 3 | d20 | 3,049,209 | cp 20 / cp 20 / cp 17 | 3 cp |
| MPV4_MT1500（run1） | 4 | d19 | 2,888,131 | cp 21 / cp 19 / cp 19 / cp 15 | 6 cp |
| MPV4_MT1500（run2） | 4 | d19 | 3,299,045 | cp 25 / cp 21 / cp 16 / cp 13 | 12 cp |
| MPV4_MT50 | 4 | d10–12 | 127,018–130,477 | cp 26 / cp 21 / cp 16 / cp 15 | 11 cp |
| MPV4_MT150 | 4 | d12–14 | 389,425–389,920 | cp 27 / cp 22 / cp 20 / cp 12 | 15 cp |
| MPV4_MT500 | 4 | d16–17 | 1,138,336–1,242,805 | cp 26 / cp 23 / cp 19 / cp 15 | 11 cp |
| MPV4_NODES200 | 4 | d6–7 | 7,476–8,216 | cp 26 / cp 21 / cp 20 / cp 19 | 6 cp |
| MPV4_NODES2000 | 4 | d3 | 2,055–2,110 | cp 25 / cp 22 / cp 21 / cp 18 | 6–7 cp |

中局局面 `1Rbaka1nr/9/c1n1b2c1/p1p1p3p/6p2/9/P1P1P1P1P/2N1C2CN/9/2BAKAB1R b`（黑方少子；槽位 1 的评估比其余候选高约 570–590 cp，即"不丢子"的那一步，其余候选都是丢子着法）：

| 步骤 | depth | 总节点 | 各槽位最终 score | 槽1→槽4 差 |
|---|---|---|---|---|
| MPV4_MIDGAME_MT150（三次运行） | d16 | 284,576 / 291,961 / 296,225 | cp -28 / -608 / -608 / -608 | **580 cp** |
| MPV4_MIDGAME_MT150（另两次） | d16 | 同上量级 | cp -33 / -599 / -611 / -620 | **587 cp** |
| MPV4_MIDGAME_MT500（三次运行） | d17–19 | 950,282 / 962,812 / 965,373 | cp -31 / -602 / -609 / -609 | **576–588 cp** |

即：**候选池是真实的、彼此独立的**，而且"取第 2 个候选"在中局意味着约 570–590 cp 的损失（相当于白丢一个子），在开局只有 3–15 cp。这个不对称直接决定了第 4 节的弱档设计（也标为待基准验证）。

### 2.3 MultiPV 对节点数 / 思考时间 / 深度的影响

同一 movetime 下（4 线程、Hash 64，开局局面）：

| movetime | MultiPV=1 | MultiPV=4 |
|---|---|---|
| 1500 ms | d20–22，2.07M–2.40M 节点 | d17–19，2.89M–3.30M 节点 |
| 500 ms | — | d16–17，1.14M–1.24M 节点 |
| 150 ms | — | d12–14，380k–390k 节点 |
| 50 ms | — | d10–12，127k–130k 节点 |

要点：

1. **节点总量随 MultiPV 上升**（1500 ms：2.4M → 3.0–3.3M），因为多根搜索要铺开每个候选的子树；
2. **代价是深度下降**（1500 ms：d22 → d17–19；`MPV1_MT1500` 一次运行在 1500 ms 时报 `upperbound` 停在 d20，说明多候选还会带来收尾截断）；
3. **`go nodes` 与 MultiPV 冲突**：`go nodes 200` 实际报 7,476–8,216 节点、`go nodes 2000` 报 2,055–2,110 节点——多候选时节点上限会被超出（引擎按根节点并行铺开，上限不是硬截断）。这与 `bench/FINAL_REPORT.md` 基准三之二"节点数不是强度旋钮"的结论叠加后，**MultiPV 场景下更不能用 `go nodes` 控制强度**。
4. 单线程 + MultiPV=4 是可复现的（`MPV1_T1_MT150` 三次运行输出完全一致：d12、66,808–69,925 节点、槽位 score cp 29/27/25/24）；而 **4 线程 + MultiPV≥2 的候选顺序在运行之间不稳定**——同一局面同一 movetime 的三次运行，槽位 1 分别是 `h2e2` / `b2e2` / `g3g4`。所以"取第 N 个候选"作为弱档手段自带随机性（对弱档是可接受的多样性，但不是可复现行为）。

### 2.4 与旧构建的差异（更正上一轮口径）

`bench/FINAL_REPORT.md` 第 60 行记的"MultiPV 在该构建中实测只输出 1 条 PV（拿不到候选池）"是**旧构建（dev-20240816）**的行为。新构建（dev-20260922）MultiPV 1–128 可用、候选独立、可读到每槽 score/pv，这是新引擎相对旧引擎**唯一新增的能力**（选项集合本身没有新增，见 1.2）。

证据：`new_engine_multipv.log`（558 行 multipv）、`new_engine_uci_options.log`（1199 行 multipv）。

---

## 3. 判例（长将 / 长捉）——**已判定**（本节由 t_b7958865 于 2026-10-04 13:4x 重写，替换上一轮"未判定"段落）

上一轮（t_624cc298）三轮探针全部失败，结论是"未判定"。本轮按该卡 3.3 节给出的最小可行做法重做：所有局面与长着法串都由生成器现场产出，并**先用项目自身 `C:/Users/35165/xiangqi/engine.js` 逐 ply 断言合法**（被将军方每一步都有 ≥1 个合法应将、循环闭合、红方每手确实将军/确实捉子），再写进 `task_*.json`。跑法与前几轮完全一致：`run_driver.sh <task.json> <new_engine_ruleN.log>`。

判例结论：**新引擎不做中国象棋式判例裁决——既不长将判负、也不长捉判负、也没有三次重复判和；它只做 Stockfish 式的"搜索线内/历史重复算和"，并且内置一条硬编码的 60 回合（120 半回合）判和线，以及一个 `halfmove ≤ 119` 的局面接受上限。** 逐条证据如下。

### 3.1 长将形：已构造成功，结论是"重复算和，不判负"

探针（生成器 `gen_rule8.js`，自检记录 `rule8_positions.json`）：

- FEN `2N1k4/9/9/9/9/9/9/3K5/9/p8 w`（红单马 vs 黑单将 + 黑过河卒 a0）
- 循环 `c9d7 e9e8 d7c9 e8e9`：`engine.js` 断言——红每一手都将军；黑每步都被将且 `legalMoves() ≥ 1`；4 步回到完全相同局面且轮到红走；`engine.js` depth8 全搜索返回 `score cp 54`（正分、非杀分，即红**没有任何杀**）。黑卒 a0 永远能 `a0b0` 横走，所以该形不存在困毙，红绝无杀——这是最干净的"长将而无杀"形。

三档对照（`go depth 15`，`new_engine_rule5.log` 第 24/48/72 行）：

| 步骤 | 循环重复次数 | 根局面最终 score | bestmove |
|---|---|---|---|
| `PERP_R0` | 0 次 | `cp 26`（pv `c9d7 e9e8 d7f6 …`，35,898 节点） | `c9d7` |
| `PERP_R2` | 2 次 | `cp 5`（124,731 节点） | `c9b7` |
| `PERP_R3` | 3 次 | `cp 0`（46,924 节点） | `d2d1` |

判读：分数从 +26 塌到 0，但**没有塌到负分**。如果内置"长将判负"，红方（唯一的长将方）在 3 次重复后应被判负，score 会明显为负；实测停在 0，即"和"。

对照组（同一局面、把循环换成**双方都不将军**的闲着循环 `c9b7 e9f9 b7c9 f9e9`，`new_engine_rule6.log` 第 24/48 行）：

| 步骤 | 重复次数 | 根局面最终 score |
|---|---|---|
| `IDLE_R1` | 1 次 | `cp 32` |
| `IDLE_R3` | 3 次 | `cp 0` |

再对照"重复更多次"（`CHK_R4` 16 半回合 / `CHK_R6` 24 半回合，同一长将循环，`new_engine_rule6.log` 第 72/96 行）：两次都是 `score cp 0`。

判读：**长将循环与不将军的闲着循环得到完全一样的结果**（1 次 → 正分；≥3 次 → `cp 0`）。所以引擎对"重复"本身扣分、与"是否将军"无关，扣分的方式是**判和**而不是判负。这与 3.4 第 3 条（三次重复后仍报 `mate 3`）不矛盾：那条是**根局面**未被裁决（引擎继续搜索并给出 mate 3 的杀线），本条是**根局面的评估值**被重复拖到 0——两种口径都指向"没有象棋式判例裁决"。

### 3.2 长捉形：探针本身要分两种定义，实测同样是"重复算和"

上一轮 4 批"长捉"探针全部不成立（`engine.js` 复核：将军后对方 `legalMoves()==0`，是杀/困毙形）。本轮还查出一个更具体的构造错误：`gen_rule6.js` 的 `CHZ1` 把黑象放在 e5，被引擎拒收 —— `Unsupported position. BLACK bishop(s) on invalid positions.`（`new_engine_rule4.log` 第 144 行）。**黑象只能位于 7 个合法象位 c9/g9/a7/e7/i7/c5/g5，e5 不在其中；项目 `engine.js` 不校验象位，所以自检没拦住，新引擎拦住了。** 这是"新引擎局面校验比 `engine.js` 严"的第二个实证（第一个是白兵位置）。

修正后的长捉探针（`gen_rule12.js`，自检记录 `rule12_positions.json`，`selfCheckOk=true`）：

- FEN `5k3/9/9/9/2b6/4R4/9/9/9/3K5 w`
- 循环 `e4c4 c5e7 c4e4 e7c5`；`engine.js` 逐 ply 断言：红落子后黑象确实被攻击（`isAttacked`）、黑象**无根**（对方 `isAttacked` 为假 → 吃它得子，符合"捉"的定义）、全程不将军、4 步闭合。

实测（`go depth 15`，`new_engine_rule10.log` 第 365/412 行）：

| 步骤 | 重复次数 | 最终 score | 首候选 |
|---|---|---|---|
| `CHZF_R0` | 0 次 | `mate 4`（10,083 节点） | `d0e0`（pv `d0e0 c5e7 e4e7 …`，第 3 手就吃象） |
| `CHZF_R3` | 3 次 | `mate 4`（6,665 节点） | `d0e0`（pv `d0e0 c5e7 e4e2 …`） |

判读：这个形里红方本来就有杀（红车单王对黑单将，吃掉无根象后必胜），所以它不能用来读"长捉判负"。它证明的是另一件事：**重复 3 次不会让引擎放弃杀线**（三档都是 `mate 4`，首候选 pv 第 3 手就 `e4e7` 吃象）。

另一侧对照（`gen_rule6.js` 的 `CHZ2`：红车捉**有根**黑炮，吃炮=车换炮亏 300 cp，红只能持续捉；FEN `4k4/9/9/9/2R1c3r/9/9/9/9/3K5`，循环 `c5d5 e5f5 d5c5 f5e5`，`engine.js` 断言"被捉子被对方保护"）：

| 步骤 | 重复次数 | 最终 score | bestmove |
|---|---|---|---|
| `CHZ2_R0` | 0 次 | `cp -15`（33,740 节点） | `d0e0`（与循环无关的闲着） |
| `CHZ2_R2` | 2 次 | `cp 0` | `c5d5`（继续捉） |
| `CHZ2_R3` | 3 次 | `cp 0`（14,133 节点） | `c5d5` |

判读：红方继续捉而不是吃（引擎自己认定吃炮亏子），重复 2 次以上评估变 0 —— 同样是**判和**，不是"长捉方判负"。

两个构造合起来说明定义上的分歧无法用单一局面回答：严格按亚洲规则"捉"须得子（无根子），那种形循环不被迫（红可直接吃）；被迫持续捉的形里被捉子有根，严格按定义不构成"捉"。因此本卡给出的是**引擎侧结论**（两种形都不判负、重复即算和），而不是"该形按亚洲规则是不是长捉"的规则裁决。

### 3.3 rule60 边界：`halfmove ≤ 119` 的接受上限 + 只在 FEN 计数生效的 60 回合判和

上一轮未跑成的 119/120/121/149/150 本轮全部跑成，并且把"计数器从哪来"这个变量单独隔离出来了。结论分三条，都有完整档位表。

**(a) `position fen` 的 halfmove 字段上限是 119；120 起直接拒收。** 该上限与局面无关、也与 fullmove 字段无关：

| 构造 | 结果 |
|---|---|
| `4k4/9/9/9/9/9/9/9/9/3K5`（纯单王）`- - 119 1` | 接受（`new_engine_rule11.log` 第 1230 行） |
| 同一局面 `- - 120 1` | 拒：`Unsupported position. Rule60 counter out of range.`（同日志第 1235 行） |
| `4k4/9/9/9/R8/9/9/9/9/3K5`、`4k4/3R5/…`、`4k4/3P5/9/9/5R3/…` 三组带子局面 | 同样是 119 接受 / 120 起拒（`new_engine_rule11.log` 100 步扫描 + `new_engine_rule9.log`、`new_engine_rule10.log`） |
| `- - 999 1` / `- - 1000 1` / `- - 10000 1` / `- - 120 999` | 全部拒（`new_engine_rule5.log` 第 461/505 行） |
| `- - 0 999`（fullmove 999，halfmove 0） | **接受**，正常 `mate 1`（`new_engine_rule5.log` 第 562 行）→ 校验只看 halfmove |

`gen_rule13.js` 对 4 组局面 × 25 个 halfmove 取值（110…999）做了完整扫描：**四组的分界都在 119/120**，120 以上无一例外被拒。旧引擎的 `Rule60MaxPly default 120 max 150` 说明这个上限是编译期的 120；新引擎**没有这个选项**（1.2），所以既不可调，149/150 这类取值也不可写进 FEN。

**(b) 计数器写进 FEN 时，引擎在搜索里真的执行 60 回合判和，且会算"还剩几步"。** 判别实验（`gen_rule17.js` → `task_rule14.json`，`new_engine_rule16.log` / `new_engine_rule17.log`）：根局面 `3k5/9/9/9/9/9/8R/9/9/5K3 w`（车兵残局里最简单的 K+R 杀单王，**盘面上没有任何可吃的子 → 计数器不可能被重置**），只改 halfmove 字段：

| halfmove | 距 120 还剩 | 引擎最终 score（d14） | 首候选 |
|---|---|---|---|
| 0 / 100 / 110 / 114 / 115 / 116 / **117** | 120 / 20 / 10 / 6 / 5 / 4 / **3** | `mate 2`（`pv f0e0 d9d8 i3d3`） | `f0e0` |
| **118** | **2** | **`cp 0`**（`pv i3e3 d9d8`） | `i3e3` |
| **119** | **1** | **`cp 0`**（`pv i3i9`） | `i3i9` |
| 120 起 | 0 | 见 (a)：直接拒收 | — |

判读：`mate 2` 需要 3 个半回合才能落地。halfmove 117 时 117+3 = 120 刚好压线 → 仍报杀；118 时 118+3 = 121 越线 → 杀被判和压成 `cp 0`。所以内置判和线就是 **120 半回合**，并且引擎会把"杀的距离"与剩余半回合数比较，杀来不及完成就当和。这与纯 FEN 的困毙档一致（`gen_rule12.js` → `task_rule8.json`，`new_engine_rule9.log` / `new_engine_rule10.log`）：黑走的根局面 `5k3/3R5/…`（黑只有 `f9e9`，红下一手 `d8f8` 即困毙 = 2 半回合）在 halfmove 118 报 `mate -1`、在 **119 报 `cp 0`**；红走的根局面 `4k4/3R5/…`（1 半回合即困毙）在 119 仍报 `mate 1`。

引擎还**知道吃子会重置计数器**：把同一局面加一个可吃的黑象（`3k5/9/b6R1/9/9/9/9/9/9/5K3 w`，红车 h7 正对着黑象 a7，`gen_rule16.js` → `task_rule13.json`，`new_engine_rule15.log`），halfmove 0…119 **每一档都仍是 `mate 3`**，而且在 118/119 两档首候选 PV 自动换成先吃象的 `h7a7 d9e9 a7a8 e9d9 f0e0`（117 及以下是不吃象的 `f0e0 d9d8 h7a7 …`）——引擎主动用"吃子重置计数"来保住这条杀线。

**(c) 但计数器如果是 `moves` 回放出来的，60 回合判和不生效。** 用生成器造一条**无吃子、无将军、任何局面最多出现 2 次**的长着法串（`gen_rule10.js` / `gen_rule15.js`；回放核验 `replay_rule7.js` → `rule7_replay.json`：100/118/119/120/121 半回合，`captures=0`、`positionsInCheckAfterMove=0`），写成 `position fen <起点 halfmove 0> moves <前缀>` 让计数器自然累计：

| 步骤 | 自然累计半回合 | 根局面（回放导出） | 引擎 | 最终 score |
|---|---|---|---|---|
| `NOREP_118` | 118 | `5k3/6R2/9/9/9/9/9/9/9/3K5 w` | 接受 | `mate 1` |
| `NOREP_119` | 119 | `5k3/3R5/… b`（黑只有 1 个合法着法，下一手被红困毙） | 接受 | **`cp 0`** |
| `NOREP_120` | 120 | `4k4/3R5/… w`（1 半回合即困毙） | **接受**（不拒收） | `mate 1` |
| `NOREP_121` | 121 | `4k4/5R3/… b`（**黑方合法着法数 = 0**，`engine.js` 判定为困毙） | 接受 | `info depth 0 score mate 0` + `bestmove (none)` |
| `R60S_120/121/125/130/140/149/150`（`gen_rule15.js`，同一条 150 步无吃子串的前缀） | 120–150 | 各档 FEN 见 `rule15_meta.json` | **全部接受**（不拒收） | `R60S_120` 报 **`mate 5`**（`bestmove h7a7`）；其余档 `cp 0` —— 该族各档在搜索里都会形成第三次重复，分数被 (3.1) 的重复算和压住，**不能归因于 60 回合线** |

判读：同样"terminal 落在第 121 半回合"的局面，计数器写进 FEN 时被判和（(b) 表），用 `moves` 回放出来时**不判和、也不拒收**（`NOREP_120` 照报 `mate 1`，130/150 档也接受）。所以 60 回合规则是**由 FEN 提供的计数器驱动的**，不是由 `position … moves` 回放的着法数驱动的。

**对前端唯一要紧的结论**：如果前端把自己累计的 60 回合计数写进 FEN（象棋前端通常就是这么做的），那么
1. 计数 ≥ 120 时引擎会直接拒收局面（`Rule60 counter out of range.`），必须自己保证写进去的值 ≤ 119；被拒时引擎照旧**沿用上一条有效局面**出着（1.3 末条），必须丢弃该次结果；
2. 计数接近 118–119 时引擎可能把本来存在的杀报成 `cp 0`（(b) 表），前端若把 `cp 0` 读成"引擎认为和棋"就会在 60 回合线附近出现判例不一致 —— **60 回合判和应由前端自己裁决，不要依赖引擎的分数**；
3. 如果前端始终用 `halfmove 0` + `moves` 回放，引擎就不会应用 60 回合规则，判和完全落在前端。

**(d) 附带一条前端事实**：`NOREP_121` 的根局面（黑方合法着法数 = 0，`engine.js` 判定为困毙）引擎回 `info depth 0 score mate 0` + `bestmove (none)`。即新引擎把"无合法着法"报成 `mate 0`，与象棋语义不同（象棋里困毙是**走棋方输**）。前端不能把 `bestmove (none)` 当作引擎故障，也不能把 `mate 0` 读成和棋。

**(e) 作废的一批**：`gen_rule10.js` / `gen_rule14.js` 的 `boardToFen` 用了字母表 `'KABNRPC'`（value 7 → `'C'`），写进 FEN 的"兵"实际是炮；那批 130/149/150 档（`new_engine_rule12.log`）口径不清，**不作为证据**。修正后的 `gen_rule15.js` 用 `'KABNRCP'` 并自带王位/象位校验（`engine.js` 不校验初始王位：把红帅放 i0 时引擎回 `Unsupported position. WHITE king(s) on invalid positions.`，`new_engine_rule13.log` 全部 9 步被拒）。

### 3.4 保留的硬结论（上一轮已确证，本轮复核仍然成立）

1. **判例在新引擎里不可配置。** `Repetition Rule`（含 `AllowChase`）、`Draw Rule`、`Sixty Move Rule`、`Rule60MaxPly`、`MaxCheckCount` 全部不存在（见 1.2）。任何长将/长捉/60 回合处理都是编译期默认行为，前端无法切换，也无法与旧引擎的规则选项对齐。
2. **引擎内部带 rule60 计数器，且范围有限**（本轮把上一轮的"999 被拒"精确化为 3.3 第 2 条：上限 119）。
3. **三次重复不会在根局面被引擎裁决为象棋式结果。** `4k4/9/9/P8/9/9/9/9/R7r/3K5 w` 走 `a1b1 e9f9 b1a1 f9e9 a1b1 e9f9 b1a1 f9e9` 后起始局面第三次出现，引擎仍报 `score mate 3`（`pv a1i1 e9e8 i1i8 e8e7 i8f8`，8,556 节点）并 `bestmove a1i1`（`new_engine_rule2.log` 第 39–60 行）。旧引擎的 `Repetition Rule AsianRule` 在新引擎没有对应开关。
4. **新引擎的局面合法性校验比 `engine.js` 严。** 除上一轮的白兵位置外，本轮新增黑象位置（见 3.2）。手写 FEN 的探针必须预期被这类校验拒收。

### 3.5 上一轮探针失败的原因（保留，供后续卡避免重复踩坑）

| 尝试 | 失败原因（本轮复核确认） |
|---|---|
| `chase_positions.json` / `chase2` / `chase3` / `gen_chase4.js` | 红车将军后**黑方 `legalMoves()==0`**，是杀/困毙形，不是被迫循环。探针设计本身不成立，与引擎无关。 |
| `task_rule.json` | 手写 FEN 被拒（白兵位置 / FEN 行长）；引擎沿用上一条有效局面，输出的 `mate 2` 与目标局面无关。 |
| `task_rule2.json` 的长将步骤 | `Illegal move: e9d9` —— 该形里黑将 d9 与红帅 e0 同线（飞将），循环构造错。 |
| `task_rule3.json` | FEN 末行 `5K2` 只有 8 格 → `Invalid FEN. Board state encoding ended but cursor not at end.`，6 步全拒。 |
| `gen_rule6.js` 的 `CHZ1`（本轮） | 黑象放在 e5（非合法象位）→ `BLACK bishop(s) on invalid positions.`；已在 `gen_rule12.js` 修正为 c5。 |

共同教训：FEN 必须生成器产出 + `engine.js` 逐 ply 断言，且 `engine.js` 不校验的规则（象位、兵位）要额外自己校验，否则自检通过而引擎拒收。


---

## 4. 五档接线建议

前提（用户 2026-10-03 21:24 定案）：入门档不动；大师档做极限强度；中间三档只要求在入门与大师之间**单调、相邻可区分**，不要求复刻旧 Elo。

关键事实依据：新引擎**没有** `UCI_Elo` / `UCI_LimitStrength` / `Skill Level`（1.2），而 `bench/FINAL_REPORT.md` 基准三之二已证 `go nodes` 不是强度旋钮。剩下的可用旋钮只有：**MultiPV 取值 + 取第几个候选 + movetime + Hash/Threads**。第 2 节的实测数字表明"取第 N 候选"在中局能造成 570–590 cp 的真实劣化，这是新引擎上唯一能把棋力真正拉下来的开关。

建议参数（4 线程浏览器 WASM，`Threads = min(4, 设备核数)`）：

| 档 | 引擎 | MultiPV | 取第几候选 | movetime | Hash | 说明 / 依据 |
|---|---|---|---|---|---|---|
| 入门 | 内置引擎 d2 | — | — | — | — | **不动**（定案） |
| 业余 | 新引擎 | 4 | **第 4 候选** | 150 ms | 64 | d12–14 / 390k 节点；中局候选 4 比候选 1 差 ~580 cp（2.2） |
| 进阶 | 新引擎 | 3 | **第 3 候选** | 300 ms | 64 | 300 ms **未实测**（介于已测的 150/500 之间取值）；候选序号比业余小、思考时间更长 → 预期单调强于业余，需基准确认 |
| 高手 | 新引擎 | 2 | **第 2 候选** | 500 ms | 128 | d16–17 / 1.14M 节点；候选 2 中局差 ~570 cp，开局仅差 1–3 cp |
| 大师 | 新引擎 | **1** | 第 1 候选 | 6000 ms | 256 | MultiPV=1 才能拿到最深搜索（1500 ms 时 d22 vs MultiPV4 的 d17–19，2.3） |

必须同时接的三件事：

1. **判例/和棋裁决留在前端。** 引擎不再提供规则选项，且实测不做象棋式判例裁决：长将/长捉/闲着循环重复 ≥3 次只会把评估压到 `cp 0`（判和），不判负（3.1、3.2）；三次重复也不在根局面被裁决（3.4 第 3 条）。`index.html` 现有的三次重复/将死/困毙 + 步数上限判罚必须原样保留，否则规则会静默改变。
2. **前端必须校验 `CRITICAL ERROR` 并丢弃该次着法**（1.3 末行）：新引擎对非法 `position` 不会重置局面，会沿用上一条有效局面出着。另外引擎喂给它的 FEN **halfmove 字段必须 ≤ 119**，120 起会被 `Rule60 counter out of range.` 拒收（3.3 第 2 条）——前端自己累计的 60 回合计数要在 119 处截断或改走本地判和。
3. **不要用 `go nodes` 控制强度**，尤其在 MultiPV>1 时节点上限会被超出（2.3 第 3 点）。`go movetime` 是本轮唯一验证过可稳定控制思考量的方式。

需要基准验证的项（**由别的卡做，本卡未跑**）：

- [ ] 中间三档的**单调性与相邻可区分性**：候选序号 4→3→2 是否真的单调变弱。已知风险：开局阶段候选差距只有 3–15 cp（2.2 上表），弱档在开局可能几乎不变弱；中局才出现 570+ cp 差距。基准必须以中局/战术题为主，并分别报告开局与中局。
- [ ] 候选序号在**非中局、非缺子局面**里的区分度：本卡只在中局缺子形观测到大 gap，普通均势局面的 gap 分布未知。
- [ ] 候选顺序不稳定（2.3 第 4 点）带来的对局方差：需要多局、交换先后手，且要报告重复轮次间的波动。
- [ ] 大师档 6000 ms 的实际深度/节点与设备差异（线上 `perf_probe.html` 对照；旧记录 500ms≈9.6 万节点/d15、6000ms≈108 万节点/d20 是**旧小网络**的数值，新完整网络在 4 线程 WASM 下 1500 ms 已达 2.0–3.3M 节点 / d17–22，两者不可混用）。
- [ ] Hash 取值：新引擎每次 `go` 都报"Shared memory not supported by the OS. Local allocation fallback"（网络副本退化为本地分配，NNUE 声明 64MiB）。多线程 + Hash 256 的实际内存占用需在真机测量后再定档；本卡建议值未做内存实测。
- [ ] 若基准显示"取第 N 候选"区分度不足，备选旋钮只有：前端对候选池做过滤（按与候选 1 的 score 差设阈值再随机）、或 `Move Overhead`（只加延迟、不降强度，预计无效）。`nodestime` 本轮未验证效果（1.3），不能作为候选。

---

## 附：本轮新增/使用的文件

- 新增探针任务：`bench/new_engine/task_rule2.json`、`bench/new_engine/task_rule3.json`（构造脚本留在 `C:/Users/35165/AppData/Local/hermes/profiles/programmer/cache/scratch/mk_*.js`）
- 新增日志：`bench/new_engine_logs/new_engine_rule.log`、`new_engine_rule2.log`、`new_engine_rule3.log`
- 未改动任何生产文件，未 commit、未 push（`git status` 仍只有上一轮遗留的 5 个未跟踪项）。

### 判例判定轮（t_b7958865，2026-10-04 12:1x–13:4x，第 3 节的证据）

- 生成器（每个都调用项目 `engine.js` 做自检，自检记录落盘）：`bench/new_engine/gen_rule4.js`、`gen_rule5.js`、`gen_rule6.js`、`gen_rule8.js`（最终长将探针）、`gen_rule9.js`（闲着对照）、`gen_rule10.js`（无重复长着法串；**其 FEN 字母表有 bug，见 3.3 (e)**）、`gen_rule12.js`（最终长捉 + 困毙 FEN）、`gen_rule13.js`（rule60 上限扫描）、`gen_rule14.js`（**已作废**，同一 FEN 字母表 bug）、`gen_rule15.js`（修正版 150 半回合无吃子串）、`gen_rule16.js`（可吃子对照）、`gen_rule17.js`（K+R vs 单王，3.3 (b) 判别实验）；辅助核验：`verify_pv.js`、`check_mate1.js`（**已作废**：FEN 字母表写成 `KABNRPC` 漏了 C，把 P 解析成 C，结论不可用）、`check_mate1_fixed.js`（修正版）、`replay_rule7.js`、`analyze_rule_logs.js`
- 自检/证据文件：`bench/new_engine/rule4_positions.json`、`rule6_positions.json`、`rule8_positions.json`、`rule12_positions.json`、`rule15_meta.json`、`rule7_replay.json`、`rule_evidence.json`（上述 14 个日志的机械解析结果，第 3 节表格全部数字来自它）
- 任务文件：`task_rule4.json`、`task_rule5.json`、`task_rule6.json`、`task_rule7.json`、`task_rule8.json`、`task_rule10.json`、`task_rule11.json`、`task_rule12.json`、`task_rule13.json`、`task_rule14.json`、`task_rule15.json`
- 日志：`bench/new_engine_logs/new_engine_rule4.log`(699 行) … `new_engine_rule17.log`(27 行)，共 14 份；除 `new_engine_rule11.log`(1357 行，100 步的 rule60 上限扫描，跑到第 99 步时被本卡的运行时上限截断，未打印 `DRV DONE`；结论所需的 119/120 分界在前 99 步里已全部覆盖，且后续 `new_engine_rule10.log` 的 `SW_*` 档已把同一分界复核到 999) 外，其余 13 份都完整跑到 `DRV DONE`。
- 3.3 (b)/(c) 两张表的来源：`gen_rule17.js` → `task_rule14.json` → `new_engine_rule16.log`(189 行) + `task_rule15.json` → `new_engine_rule17.log`(27 行，halfmove 117 补档)；`gen_rule16.js` → `task_rule13.json` → `new_engine_rule15.log`(211 行，可吃象对照)；`gen_rule15.js` → `task_rule12.json` → `new_engine_rule14.log`(193 行，150 半回合无吃子串前缀)。
- 仍未改动任何生产文件，未 commit、未 push。
