# 五档强度定案 · 一页摘要

卡：t_a8096ea3（review round 1 整改后）· 日期 2026-10-05 · 作者 programmer

> 本页只是定案摘要。**详细数据、实验表、复现命令只有一份正文，在**
> `bench/NEW_ENGINE_TIER_CALIBRATION.md`；**机器可读的接线参数只有一份，在**
> `bench/new_engine/tier_tiers.json`。本页不复制详细数据，避免两处正文漂移。
> **接入卡（t_9c93fb06）接线以 `tier_tiers.json` 为准**，本页与详细报告只作背景。

---

## 1. 五档参数（定案）

契约是**三个参数**：`cap`（稳定强度）/ `p`（走失误分支的概率）/ `mistakeBand`（失误能走多远，
= 前卡 `bench/NEW_ENGINE_WEAK_TIER_BOUNDED.md`（t_f844043c）里那个 bounded 劣化上限，换了参考点）。
所有引擎档共用同一搜索预算 `movetime 300 / MultiPV 8 / Hash 64`；只有 大师 例外（它是天花板）。
逐字段值（含 `openingCap` / `hardCap` / `hardMistakeBand` 覆盖）以 JSON 为准，不在这里重复。

| 档 | 引擎 | 关键参数（摘要） |
|---|---|---|
| 入门 | 内置引擎，一行未改 | `engine.js LEVELS[0]`：depth2 / qDepth0 / 1500 nodes / randomness45 |
| 业余 | 新引擎 | cap 80 · p 0.50 · mistakeBand 200 |
| 进阶 | 新引擎 | cap 80 · p 0 · mistakeBand 200 |
| 高手 | 新引擎 | cap 25 · p 0.10 · mistakeBand 200 |
| 大师 | 新引擎 | MultiPV=1 · movetime 2000 · Hash 256（**待复核，见 §3**） |

单调性闸门（`tier_decide.js` 自动校验，不通过就拒绝写文件）：
`PASS  -7.9 < 12.8 < 31.1 < 50.0`（大师 < 高手 < 进阶 < 业余，预测平均丢子 cp）。

## 2. 每档的实测数字与失误生效率

平均丢子（cp，相对 ANCHOR 最佳着法；两轮实测 + 拟合预测，详细表见详细报告 §3/§4）：

| 档 | 实测（r1 / r2） | 预测 | 失误生效率（定标侧） | 失误生效率（对局侧 32 局） |
|---|---|---|---|---|
| 业余 | 43.6 / 46.3 | 50.0 | **12%**（触发 56%，触发后只有 21% 真生效） | **20.1%**（541 步中 109 步真走更差着法） |
| 进阶 | 28.5 / 31.8 | 31.1 | 0%（p=0，按设计） | 0% |
| 高手 | 14.8 / 12.6 | 12.8 | **9%**（触发 12%，触发后 75% 真生效） | **7.1%** |
| 大师 | −0.2 / −4.8（= ANCHOR，永远选最佳） | −7.9（参照） | 无失误维度 | 无 |
| 入门 | 前卡已定基线，本卡不改 | — | 内置引擎 randomness45，不由本契约管 | — |

**生效率 ≠ p**：`生效率 = p × P(mistakeBand 非空)`，永远小于 p。定案用的 cap 80 处，
`P(band 非空)` 的天花板是 **23.5%（定标时真正探测的 cfg 形态）/ 35.3%（定案写入的 cfg 形态）**——
band 从 `cap+50` 放宽到不设上限只能把生效率从 ~15–26% 抬到 ~35%，代价是少子形位置出现 **583cp 漏着**
（r4 实测：不设上限时少子形均值 290.5cp），那会推翻 t_f844043c 的"丢子率回到 0%"结论。
**所以 band 保持 200（有界）。** 要更弱就动 cap 或 p，**不要动 band**
（r4 实测：band 从 cap+50 到 cap+200 的差值 43.9 vs 52.9 cp 落在噪声内，不是强度旋钮）。

相邻档区分度（详细报告 §9）：按均值三对相邻档都拉开 **18–21 cp**；按单个位置 >20cp 命中率只有
**24%–53%**。互弈 7/7 对子方向正确、0 非法着法。

## 3. 待复核项（不许淡化）

1. **大师 movetime 只有 bench 样本**：r3 只有 **6 个位置**，本轮补跑 r5 到 **10 个位置**（含少儿形/HARD
   fixtures）。两轮方向一致：300ms→1000ms 有收益，**1000ms 以上在噪声内持平**（1000/2000/4000/6000/8000
   的 lossMean 在 −0.4…−4.5 之间来回跳，顺序不稳定）。因此 2000ms 的取值理由是"平坦区里最便宜的一个"，
   **不是"它更强"**，`tier_tiers.json` 里它带 `status: "pending-real-device"` 与
   `movetimeAlternatives: [1000,2000,4000,6000,8000]`（含旧默认 6000，未沿用）。
   内存与首载代价已实测（见详细报告 §8）：WASM heap 初始化后 ~307MB、跑任何 movetime 都停在 547MB
   ——**内存成本来自 Hash 而不是 movetime**；首载（一次/会话）≈ importScripts 5ms + WASM 42ms +
   NNUE 下载 166ms(50.7MB) + FS 写入 179ms + engine initialize 551ms。
   **仍需真机 + 复杂位置复核**内存、首载、UI 延迟后才能定案。
2. **单手棋不可保证可区分**：单位置噪声 ±7cp（两条"永远选最佳"的配置之间都差 4.4cp）。
   这套参数在"平均强度"上可区分，在"某一局/某一步"上不可保证——与前卡 AM0/AC_AM 结论一致，
   不是本卡新引入的问题，接入侧不要承诺"选某档就一定赢"。
3. **样本构成偏弱**：17 个定标位置里只有 2 个 HARD、若干"所有备选都差"的位置几乎不产生信号；
   要更细的定标需要更多"有中间梯度"的中局位置。对局侧 HARD 位置共 34 步（业余 12 / 进阶 11 / 高手 11），
   **没有一步真的走了失误候选（rand=0）**：业余 7 above + 5 bmiss、band 空 11/12；进阶 11 above；
   高手 10 above + 1 bmiss。也就是 bounded 约束在少子形里完全生效——低档在这些位置**过分谨慎**，
   这是设计后果而非 bug，但意味着"低档会在少子形犯错"这个假设没有被数据支持。
4. 32 局互弈够判方向，不够给胜率置信区间。

## 4. 指针（唯一权威来源）

- 详细报告（实验表、噪声底、互弈、复现命令）：`bench/NEW_ENGINE_TIER_CALIBRATION.md`
- 机器可读定案参数 + 生效率字段 + 大师 pending 标注：`bench/new_engine/tier_tiers.json`
  （由 `bench/new_engine/tier_decide.js` 从实测数据生成，带单调性闸门）
- 生成/分析脚本：`bench/new_engine/tier_rules.js`（规则本体，无 DOM/无依赖）、`tier_gen_band.js` +
  `tier_band_report.js` + `tier_effect_report.js`（band 三组对照与生效率）、
  `tier_gen_ceiling2.js` + `tier_ceiling_cost.js`（大师 movetime/内存/首载）
- 原始日志：`bench/new_engine_logs/tier_r1..r5.log`、`games_r1.log`、`games_r2.log`
- 复核报告：`E:/hermes-mem/programmer/projects/xiangqi/tests/t_a8096ea3-review-r1.md`

## 5. 本次整改对应的四条评审意见（详见详细报告对应小节）

1. 生效率未进定案 / 缺 band 取值实验 → 已补：补测 r4（17 位置 × 8 cfg，只变 band，replay 136 次 0 不一致）；
   `tier_band_report.js` 复现复核者的 82%/76%/65% 离线空率；生效率写入 `tier_tiers.json.mistakeEffectRate`；详细报告 §4.1。
2. band ≡ 前卡 bounded 未声明 → 已补：详细报告契约段声明三个参数并引用 `NEW_ENGINE_WEAK_TIER_BOUNDED.md`；
   `tier_tiers.json.contract` 同义字段。
3. 大师样本/标注/备选/内存 → 已补：补测 r5（10 位置 + 内存与首载计时）；`tier_tiers.json.大师` 加
   `status` / `movetimeAlternatives` / `measuredCost`；详细报告 §8。
4. `bench/TIER_DESIGN_FINAL.md` 不存在 → 本页，按定案只做一页摘要；接入卡输入指针 = 本页 + 详细报告 + JSON，**接线以 JSON 为准**。

验证（本次实际跑过，可重跑）：`node test_tier_rules.js` → `29 passed, 0 failed`；
`node tier_verify.js tier_r1.log tier_r2.log` → `408 selections, mismatches=0`；
`node tier_verify.js tier_r4.log` → `136 selections, mismatches=0`；`node tier_verify.js tier_r5.log` → `70 selections, mismatches=0`；
`node tier_games_report.js games_r1.log games_r2.log` → `pairs passing=7 failing=0`、`invalid moves=0`、`critical-error=0`；
`node tier_decide.js` → 单调性闸门 `PASS`，重写 `tier_tiers.json`（sha256 `935013af28ac1c21…`）。
