/* cdp_reload_probe.js — reproduce and verify the fix for "下完一步就变回刚开局" (小米浏览器实测,
 * card t_f51aab68). Runs against a server WITHOUT COOP/COEP (the GitHub Pages case): the shipped
 * coi-serviceworker.js has to take over, which forces a document reload right around the user's
 * first move. Before the fix the page restarted from the initial position; now the game must come
 * back intact and the engine must still load.
 *
 * usage: node cdp_reload_probe.js <cdpPort> <pageUrl> [maxWaitSec]
 * Reports: the board/move signature before the reload, the navigations CDP saw, and the signature
 * after the reload (with the panel text), plus crossOriginIsolated / engine readiness.
 */
const PORT = process.argv[2] || '9382';
const PAGE = process.argv[3];
const MAXWAIT = +process.argv[4] || 300;
if (!PAGE) { console.log('usage: cdp_reload_probe.js <cdpPort> <pageUrl> [maxWaitSec]'); process.exit(2); }

function httpJson(url) {
  return new Promise((resolve, reject) => {
    require('http').get(url, (res) => {
      let b = ''; res.on('data', (c) => (c, b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json: ' + b.slice(0, 200))); } });
    }).on('error', reject);
  });
}

const SIGN = `JSON.stringify({
  href: location.href,
  coi: !!self.crossOriginIsolated,
  coiTries: sessionStorage.getItem('coiTries'),
  restoreBlob: (() => { try { return sessionStorage.getItem('xqRestore'); } catch (e) { return 'ERR'; } })(),
  hist: (typeof game !== 'undefined' && game) ? game.history.map(h => h.notation) : null,
  pieces: (typeof game !== 'undefined' && game) ? game.board.filter(x => x !== 0).length : null,
  lastMove: (typeof lastMove !== 'undefined' && lastMove) ? [lastMove.f, lastMove.t] : null,
  status: document.getElementById('status') ? document.getElementById('status').textContent.trim() : null,
  engVisible: (() => { const e = document.getElementById('engLoad'); return !!e && !e.hidden; })(),
  engText: (() => { const e = document.getElementById('engLoadTxt'); return e ? e.textContent.trim() : null; })(),
  pfReady: (typeof PF !== 'undefined') ? PF.ready() : null,
})`;

async function main() {
  const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const navs = [];
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); return; }
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) navs.push(m.params.frame.url);
  };
  const ev = async (expr, timeoutMs) => {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs || 20000 });
      if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 300) };
      return r.result && r.result.value;
    } catch (e) { return { __err: String(e.message || e).slice(0, 200) }; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await new Promise((res, rej) => { if (ws.readyState === 1) return res(); ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  await send('Page.enable'); await send('Runtime.enable');
  console.log('RELOAD-PROBE url=' + PAGE + ' (server without COOP/COEP -> coi-serviceworker must reload the page)');
  await send('Page.navigate', { url: PAGE });

  for (let i = 0; i < 60; i++) {
    const ok = await ev('typeof XQ!=="undefined" && typeof game!=="undefined" && !!game');
    if (ok === true) break;
    await sleep(500);
  }
  console.log('BEFORE ' + await ev(SIGN));

  // what a real user does: pick an engine tier, click 新对局, play one move
  await ev(`(() => {
    document.getElementById('sideSel').value='1';
    document.getElementById('levelSel').value='1';
    document.getElementById('newBtn').click();
    const legal = game.legalMoves(); const m = legal[0];
    applyMove(m); afterHuman();
    return 'moved ' + game.history[game.history.length - 1].notation;
  })()`);
  const before = JSON.parse(await ev(SIGN));
  console.log('AFTER-MOVE ' + JSON.stringify(before));

  // wait for the COI reload to happen and the page to come back
  let sawReload = false, after = null;
  const t0 = Date.now();
  while (Date.now() - t0 < MAXWAIT * 1000) {
    await sleep(2000);
    const s = await ev(SIGN);
    if (s && s.__err) continue;
    const parsed = typeof s === 'string' ? JSON.parse(s) : s;
    if (navs.length > 1) { sawReload = true; }
    if (parsed && parsed.hist && parsed.hist.length >= before.hist.length && parsed.coi === true) { after = parsed; break; }
    if (parsed && parsed.coi === true && parsed.pfReady) { after = parsed; break; }
    process.stdout.write('.');
  }
  console.log('\nNAVIGATIONS (' + navs.length + ')');
  navs.forEach((n) => console.log('NAV ' + n));
  console.log('SAW-RELOAD ' + sawReload);
  console.log('AFTER ' + JSON.stringify(after));
  const ok = !!(after && after.hist && after.hist.length >= 1 && after.coi === true);
  console.log('VERDICT ' + (ok ? 'GAME-PRESERVED-ACROSS-RELOAD' : 'GAME-LOST-OR-ENGINE-NOT-READY'));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.log('CDP ERR ' + e.message); process.exit(1); });
