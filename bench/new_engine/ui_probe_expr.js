/* ui_probe_expr.js — evaluated inside the live index.html page over CDP (see run_ui_probe.sh).
 * Drives the REAL UI: pick a level via the <select>, click 新对局, play human moves through the
 * page's own applyMove()/afterHuman() path, and report what the AI answered.
 * `game` / `over` / `applyMove` / `humanSide` are the page's own top-level bindings — no part of
 * the game loop is reimplemented here, so this exercises the shipped wiring end to end.
 */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = { coi: self.crossOriginIsolated || false, engineReadyBefore: (typeof PF !== 'undefined' && PF.ready()) };
  // 首载代价实测（TIER_DESIGN_FINAL.md §3 待复核项：首载 / 内存 / UI 延迟）
  const t0 = performance.now();
  const ok0 = await PF.whenReady();
  out.firstLoadMs = Math.round(performance.now() - t0);
  out.firstLoadOk = ok0;
  out.env = PF.env;
  out.jsHeapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  const rows = [];
  for (const lv of [1, 2, 3, 4]) {
    document.getElementById('sideSel').value = '1';   // human = red, AI = black
    document.getElementById('levelSel').value = String(lv);
    document.getElementById('newBtn').click();
    const row = { level: lv, name: XQ.LEVELS[lv].name, human: [], ai: [], src: [], waitedMs: 0 };
    for (let ply = 0; ply < 4; ply++) {
      if (over || !game || game.side !== humanSide) break;
      const legal = game.legalMoves();
      if (!legal.length) break;
      const m = legal[(Math.random() * legal.length) | 0];
      if (!applyMove(m)) break;
      afterHuman();                       // the page's own post-move path: log + checkEnd + draw + aiTurn
      row.human.push(game.history[game.history.length - 1].notation);
      let waited = 0;
      while (game.side !== humanSide && !over && waited < 45000) { await sleep(200); waited += 200; }
      row.waitedMs += waited;
      const h = game.history[game.history.length - 1];
      if (h && h.side === -1) { row.ai.push(h.notation); row.src.push(lastAiSource); }
      if (over) break;
    }
    row.plies = game.history.length;
    row.over = over;
    row.engineReady = PF.ready();
    row.engineEnv = PF.env;
    row.engineLastError = PF.lastError || null;
    row.engineInfo = PF.lastInfo;
    row.tierParams = PF.TIERS && PF.TIERS[lv] ? {
      cap: PF.TIERS[lv].cap, p: PF.TIERS[lv].p, band: PF.TIERS[lv].mistakeBand,
      mpv: PF.TIERS[lv].multipv, ms: PF.TIERS[lv].movetime, hash: PF.TIERS[lv].hash
    } : 'no-engine-tier';
    rows.push(row);
  }
  out.rows = rows;
  out.status = document.getElementById('status').textContent.trim();
  out.logTail = document.getElementById('log').textContent.trim().split('\n').slice(-8);
  return JSON.stringify(out, null, 1);
})()
