# 五档强度定标：按新契约（cap + p）定案 + 五档互弈实测

卡：t_a8096ea3 · 日期 2026-10-04（跨 00:2x 收尾）· 作者 programmer
契约来源：用户 2026-10-04 21:40 定案（t_a8096ea3 卡正文 / t_9c93fb06 评论）

```
cap    = 该档的稳定强度：它 normally 会走的最差候选（相对最佳候选的恶化上限）
p      = 不走稳定选择、改走失误候选的概率
band   = 失误能走多远：只有 cap < gap <= cap+band 的候选可被选中（mistakeBand）
movetime / Hash 故意不作为阶梯参数
```

**三个参数，不是两个**（review round 1 第 2 项要求补齐）。`mistakeBand` 就是前卡
`bench/NEW_ENGINE_WEAK_TIER_BOUNDED.md`（t_f844043c）里那个 **bounded 劣化上限**的同一件事，只是换了
参考点：bounded 卡要求随机着法相对**最佳候选**劣化 ≤ cap；本卡要求失误相对**稳定选择**严格更差、且劣化
≤ cap+band。两者存在的理由相同——bounded 卡的验收判据 1a 是"丢子率(loss>300cp) 回到 ≈0%"，本卡 §4.1 实测
证明**不设上限的 band 会把这个结论推翻**（MG_QT01 上走出 583cp 的漏着）。`hardMistakeBand 700` 是同一
上限在少子形位置的取值。接线时 band 不是新维度，不要另实现一遍。

理由（已在前卡实测过，本卡只做再验证）：`NEW_ENGINE_LEVELS_BASELINE.md §3`（S1T300 对照）与
`FINAL_REPORT.md 基准三之二`（go nodes）都表明搜索量不是强度旋钮。

---

## 1. 结论（可直接落地的五档参数）

`bench/new_engine/tier_tiers.json` 是机器可读的定案文件（由 `tier_decide.js` 从实测数据生成，
带单调性闸门：若 大师<高手<进阶<业余 不成立就拒绝写文件）。

| 档 | 引擎 | 参数 | 实测/预测平均丢子（cp，vs ANCHOR 最佳着法） |
|---|---|---|---|
| 入门 | 内置引擎，**完全不改** | `engine.js LEVELS[0]`：depth2 / qDepth0 / 1500 nodes / randomness45 | 前卡已定基线（本卡不改） |
| 业余 | 新引擎 | **cap 80, p 0.50, band 200** | 实测 46.3（P50）· 预测 50.0 |
| 进阶 | 新引擎 | **cap 80, p 0, band 200** | 实测 31.8（CAP80）· 预测 31.1 |
| 高手 | 新引擎 | **cap 25, p 0.10, band 200** | 实测 12.6（G10）· 预测 12.8 |
| 大师 | 新引擎 | MultiPV=1 / movetime 2000 / Hash 256（= 已测 ANCHOR 配置），cap 0 p 0 —— **movetime 是待真机复核的取值，不是硬上限，见 §8** | 实测 −4.8（ANCH）· cap0@300 实测 −0.4 |
| 对照 | 新引擎 | cap 0 / p 0 @ 档位预算（MultiPV8 / 300ms / Hash64） | 实测 −0.4 |

**一页定案摘要在 `bench/TIER_DESIGN_FINAL.md`**（参数表 + 每档实测数字与失误生效率 + 待复核项 + 指针）；
本节与本报告其余部分是详细数据，接入卡（t_9c93fb06）**以 `tier_tiers.json` 接线**。

所有引擎档共用**同一搜索预算**：`movetime 300 / MultiPV 8 / Hash 64 / Threads 4`。
只有 大师 例外——它是天花板（MultiPV=1 + 更长思考），不是一级台阶；契约里"movetime 不作为阶梯"
正是为了不把五档变成"思考时间差"，这一点在互弈里也验证了（见 §7 的 nodes 列：三档引擎均值
587k / 617k / 650k nodes，几乎相同；大师 3.99M）。

契约逐条对照：
- 业余 = 接近进阶但会失误：**同一个 cap 80**，只差 p=0.5 → 稳定强度相同，失误维度把它拉低 14.5 cp；
  互弈里 进阶 4:0 胜 业余（113/82/137/74 ply，四局全是进阶把业余将死）。✅
- 进阶 = 稳定地弱于高手：cap 80 vs 25，p 都是 0/0.1 → 差 19.2 cp（预测）/ 19.2（实测 CAP80−G10=19.2）；
  互弈 高手 4:0 胜 进阶。✅
- 高手 = 接近大师但偶尔失误：cap 25 + p0.10，与 cap0 差 12–17 cp；互弈 大师 3:1 胜 高手。✅
- 大师 = 上限：MultiPV=1，无 cap/p；互弈 大师 3:1 高手、4:0 进阶。✅
- 入门：内置引擎一行未改（互弈里直接调 `game.aiMove(2,0,1500,45)`，sha256 校验 `xq_engine.js` 与仓库 `engine.js` 一致）。
  互弈里 业余 8:0、进阶 4:0 胜 入门。✅

---

## 2. 台架（全部 TEST-ONLY，不动生产代码）

| 文件 | 作用 |
|---|---|
| `bench/new_engine/tier_rules.js` | 五档选择规则本体（162 行，**无 DOM、无外部依赖**，可直接复制到 `js/`） |
| `bench/new_engine/test_tier_rules.js` | TDD 单测：**29 passed, 0 failed** |
| `bench/new_engine/tier_gen_task.js` | 定标任务生成器：同一 17 个基准位置，固定预算，只变 cap/p/band，含 MT150 / CAP0 对照 |
| `bench/new_engine/tier_driver.html` | 浏览器定标 harness（复用 `worker_mb.js` + 同一 ANCHOR/REF 度量，不重复实现选择规则） |
| `bench/new_engine/tier_run.sh` | runner（serve_upg.js + headless Chrome，端口 8801，profile `chrome-tier`，不与 8797–8800 冲突） |
| `bench/new_engine/tier_verify.js` | 离线 replay：从日志里的候选池重放选择，与浏览器实际选择逐条比对 |
| `bench/new_engine/tier_fit.js` | 用 `expectedGap` 预测池内恶化，回归实测丢子 → E[gap]→真实丢子 的换算 |
| `bench/new_engine/tier_decide.js` | 生成 `tier_tiers.json`（含单调性闸门） |
| `bench/new_engine/tier_sep.js` | 区分度检验（相邻档 >20 cp 判据） |
| `bench/new_engine/tier_stability.js` | 轮间稳定性 / 噪声底 |
| `bench/new_engine/tier_gen_ceiling.js` + `tier_r3.log` | 大师上限探测（MultiPV=1，movetime 1/2/4/8s，6 位置） |
| `bench/new_engine/tier_gen_band.js` + `tier_r4.log` | **review r1 第 1 项**：同一 17 位置/同一预算，只变 mistakeBand（cap+50 / cap+200 / 不设上限）三组对照 |
| `bench/new_engine/tier_band_report.js` | band 的**结构性天花板**：从已记录的候选池用 `tier_rules` 同一条 band 判据算 band 空率（不需要跑引擎），并给出 `p × P(band 非空)` 的预测生效率 |
| `bench/new_engine/tier_effect_report.js` | **实测生效率**：定标侧（tier_analysis_*）与对局侧（games_*）分别统计 fired / bandN>0 / effective(rand) / effectRate |
| `bench/new_engine/tier_gen_ceiling2.js` + `tier_r5.log` | **review r1 第 3 项**：大师 movetime 阶梯扩到 10 位置（含少儿形/HARD fixtures）+ 内存与首载计时 |
| `bench/new_engine/tier_ceiling_cost.js` | 读 `tier_r5.log` 的 HEAP/TIMING/NET 行：首载成本、WASM heap、各 movetime 的 nodes/depth/丢子 |
| `bench/new_engine/tier_gen_games.js` / `tier_games.html` / `tier_games_report.js` | 五档互弈生成器 / 对局 harness / 结果汇总 |

日志与分析产物：`bench/new_engine_logs/tier_r1.log`（447 行）、`tier_r2.log`、`tier_r3.log`、
`tier_r4.log`（289 行）、`tier_r5.log`（242 行）、`tier_analysis.json`、`tier_analysis_r1.json`、
`tier_analysis_r2.json`、`tier_analysis_r3.json`、`tier_analysis_r4.json`、`tier_analysis_r5.json`、
`tier_fit_out.json`、`games_smoke.log`、`games_r1.log`（1050 行 / 16 局）、`games_r2.log`。

**一致性校验**：`tier_verify.js` 对 r1+r2 共 408 次选择做离线重放，**mismatches=0**；smoke 轮 0 不一致。
也就是浏览器里实际走的着法，和 Node 侧用同一 `tier_rules.js` + 同一 seed 重放的结果完全一致——
规则可以安全复制到 `js/`。

---

## 3. cap 阶梯（17 位置 × 2 轮，同一 300ms/MultiPV8/Hash64 预算）

`tier_verify.js` 表（loss = 相对 ANCHOR 最佳着法丢的 centipawn，0 = 走了最佳着法）：

```
cfg     n   hitShare                 gapMean gapMed gapMax  predGap  costMean costMed costOpen costMid  nodesMean
CAP0    17  above:1.00                0.0     0.0    0.0     0.0     -0.4     1.0     1.6     -1.3     569818
CAP25   17  cap:0.65,above:0.35      11.2    11.0   25.0    11.2     11.3     6.0     3.0     14.8     572252
CAP50   17  cap:0.82,above:0.18      23.8    22.0   47.0    23.8     17.2    20.0    13.6     18.8     560841
CAP80   17  cap:0.82,above:0.18      29.5    25.0   66.0    29.5     31.8    18.0    16.4     38.3     579884
CAP150  17  cap:0.88,above:0.12      44.9    29.0  141.0    44.9     58.0    25.0    44.4     63.7     569605
```

- cap 单调有效：−0.4 → 11.3 → 17.2 → 31.8 → 58.0 cp。
- `hitShare` 说明规则在按设计工作：cap 越大越常"顶到 cap 边界"（0.65→0.88），`above` 份额随之下降。
- **所有 cfg 的 nodesMean 几乎相同（560k–580k）**：强度差不是搜索量差。这是契约的直接证据。
- 小 cap 区间（本卡要求的"小 cap 区间标定"）：cap 0–25 这一段确实很平（−0.4 → 11.3），
  说明"接近大师"只能靠很小的 cap + 很小的 p，不能靠中等 cap。

## 4. p 阶梯与 band 的耦合（本卡最重要的新发现）

```
P10   cap80 p0.10 band200  bmiss:0.18 cap:0.71   gapMean 28.5  costMean 31.6
P25   cap80 p0.25 band200  cap:0.76 bmiss:0.12   gapMean 28.1  costMean 29.4
P50   cap80 p0.50 band200  bmiss:0.41 cap:0.35 rand:0.12  gapMean 44.8  costMean 46.3
G10   cap25 p0.10 band200  cap:0.65 rand:0.06    gapMean 20.9  costMean 12.6
HRD   cap80 p0.25 + hardCap0/hardBand700         gapMean 47.6  costMean 48.6
```

- **p 只在 band 里真有候选时才起作用**：p=0.10/0.25 时 band（cap+200）经常没有"严格更差"的候选，
  规则退回稳定选择（`bmiss`），实测 31.6 / 29.4 ≈ CAP80 的 31.8 —— 等于没失误。
- p=0.50 才有可测下降（46.3，比 CAP80 高 14.5 cp）。所以 **业余档定 p=0.50，不是 p=0.25**。
- 互弈里的 realized 比率也印证：T_YOU 尝试走失误分支 134/260 = 51.5%（≈p），但真正走出更差着法
  只有 58/260 = 22%（76 次 band 空 → bmiss）。**p 与 band 必须一起定；单给 p 会被 band 稀释。**
- HARD 位置（所有备选都是悬崖）不能强推 570cp 大漏：`hardCap 0` + `hardMistakeBand 700` 的组合
  （HRD）把中局拉低到 48.6 但不产生随机大漏，单测里也锁住了"p=0 时永不丢子"。

### 4.1 p 的真实生效率 + band 三组对照（review round 1 第 1 项，补测 r4）

**生效率定义**：`生效率 = 实际走出比稳定选择更差的着法的比例（hit=rand）`。它等于 `p × P(band 非空)`，
**永远小于 p**。定标侧与对局侧是两个不同的数字，都必须写出来。

补测轮 `tier_gen_band.js` → `task_tier_r4.json` → `tier_r4.log`（同一 17 位置、同一
300ms/MultiPV8/Hash64 预算，只变 mistakeBand；`tier_verify.js` 重放 136 次选择 **0 不一致**）：

```
node tier_verify.js tier_r4.log --out tier_analysis_r4.json
cfg      cap p    band        hitShare                              gapMean costMean  open   mid    hard   gapMax
CAP80    80  0    -           cap:0.82,above:0.18                    29.8   37.4    21.8   43.8   -1.5    73
B50      80  0.50 cap+50      bmiss:0.29 cap:0.41 above:0.18 rand:0.12 37.1  43.9    18.8   54.4    0.5   128
B200     80  0.50 cap+200     bmiss:0.12 cap:0.65 rand:0.12 above:0.12 47.8  52.9    70.6   45.6   -1.5   240
BINF     80  0.50 不设上限     cap:0.41 bmiss:0.29 rand:0.24 above:0.06 94.6 104.6   107.2  103.5  290.5   588
G50      25  0.10 cap+50      cap:0.71 above:0.24 rand:0.06          47.4   46.8    11.2   61.7  291.0   565
G200     25  0.10 cap+200     cap:0.65,above:0.35                    12.4    8.0     3.6    9.8    2.5    25
GINF     25  0.10 不设上限     cap:0.71 above:0.24 rand:0.06          46.2   38.5    3.2    53.3  283.5   556
ANCH     度量噪声底                                                  0.0    -4.3    -4.8   -4.1     -      -
```

结论（三条，都是实测不是推断）：

1. **band 从 cap+50 到 cap+200 不是强度旋钮**：43.9 vs 52.9 cp（中局 54.4 vs 45.6，方向相反），
   差值在 §6 的噪声底之内，且两者都高于 p=0 参照（37.4）。**要更弱就动 cap 或 p，不要动 band。**
2. **去掉上限会真的变弱，但会破坏 bounded 约束**：104.6 cp，其中少子形均值 290.5 cp、MG_QT01 出现
   **583cp 的漏着**——这正是 t_f844043c 那张卡要消灭的"白丢子"。所以 **mistakeBand 保持 200（有界）**。
3. **生效率有结构性天花板**（`tier_band_report.js`，用日志里已记录的候选池 + `tier_rules` 同一条 band
   判据，不需要跑引擎）。复核者自己算的 14/17=82%、13/17=76%、11/17=65%（平均 band gap 101.8 / 157.7 /
   314.9）**逐条复现**——那是 r2 池 + "不分类覆盖的普通 cfg"（下面的 shape B）这个读法：

```
node tier_band_report.js            # 默认读 tier_analysis_r1.json + tier_analysis_r2.json（34 池）
shape A = 定案实际写入的 cfg 形态（openingCap=cap、hardCap0/hardBand700）
shape B = 不分类覆盖的普通 cfg（= 定标时真正探测的 cfg，也是复核者的读法）
cap=80  band = cap+50 / cap+200 / 不设上限
        A: band 空率 74% / 65% / 65%  → P(非空)=26% / 35% / 35%   非空池均值 band gap 321 / 304 / 311
        B: band 空率 85% / 76% / 65%  → P(非空)=15% / 24% / 35%   非空池均值 band gap 102 / 158 / 315
        （只读 r2 的 17 池时 B 行 = 82% / 76% / 65%，即复核者的三个数字）
cap=25  A: 空率 35% / 29% / 29% → P(非空)=65% / 71% / 71%
        B: 空率 47% / 41% / 29% → P(非空)=53% / 59% / 71%
```

   即 **p 的生效率天花板 ≈ 35%（cap 80）**，调 band 只能把生效率从 ~15% 抬到 ~35% 并放大失误幅度，
   不可能做到"p=0.5 就每两步错一次"。定案写入的 cfg 形态（A）天花板 26%/35%，`tier_tiers.json` 里
   两个都写了（`bandCeilingProbedCfg` / `bandCeilingDecidedCfg`）。实测生效率（`tier_effect_report.js`）：

```
定标侧（tier_analysis_r1 + r2 合并，34 次选择/cfg；r1/r2 分轮值见 tier_tiers.json.mistakeEffectRate.calibration.perRound）
  P50 (业余参数)  fired 56%   生效 12%   生效/触发 21%
  G10 (高手参数)  fired 12%   生效  9%   生效/触发 75%
对局侧（games_r1 + games_r2，32 局 1388 步）
  T_YOU 业余  541 步  生效 20.1%（109 步真走更差着法，162 步触发但 band 空）  失误幅度 中位 116cp / p90 220 / max 264
  T_GAO 高手  397 步  生效  7.1%（28 步真走更差着法， 13 步触发但 band 空）  失误幅度 中位  94cp / p90 181 / max 200
  T_JIN 进阶  450 步  生效 0%（p=0，按设计）
少子形（HARD）34 步：三个引擎档全部走池内最佳（hit=above/bmiss，0 次 rand）——bounded 约束生效，
                     但也意味着低档在少子形里显得"过分谨慎"，这是设计后果，不是 bug。
```

**业余档推荐组合（不变，但带生效率数字）**：`cap 80 / p 0.50 / mistakeBand 200`，实测生效率 12%（定标）
/ 20.1%（对局）。若接入方希望生效率更高，可选的是 `mistakeBand` 放宽到不设上限（生效率→35%，代价是
少子形 290cp 均值 + 583cp 漏着），**不建议**：那会推翻 t_f844043c 的 1a 结论。

## 5. 两个控制实验

- **MT150**（cap80 但 movetime 150）实测 33.2 vs CAP80@300 实测 31.8，差 **1.4 cp**，
  远小于噪声底（见 §6），nodesMean 298k vs 580k（搜索量减半）。
  → **同一 cap 在不同 movetime 下不可区分**，契约的"movetime 不是强度旋钮"在本台架成立。✅
- **CAP0**（永远选最佳候选，档位预算）实测 −0.4，与 ANCH（−4.8）差 4.4 cp，
  即"档位预算下的最佳候选 ≈ 大师水平"。→ 大师不需要额外 cap 语义，它=cap0 + 更长思考。✅

## 6. 噪声底与轮间稳定性（为什么不能过度解读小数点）

`tier_stability.js`（r1 vs r2，同一 cfg、不同 seedSalt）：

```
cfg     A mean  B mean  delta   per-position |delta|>20cp
CAP0     -0.9    -0.4    0.5    2/17
CAP25    11.7    11.3   -0.4    5/17
CAP50    31.2    17.2  -13.9    4/17
CAP80    28.5    31.8    3.3    4/17
CAP150   64.2    58.0   -6.2    1/17
P50      43.6    46.3    2.7    3/17
ANCH     -0.2    -4.8   -4.6    1/17
CAP0 单位置 sd=7.0   ANCH 单位置 sd=6.7
```

**噪声底 ≈ 单位置 ±7 cp、轮均 ±14 cp（CAP50 那一档最不稳）。** 因此五档之间的目标间距要 ≳20 cp，
且不能声称能区分相差 <15 cp 的两档。这也解释了为什么中间档取 cap 25 / 80 这种"拉开的"值，
而不是 40 / 60 这种相邻 20 cp 内的值。

## 7. 五档互弈实测（r1+r2 共 32 局，先跑通 smoke 8 局）

`tier_games_report.js games_r1.log games_r2.log`：

```
pair             hiCfg loCfg  hiWin loWin draw  plies(r1+r2)              invalid
业余_vs_入门      T_YOU T_RUKN  8    0     0    63/56/61/56/39/14/145/38  0
进阶_vs_业余      T_JIN T_YOU   4    0     0    113/82/137/74             0
高手_vs_进阶      T_GAO T_JIN   4    0     0    115/62/59/30              0
大师_vs_高手      T_DA  T_GAO   3    1     0    89/106/83/44              0
高手_vs_业余      T_GAO T_YOU   3    1     0    37/52/37/78               0
大师_vs_进阶      T_DA  T_JIN   4    0     0    51/32/41/48              0
进阶_vs_入门      T_JIN T_RUKN  4    0     0    13/10/21/12              0
ladder check: pairs passing=7 failing=0 ; total invalid moves=0 ; critical-error searches=0
end reasons: 将死 30, 红方长将红方负 1, 黑方长将黑方负 1

per-tier move statistics (32 局)
cfg    moves rand cap above bmiss builtin best randShare gapMean gapMax nodesMean
T_YOU   541  109  198  72   162   0       0     0.20     58     264    600063
T_JIN   450    0  308  142    0   0       0     0.00     38      80    625798
T_GAO   397   28  137  219   13   0       0     0.07     13     200    650810
T_DA    249    0    0    0    0   0     249     0.00      0       0   3951218
T_RUKN  261    0    0    0    0  261      0     0.00      0       0      1183
```

- 7 个对子全部按设计方向结束（hi 未被 lo 击败），**0 个非法着法、0 次引擎报错** → 规则在完整对局里
  不产生非法/退化行为。
- **对局内的 gapMean 13 / 38 / 58、randShare 0.07 / 0 / 0.20、nodes 同预算（600k/626k/651k）** ——
  三档引擎在真实对局里也保持同一思考量、只靠 cap/p 分层，与定标侧的 gapMean 14/35/60 一致。
- 相邻档胜负方向全部正确：业余 8:0 入门、进阶 4:0 业余、高手 4:0 进阶、大师 3:1 高手、大师 4:0 进阶、
  进阶 4:0 入门；跨档 高手 3:1 业余（r1 里那局 1:1 在 r2 被纠正为 hi 胜，说明 r1 的输局是判例个例
  ——长将判负，不是强度方向错误）。
- 两局非"将死"结束（红方长将负 / 黑方长将负）：判例由 harness 的 `checkEnd` 判，引擎侧只设
  `Repetition Rule AsianRule / Draw Rule None / Sixty Move Rule true`，与生产 bridge（`bench/pf.js`）一致。
  弱档靠长将/长捉判例翻盘是**真实低档行为**（会失误的一方更容易走出可被长将的形），不是台架 bug。

## 8. 大师上限（r3 6 位置 + r5 10 位置，MultiPV=1 movetime 阶梯）

r5（`tier_gen_ceiling2.js` → `task_tier_r5.json` → `tier_r5.log`，10 位置含少儿形/HARD fixtures，
`tier_verify.js` replay 70 次选择 **0 不一致**；`tier_ceiling_cost.js` 读内存与首载计时）：

```
cfg      n  lossMean nodesMean  depthMean  heapMax
M300M8  10    -2.5      580900      12.8   547 MB   (档位预算下的最佳候选)
M1000   10    -0.4     1773897      21.7   547 MB
M2000   10    -4.5     3447290      24.0   547 MB   (= ANCH 同预算)
M4000   10    -3.7     7013783      26.9   547 MB
M6000   10    -2.7    10311265      28.1   547 MB
M8000   10    -4.1    13671819      30.3   547 MB
ANCH    10    -3.0     3485837      23.3   547 MB
```

- 两轮（r3 6 位置 / r5 10 位置）方向一致：300ms → 1000ms 有收益；**1000ms 以上在噪声内持平**
  （r5 的 lossMean 在 -0.4 … -4.5 之间来回跳，单位置噪声 ±7cp，顺序不稳定：M1000 在 OP08 上 -23cp，
  M2000 在 MG_QT01 上 +9cp）。**strength 列在这个样本量上只是方向检查，不是测量。**
- **内存成本来自 Hash，不是 movetime**：WASM heap 初始化后 ~307MB，跑任何 movetime 都停在 547MB
  （Hash 256 的 TT 一次性占满），1000ms 与 8000ms 的 heap 完全相同。
- 首载成本（一次/会话，`worker_mb.js` 计时）：importScripts 5ms + WASM module 42ms + NNUE 下载 166ms
  （50.7MB）+ FS 写入 179ms + engine initialize 551ms。
- 因此 大师 取 `movetime 2000 / MultiPV=1 / Hash 256`，**取值理由是"平坦区里最便宜的一个"，不是
  "它更强"**；`tier_tiers.json` 里它带 `status: "pending-real-device"`、`movetimeAlternatives`
  （1000/2000/4000/6000/8000，含旧默认 6000）与 `measuredCost`，不继承旧 6000 默认值。
  **待复核**：样本只有 6 / 10 个 bench 位置，需要真机 + 复杂位置复核内存、首载、UI 延迟后才能定案。

## 9. 区分度检验（>20 cp 判据，沿用 NEW_ENGINE_LEVELS_BASELINE.md §4）

`tier_sep.js`：

```
modelled adjacent-pair separation
大师 -> 高手   mean 20.8   9/17 位置 >20cp (53%)   反向 0
高手 -> 进阶   mean 18.3   7/17 (41%)              反向 1
进阶 -> 业余   mean 18.8   4/17 (24%)              反向 0

measured separation between probed points
CAP0 -> CAP25   11.7   6/17
CAP25 -> CAP50   5.9   4/17
CAP50 -> CAP80  14.6   5/17
CAP80 -> CAP150 26.2   3/17
CAP80 -> P50    14.5   3/17     (业余 − 进阶，纯 p 维度)
CAP80 -> MT150   1.4   3/17     (movetime 对照：不可区分)
CAP0  -> ANCH   -4.4   0/17     (噪声底)
```

诚实结论：**按位置看，相邻档的 >20cp 命中率只有 24–53%**（单位置噪声 ±7 cp 所致）；
**按均值看三对相邻档都拉开 18–21 cp**，且互弈 7/7 对子方向正确。也就是说这套参数在"平均强度"
上可区分、在"单手棋"上不可保证可区分——这与前卡 AM0/AC_AM 的结论一致，不是本卡新引入的问题。

## 10. 局限 / 下一步

1. 单位置噪声大：17 个位置里 2 个 HARD、若干"所有备选都差"的位置（MG_QT19/QT24）几乎不产生信号；
   要更细的定标需要更多"有中间梯度"的中局位置。
2. 互弈样本 32 局，够判方向（7/7 对子正确），不够给"胜率差"的置信区间；跨档对（高手 vs 业余）
   出现 1 局长将判负，属于真实判例行为而非规则缺陷。
3. Node 直接驱动 WASM 不可用（`build_nothreads.sh` 用 `-sENVIRONMENT=web,worker`，Emscripten 的
   Node fallback 被编译掉；`wasmBinary` / `instantiateWasm` / 直接 `WebAssembly.instantiate` 都试过），
   所以定标与互弈都走 headless Chrome + `worker_mb.js`。规则本体是 dependency-free 的，Node 侧只做
   单测与 replay。
4. 生产接入不在本卡范围。接入点已核对：`engine.js:489 aiMove(depth, qDepth, maxNodes, randomness)`
   只有内置引擎一条路径，新引擎档需要在 `js/` 侧新增一条调用 `tier_rules.js` 的分支（pikafish 桥已存在，
   见 `js/` 的 MultiPV/movetime 选项），本卡只交付参数与台架，不改生产代码。

## 11. 复现命令

```bash
cd /c/Users/35165/xiangqi/bench/new_engine
node test_tier_rules.js                      # 29 passed, 0 failed
node tier_gen_task.js 1 && node tier_gen_task.js 2
bash tier_rounds.sh                          # 17 位置 × 12 cfg × 2 轮
node tier_verify.js tier_r1.log tier_r2.log # replay mismatches=0
node tier_fit.js
node tier_decide.js                          # 单调性闸门 PASS -> tier_tiers.json
node tier_sep.js ; node tier_stability.js tier_analysis_r1.json tier_analysis_r2.json
node tier_gen_games.js 1 && node tier_gen_games.js 2
bash tier_run.sh task_games_r1.json games_r1.log 3000 tier_games.html
node tier_games_report.js games_r1.log
node tier_gen_ceiling.js && bash tier_run.sh task_tier_r3.json tier_r3.log 900 tier_driver.html

# review round 1 整改新增
node tier_gen_band.js && bash tier_run.sh task_tier_r4.json tier_r4.log 1500 tier_driver.html
node tier_verify.js tier_r4.log --out tier_analysis_r4.json      # 136 selections, mismatches=0
node tier_band_report.js                                          # band 结构性天花板（含复核者的 82/76/65%）
node tier_effect_report.js                                        # 实测生效率（定标侧 + 对局侧）
node tier_gen_ceiling2.js && bash tier_run.sh task_tier_r5.json tier_r5.log 2500 tier_driver.html
node tier_verify.js tier_r5.log --out tier_analysis_r5.json      # 70 selections, mismatches=0
node tier_ceiling_cost.js tier_r5.log                            # 首载/内存/各 movetime 成本
node tier_decide.js                                              # 重写 tier_tiers.json（含生效率与 pending 标注）
```

一页定案摘要：`bench/TIER_DESIGN_FINAL.md`（只放参数表 + 每档实测数字与生效率 + 待复核项 + 指向本报告
与 `tier_tiers.json` 的指针；详细数据不在那里重复，接线以 `tier_tiers.json` 为准）。
