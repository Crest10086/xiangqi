# 五档新配置基准验证：MultiPV 候选序号能否单调降强 — 基线报告

卡: t_ef6e93b8（承接 t_624cc298 / `bench/NEW_ENGINE_OPTIONS.md` 第 4 节）。生成时间 2026-10-04 03:3x。
被测引擎: `bench/new_engine/` 三件套（Pikafish dev-20260922-nogit，pikafish.js 80121 B / wasm 662419 B / nnue 50706378 B）。
本卡只读生产文件、只新增测试文件与日志；未改生产代码、未 commit、未 push（`git status` 仍只有既有的 6 个未跟踪目录/文件）。

---

## 0. 结论速览

| 验收子项（按用户 2026-10-03 21:24 定案） | 判定 | 关键证据 |
|---|---|---|
| 中间三档在聚合意义上**单调**（业余>进阶>高手>大师） | **通过** | 三组独立轮次的平均损失均严格单调，方向无一轮反转（第 2 节表） |
| **相邻可区分** | **部分通过** | 高手→大师 强区分（中局平均差 ~103 cp，三轮 102/102/105）；进阶→高手 中等（~15 cp）；**业余→进阶 弱**（中局平均仅 ~9 cp，单轮 2–17 cp，接近噪声） |
| 逐局面可区分 | **失败** | 17 个局面中只有 2 个在两个相邻档位上同时给出 >20 cp 的分离；13 个 FLAT（第 4 节） |
| 300 ms 补测（进阶档） | **完成** | d12–19 / 405k–649k 节点，介于已测 150/500 之间（第 6 节） |
| 风险点 1（候选差随局面剧烈变化） | **证实并量化** | 中局 AM 档 gap 分布：<10 cp 占 6/36、10–49 占 20/36、≥500 占 6/36（第 5 节） |
| 风险点 2（4 线程候选顺序不稳定） | **证实并量化** | 跨轮着法不稳定率：AM 14/17、AD 15/17、EX 10/17、GM 6/17；但聚合均值稳定（±10 cp 内）（第 7 节） |

一句话结论：**"MultiPV + 取第 N 候选"作为降强旋钮真实有效、聚合单调，但强度差不是由档位参数决定、而是由局面的候选质量梯度决定**——在候选 2/3/4 同样差（都丢子）或同样好（差几 cp）的局面里，三个弱档彼此几乎不可区分。对照组 S1T300（与进阶同参数、取第 1 候选）证明 **movetime 本身不是强度旋钮，候选序号才是**（第 3 节）。

---

## 1. 方法

### 1.1 题集（17 题，全部经项目自身 `engine.js` 回放生成，保证合法）

- **开局组（5 题）**：OP00 初始局面 + OP02/OP04/OP06/OP08（种子 PRNG 20261004 走 2/4/6/8 步合法着法）。生成器 `bench/new_engine/gen_level_positions.js`。
- **中局组（12 题）**：从既有 66 题中局/战术题库 `bench/new_engine/testset_fens.json` 确定性抽样（QT01/05/10/14/19/24/29/34/39、QH01、QB3、QB9）。**含 QT01**，与上一卡 2.2 节的 580 cp 数字直接对拍。

### 1.2 配置（Threads=4 固定，与卡片给定一致）

| cfg | MultiPV | 取第几候选 | movetime | Hash | 对应档 |
|---|---|---|---|---|---|
| AM | 4 | 4 | 150 ms | 64 | 业余 |
| AD | 3 | 3 | 300 ms | 64 | 进阶（300 ms 补测） |
| EX | 2 | 2 | 500 ms | 128 | 高手 |
| GM | 1 | 1 | 6000 ms | 256 | 大师 |
| S1T300 | 4 | **1** | 300 ms | 64 | 对照：与 AD 同参、取第 1 候选 |

### 1.3 度量口径

沿用上一卡解析口径（一次 `go`→`bestmove` 为一次搜索；按 multipv 槽位分组取每槽最后一条 `info`）。强度指标：

- **ANCHOR**：MultiPV=1、movetime 2000 ms、Hash 256 对该局面的基准评估 `anchor`（行方视角）。
- **SEL**：该配置搜索，取槽位 slot 的 pv 首着 `chosen`，记录各槽 score、depth、nodes。
- **REF**：MultiPV=1、2000 ms 对 `position fen <局面> moves <chosen>` 的评估 `ref`（新行方视角）。
- **loss = anchor + ref**（行方视角下走 `chosen` 后的局面损失）。loss≈0 表示与基准最优同档；loss≈580 表示白丢一子。噪声底 ±20–70 cp（锚与 REF 深度不同造成的评估差）。**loss 越低越强。**

### 1.4 跑法与规模

新测试专用驱动 `bench/new_engine/levels_driver.html` + `levels_run.sh`（与 `run_driver.sh` 同一 serve_upg.js + headless Chrome 配方，仅换驱动页与端口 8798，互不干扰）。
3 轮完整轮次（每轮 17 局面 ×（1 ANCHOR + 5 SEL + 5 REF）= 187 次搜索）+ 1 轮 2 局面冒烟（22 次）。**共 583 次搜索 / 583 条 L 记录；0 次 CRITICAL ERROR、0 次 SKIP、0 次解析失败。**
日志：`bench/new_engine_logs/levels_r1.log` / `levels_r2.log` / `levels_r3.log` / `levels_smoke.log`；聚合结果 `levels_analysis.json`。

---

## 2. 聚合单调性 — 通过

平均 loss（cp，三组轮次独立测量；越低越强）：

| 组 | cfg | r1 | r2 | r3 | 三轮合计 |
|---|---|---|---|---|---|
| 开局 | AM | 101.6 | 96.2 | 93.4 | **97.1** |
| 开局 | AD | 81.2 | 81.0 | 79.2 | **80.5** |
| 开局 | EX | 37.6 | 37.0 | 31.6 | **35.4** |
| 开局 | GM | -3.0 | -1.4 | -8.6 | **-4.3** |
| 开局 | S1T300 | -3.6 | 4.4 | -5.6 | **-1.6** |
| 中局 | AM | 125.3 | 126.4 | 117.1 | **122.9** |
| 中局 | AD | 116.4 | 109.3 | 115.0 | **113.6** |
| 中局 | EX | 99.6 | 94.5 | 101.2 | **98.4** |
| 中局 | GM | -2.5 | -7.3 | -3.5 | **-4.4** |
| 中局 | S1T300 | -3.3 | -5.7 | -2.8 | **-3.9** |

- AM > AD > EX > GM 在**每一轮、每一组**都成立，无反转。GM 与 S1T300 的 loss≈0（负值是锚/REF 深度差噪声），即大师档就是参照上界。
- 相邻差（三轮均值）：中局 AM→AD **9.3**、AD→EX **15.2**、EX→GM **102.8**；开局 AM→AD **16.6**、AD→EX **45.1**、EX→GM **39.7**。

逐对占优（同一局面同轮直接比较，阈值 5 cp；中局 36 样本/对，开局 15）：

| 对局 | 中局 a更差/平/b更差 | 开局 a更差/平/b更差 |
|---|---|---|
| AM vs AD | 15 / 13 / 8 | 5 / 9 / 1 |
| AD vs EX | 17 / 17 / 2 | 8 / 6 / 1 |
| EX vs GM | 19 / 15 / 2 | 6 / 8 / 1 |
| AM vs EX | 21 / 10 / 5 | 8 / 7 / 0 |

方向性稳定（a 更差的样本始终多于 b 更差），但 **AM vs AD 的区分强度明显弱于其他对**（中局 15:8，且平均差仅 9.3 cp，单轮 2.1–17.1 cp，与噪声底同量级）。

---

## 3. 对照实验 S1T300 — movetime 不是强度旋钮，候选序号才是

S1T300 与 AD（进阶）**完全同参数**（MultiPV=4、300 ms、Hash 64），唯一区别是取第 1 候选：

- 中局平均 loss **-3.9**（vs AD 的 113.6）——与 GM（-4.4）不可区分；与 GM 着法一致率 83.3%。
- 开局平均 loss -1.6（vs AD 80.5），与 GM 一致率 60%。

即：**同一思考预算下，取槽 1 ≈ 大师强度，取槽 3 ≈ 业余级劣化**。档位设计实质上完全由"取第几候选"决定，movetime 只决定思考时间。（这也与上一卡"go nodes 不是强度旋钮"的基准结论同构：搜索量参数不是强度旋钮，候选选择才是。）

---

## 4. 逐局面分类 — 相邻可区分在单局面上大多不成立

对每个局面取三轮平均 loss，按"相邻两档差 >20 cp 记为可区分"分类：

```
id           grp     AM    AD    EX    GM   | d(AM-AD) d(AD-EX) d(EX-GM) class
OP00         opening     2     6     2     1 |       -4        4        1      FLAT
OP02         opening    11     8     2     2 |        3        6        0      FLAT
OP04         opening     5     5     3     5 |        0        2       -2      FLAT
OP06         opening   225   151    51    -8 |       74      100       59    GRADED
OP08         opening   242   231   119   -22 |       11      112      141   PARTIAL
MG_QT01      midgame   585   579   580     5 |        6       -1      575   FLAT
MG_QT05      midgame    31    23    12    -4 |        8       11       16   FLAT
MG_QT10      midgame    35    39    35     1 |       -4        4       34   FLAT
MG_QT14      midgame    36    41    -1    -4 |       -5       42        3   PARTIAL
MG_QT19      midgame   569   586   579     1 |      -17        7      578   FLAT
MG_QT24      midgame     1     0     0    -1 |        1        0        1    FLAT
MG_QT29      midgame    14     4     2    -1 |       10        2        3    FLAT
MG_QT34      midgame    24    11    12    -1 |       13       -1       13    FLAT
MG_QT39      midgame    13     6     5     2 |        7        1        3    FLAT
MG_QH01      midgame     0     1     0    -6 |       -1        1        6    FLAT
MG_QB3       midgame   159    74   -34   -43 |       85      108        9   GRADED
MG_QB9       midgame     8    -1    -8    -2 |        9        7       -6    FLAT
```

**合计：GRADED 2/17，PARTIAL 2/17，FLAT 13/17。** 两种失效形态：

1. **候选同烂**（MG_QT01 / MG_QT19，上一卡报告过的少子形）：槽 2/3/4 全是丢子着法（score 都 ≈ -600），AM/AD/EX 无一例外全部丢子，三档互相差 0–17 cp，但都与 GM 差 575–585 cp。梯度只有"丢子/不丢子"一级，没有三档。
   例（r1, MG_QT19）：`AM slots=1:-14,2:-580,3:-595,4:-589`；`AD slots=1:-20,2:-585,3:-590`；`EX slots=1:-16,2:-596`；GM 槽 1 `c7c3`（-14）。
2. **候选同好**（OP00/02/04、MG_QT24 等）：槽间差 0–10 cp，取哪个槽都一样强，FLAT。

只有**候选质量存在真实中间梯度**的局面（OP06、OP08、MG_QB3、MG_QT05 等）才出现三档分离。例（r1, OP06）：`AM slots=1:124,2:98,3:-27,4:-67 → 取 -67`；`AD slots=1:112,2:88,3:-25 → 取 -25`；`EX slots=1:121,2:81 → 取 81`；loss 225/151/51/-8，完美单调。

---

## 5. 风险点 1 量化：候选差随局面的分布（gap = 槽1 − 所取槽 的 score 差）

| 组 | cfg | n | <10 cp | 10–49 | 50–199 | 200–499 | ≥500 |
|---|---|---|---|---|---|---|---|
| 开局 | AM | 15 | 8 | 1 | 1 | 5 | 0 |
| 开局 | AD | 15 | 8 | 1 | 3 | 3 | 0 |
| 开局 | EX | 15 | 9 | 3 | 3 | 0 | 0 |
| 中局 | AM | 36 | 6 | 20 | 4 | 0 | 6 |
| 中局 | AD | 36 | 14 | 13 | 3 | 0 | 6 |
| 中局 | EX | 36 | 20 | 10 | 0 | 0 | 6 |

- 上一卡"开局 3–15 cp / 中局 570–590 cp"的不对称**部分成立但过于极端**：本基线里中局多数局面（AM 26/36）gap 在 50 cp 以内，≥500 cp 的大 gap 只出现在 6/36 个少子形样本；开局在走了几步后的 OP06/OP08 反而出现 137–263 cp 的大 gap。**决定 gap 的不是"开局 vs 中局"，而是该局面是否存在质量分层。**
- 与上一卡对拍：MG_QT01 槽1→槽4 gap 实测 585/580/586 cp（三轮），与 NEW_ENGINE_OPTIONS.md 2.2 的 580 cp **一致**（引擎行为可复现）。

---

## 6. 300 ms 补测（进阶档参数）

AD 配置（MultiPV=3、300 ms、Hash 64、4 线程）实测搜索规模：

| 组 | depth 范围 | nodes 范围 |
|---|---|---|
| 开局 | d13–17 | 487,730–649,238 |
| 中局 | d12–19 | 405,405–632,208 |

介于上一卡已测的 150 ms（d12–14 / 380k–390k）与 500 ms（d16–17 / 1.14M）之间，行为符合预期；无超时、无 CRITICAL。

各档搜索规模全表（供接线参考）：

| cfg | 中局 depth | 中局 nodes | 开局 depth | 开局 nodes |
|---|---|---|---|---|
| AM | d10–16 | 215k–321k | d12–15 | 240k–316k |
| AD | d12–19 | 405k–632k | d13–17 | 488k–649k |
| EX | d13–23 | 679k–983k | d15–19 | 829k–987k |
| GM | d22–39 | 8.26M–12.26M | d25–30 | 9.06M–11.03M |

---

## 7. 风险点 2 量化：跨轮不稳定

同一局面同一配置跑 3 轮，所取着法是否变化（85 个 局面×配置 对）：

| cfg | 不稳定对数 |
|---|---|
| AM | 14/17 |
| AD | 15/17 |
| EX | 10/17 |
| GM | 6/17 |
| S1T300 | 6/17 |

- 与上一卡结论一致：4 线程 + MultiPV≥2 候选顺序跨运行不稳定；**连 GM（MultiPV=1、4 线程）也有 6/17 局面跨轮换着**（多线程搜索本身非确定），但其 loss 始终 ≈0，强度不受影响。
- **聚合层面稳定**：三轮组均值漂移 ≤10 cp（AM 中局 125.3/126.4/117.1），单调结论在三轮中全部复现。即：单局方差大，档位期望强度稳定。对弱档这就是"可接受的棋风多样性"，但接线时**不能承诺可复现着法**。

---

## 8. 与验收判据的对照（判定汇总）

判据原文："只要求中间三档在入门与大师之间单调、相邻可区分，不要求复刻旧 Elo 数值。"

1. **单调：通过。** 聚合均值严格 AM>AD>EX>GM，开局/中局两组、三轮独立复现，无反转。
2. **相邻可区分：有条件通过，其中一对不达标。**
   - EX→GM：强区分（中局 ~103 cp，占优 19:2）。
   - AD→EX：中等（~15 cp，占优 17:2）。
   - **AM→AD：不达标**（中局 ~9 cp，占优 15:8，单轮最小 2.1 cp，淹没在噪声里）。业余与进阶在期望意义上几乎同强。
3. **入门边界**：入门=内置引擎不在本卡范围，未实测。从搜索规模推断（内置 d2 vs AM 的 d10–16 / 215k+ 节点）AM 必然强于入门，但这是**推断不是测量**。
4. **逐局面可区分性差**（13/17 FLAT）：单对局里玩家可能感觉不到相邻档的差别；可区分性依赖局面的候选质量梯度，不由参数保证。

**若要让 AM 与 AD 真正拉开**，本基线能给出的直接线索（属下一卡的决策，不在本卡实施）：三档参数差异中真正起作用的是"取第几候选"；在候选同烂/同好的局面里任何槽序号都不产生差。要让弱档在更多局面变弱，需要让"所选候选"与槽 1 的 score gap 成为受控量（例如按 gap 阈值过滤/在候选池内随机），或对 AM 叠加其它降质手段——纯参数（movetime/Hash）已被 S1T300 对照证伪。

---

## 9. 最小复现步骤（供 programmer 接手）

```bash
cd /c/Users/35165/xiangqi/bench/new_engine
node gen_level_positions.js                 # 生成 level_positions.json（17 题）
node gen_level_task.js 1                    # 生成 task_levels_r1.json（同 r2/r3；smoke 加参数 smoke）
bash levels_run.sh task_levels_r1.json levels_r1.log 400   # 一轮 ≈6–8 分钟；必须后台/长轮询跑（前台工具超时会杀掉 serve 子进程导致日志停增）
node analyze_levels.js levels_r1.log levels_r2.log levels_r3.log   # 聚合表 + levels_analysis.json
node grading_by_position.js                # 逐局面 GRADED/PARTIAL/FLAT 表
```

运维注记：`levels_run.sh` 用独立端口 8798 与独立 Chrome profile（chrome-lvl），与生产 `run_driver.sh`（8797/chrome-opt）互不干扰；若上一轮 Chrome 未退干净会报 `Device or resource busy`，先跑 `kill_chrome_by_profile.ps1 chrome-lvl`（`clean_r3.sh` 里有现成配方）。

## 10. 本卡新增文件（全部测试用途，未动生产）

- 驱动/脚本：`bench/new_engine/levels_driver.html`、`levels_run.sh`、`gen_level_positions.js`、`gen_level_task.js`、`analyze_levels.js`、`per_pos_detail.js`、`instability_by_cfg.js`、`grading_by_position.js`、`r3_retry.sh`、`clean_r3.sh`
- 题集/任务：`bench/new_engine/level_positions.json`、`task_levels_smoke.json`、`task_levels_r1/2/3.json`
- 日志/结果：`bench/new_engine_logs/levels_smoke.log`（22 条）、`levels_r1.log`/`levels_r2.log`/`levels_r3.log`（各 187 条 L 记录）、`levels_analysis.json`
- 本报告：`bench/NEW_ENGINE_LEVELS_BASELINE.md`

未改任何生产文件，未 commit、未 push。
