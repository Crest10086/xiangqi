/* pages_mem_probe_expr.js — memory measurement on the LIVE site (run via run_pages_probe.sh ui
 * with EXPR_FILE pointing here). Measures, after the engine is loaded and a real search has run:
 *   - performance.measureUserAgentSpecificMemory()  (page + all workers; requires COEP)
 *   - performance.memory (main thread JS heap only)
 *   - the engine worker's own heap via a same-origin worker we spawn ourselves (diagnostic)
 * It first loads the engine and runs one real 大师 search so the numbers include the engine.
 */
(async () => {
  const out = { coi: !!self.crossOriginIsolated, threads: navigator.hardwareConcurrency };
  const ok = await PF.whenReady();
  out.engineReady = ok;
  out.engineEnv = PF.env;
  out.netBytes = PF.lastCost && PF.lastCost.netBytes;
  const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  // 走 PF.tierSearch(4)：这一档才会下发 Hash 256 / MultiPV1 / 2000ms（内存成本来自 Hash）。
  // legal 传空数组只影响选着阶段（tier_rules），不影响引擎侧的搜索与内存占用。
  const runMaster = () => PF.tierSearch(4, FEN, { legal: [], ply: 0 });
  const t0 = performance.now();
  try { await runMaster(); } catch (e) { out.searchErr = String(e.message || e); }
  out.searchWallMs = Math.round(performance.now() - t0);
  out.engineInfo = PF.lastInfo;
  out.jsHeapMainMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  out.hasUAMem = typeof performance.measureUserAgentSpecificMemory === 'function';
  const withTimeout = (p, ms, label) => Promise.race([
    p, new Promise((res) => setTimeout(() => res({ __timeout: label }), ms)),
  ]);
  try {
    const v = await withTimeout(performance.measureUserAgentSpecificMemory(), 60000, 'measureUserAgentSpecificMemory did not resolve in 60s');
    if (v && v.__timeout) { out.uaErr = v.__timeout; }
    else {
      out.uaTotalMB = Math.round(v.bytes / 1048576);
      out.uaBreakdown = (v.breakdown || []).map((b) => ({ MB: Math.round(b.bytes / 1048576), for: JSON.stringify(b.for || {}).slice(0, 80) }));
    }
  } catch (e) { out.uaErr = String(e && e.message || e); }
  // second sample after another search, to see whether the WASM heap grows with use
  try { await PF.search(FEN, 2000, 1, null); } catch (e) {}
  try {
    const v2 = await withTimeout(performance.measureUserAgentSpecificMemory(), 20000, 'timeout');
    if (v2 && !v2.__timeout) out.uaTotalMB_after2ndSearch = Math.round(v2.bytes / 1048576);
  } catch (e) { out.uaErr2 = String(e && e.message || e); }
  out.jsHeapMainMB_after = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  return JSON.stringify(out, null, 1);
})()
