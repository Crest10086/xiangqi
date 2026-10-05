/* cdp_visual_probe.js — evidence collector for the UI card (t_f51aab68).
 *
 * Drives the REAL index.html in headless Chrome over CDP and captures, at named stages:
 *   - a full-page PNG screenshot (so a human/vision model can see what the user sees),
 *   - the panel text (#status, #engLoad if any),
 *   - a canvas pixel sample that measures whether the square a piece just moved to carries a
 *     highlight ring/glow that an unrelated square does NOT carry.
 *
 * The 50.7MB NNUE download is made observable by CDP network emulation
 * (Network.emulateNetworkConditions, default 2MB/s => ~25s), which throttles the real network
 * stack without touching any production file.
 *
 * usage: node cdp_visual_probe.js <cdpPort> <pageUrl> <outDir> [maxWaitSec]
 * env:   DOWN_KBPS (default 2048) download throughput for the emulation; LEVEL (default 1) tier.
 * Output: <outDir>/<stage>.png + <outDir>/visual_probe.json (stages, texts, pixel samples).
 */
const fs = require('fs');
const path = require('path');
const PORT = process.argv[2] || '9372';
const PAGE = process.argv[3];
const OUTDIR = path.resolve(process.argv[4] || '.');
const MAXWAIT = +process.argv[5] || 420;
const DOWN_KBPS = +process.env.DOWN_KBPS || 2048;
const LEVEL = process.env.LEVEL || '1';
if (!PAGE) { console.log('usage: cdp_visual_probe.js <cdpPort> <pageUrl> <outDir> [maxWaitSec]'); process.exit(2); }
fs.mkdirSync(OUTDIR, { recursive: true });

const T0 = Date.now();
const at = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
function httpJson(url) {
  return new Promise((resolve, reject) => {
    require('http').get(url, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json: ' + b.slice(0, 200))); } });
    }).on('error', reject);
  });
}

/* ---- in-page helpers, installed once (they use the page's own top-level bindings) ---- */
const HELPERS = `(() => {
  // gold-ish pixel test: the highlight colour is #f1c40f; the wood background is #e8c98f/#d9b476.
  // Over the wood the ring lands near rgb(238,198,58) while the wood itself is (232,201,143),
  // so the discriminator is the BLUE channel and G-B, not R.
  window.__isHi = (R, G, B) => R > 175 && G > 145 && B < 110 && (G - B) > 85;
  // sample the annulus just outside a piece disc (the piece disc is r=sc(24))
  window.__band = (idx, r0u, r1u) => {
    const [x, y] = pos(idx);
    const r0 = Math.round(sc(r0u)), r1 = Math.round(sc(r1u));
    const x0 = Math.max(0, Math.floor(x - r1)), y0 = Math.max(0, Math.floor(y - r1));
    const w = Math.min(cv.width - x0, 2 * r1 + 1), h = Math.min(cv.height - y0, 2 * r1 + 1);
    const d = ctx.getImageData(x0, y0, w, h).data;
    let hi = 0, total = 0;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const dx = x0 + px - x, dy = y0 + py - y, r = Math.hypot(dx, dy);
      if (r < r0 || r > r1) continue;
      total++;
      const i = (py * w + px) * 4;
      if (window.__isHi(d[i], d[i + 1], d[i + 2])) hi++;
    }
    return { hi, total, ratio: total ? +(hi / total).toFixed(3) : 0 };
  };
  // pick a control square far away from both endpoints of the last move
  window.__ctrl = (avoid) => {
    for (let i = 0; i < 90; i++) {
      const r = (i / 9) | 0, c = i % 9;
      if (avoid.indexOf(i) >= 0) continue;
      let ok = true;
      for (const a of avoid) { if (Math.abs(((a / 9) | 0) - r) <= 2 && Math.abs((a % 9) - c) <= 2) { ok = false; break; } }
      if (ok) return i;
    }
    return -1;
  };
  window.__uiState = () => {
    const st = document.getElementById('status');
    const eng = document.getElementById('engLoad');
    const fill = document.getElementById('engBarFill');
    const txt = document.getElementById('engLoadTxt');
    return {
      status: st ? st.textContent.trim() : null,
      engVisible: !!eng && !eng.hidden && getComputedStyle(eng).display !== 'none',
      engText: txt ? txt.textContent.trim() : null,
      engBarPct: fill ? (parseFloat(getComputedStyle(fill).width) / Math.max(1, fill.parentElement.clientWidth) * 100).toFixed(1) : null,
      lastMove: (typeof lastMove !== 'undefined' && lastMove) ? [lastMove.f, lastMove.t] : null,
      historyLen: (typeof game !== 'undefined' && game) ? game.history.length : null,
      side: (typeof game !== 'undefined' && game) ? game.side : null,
      thinking: (typeof thinking !== 'undefined') ? thinking : null,
      pfReady: (typeof PF !== 'undefined') ? PF.ready() : null,
      pfNetProgress: (typeof PF !== 'undefined' && PF.netProgress) ? PF.netProgress : null,
      pfError: (typeof PF !== 'undefined') ? (PF.lastError || null) : null,
    };
  };
  'helpers-ok';
})()`;

async function main() {
  const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const logs = [];
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); return; }
    if (m.method === 'Log.entryAdded') logs.push('[' + m.params.entry.level + '] ' + m.params.entry.text);
    else if (m.method === 'Runtime.consoleAPICalled') logs.push('[console] ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
  };
  const ev = async (expr, timeoutMs) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs || 20000 });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result && r.result.value;
  };
  // a COI reload recreates the page context: re-install the helpers and keep going
  const evSafe = async (expr, timeoutMs) => {
    try { return await ev(expr, timeoutMs); }
    catch (e) {
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        try {
          const live = await ev('typeof XQ!=="undefined" && typeof game!=="undefined" && !!game && typeof pos==="function"');
          if (live !== true) continue;
          await ev(HELPERS);
          console.log('PAGE-RECOVERED (context was replaced by a reload) ' + at());
          return await ev(expr, timeoutMs);
        } catch (e2) { /* still reloading */ }
      }
      throw new Error('page never came back: ' + e.message);
    }
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(OUTDIR, name + '.png');
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    return p;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await new Promise((res, rej) => { if (ws.readyState === 1) return res(); ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  const navs = [];
  const onMsg = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) navs.push(at() + ' ' + m.params.frame.url);
    onMsg(ev);
  };
  // Throttle the network so a 50.7MB download is observable in screenshots (probe-only knob).
  try {
    await send('Network.emulateNetworkConditions', {
      enabled: true, offline: false, latency: 0,
      downloadThroughput: Math.round(DOWN_KBPS * 1024),
      uploadThroughput: Math.round(DOWN_KBPS * 1024),
    });
    console.log('NETWORK-EMULATION down=' + DOWN_KBPS + 'KB/s (50.7MB -> ~' + Math.round(50706378 / (DOWN_KBPS * 1024)) + 's)');
  } catch (e) { console.log('NETWORK-EMULATION FAILED ' + e.message); }

  await send('Page.navigate', { url: PAGE });
  // wait for the page's own script to be live
  for (let i = 0; i < 60; i++) {
    const ok = await ev('typeof XQ!=="undefined" && typeof game!=="undefined" && !!game && typeof pos==="function"').catch(() => false);
    if (ok) break;
    await sleep(500);
  }
  console.log('PAGE-READY ' + at());
  console.log('HELPERS ' + await ev(HELPERS));

  const stages = [];
  const stage = async (name, note) => {
    const ui = await evSafe('window.__uiState()');
    const png = await shot(name);
    stages.push({ stage: name, t: at(), note: note || null, ui, screenshot: png });
    console.log('STAGE ' + name + ' ' + at() + ' status=' + JSON.stringify(ui.status) +
      ' engVisible=' + ui.engVisible + ' engText=' + JSON.stringify(ui.engText) + ' engBar=' + ui.engBarPct +
      ' pfReady=' + ui.pfReady + ' lastMove=' + JSON.stringify(ui.lastMove));
    return ui;
  };
  const sampleHighlight = async (label) => {
    const s = await evSafe(`(() => {
      if (typeof lastMove === 'undefined' || !lastMove) return JSON.stringify({err:'no lastMove'});
      const avoid = [lastMove.f, lastMove.t];
      const c = window.__ctrl(avoid);
      const out = { move: [lastMove.f, lastMove.t], control: c, sq: SQ,
        dst24_34: window.__band(lastMove.t, 25, 34), src24_34: window.__band(lastMove.f, 25, 34),
        ctrl24_34: window.__band(c, 25, 34),
        dst15_24: window.__band(lastMove.t, 15, 24), ctrl15_24: window.__band(c, 15, 24) };
      return JSON.stringify(out);
    })()`);
    const parsed = JSON.parse(s);
    console.log('HILITE ' + label + ' ' + JSON.stringify(parsed));
    stages.push({ stage: 'HILITE ' + label, t: at(), sample: parsed });
    return parsed;
  };

  await stage('00-initial', 'page loaded, before any interaction');

  // 1) pick a human side + an engine tier, start a game (this is what a real user does)
  await ev(`(() => {
    document.getElementById('sideSel').value='1';
    document.getElementById('levelSel').value=${JSON.stringify(String(LEVEL))};
    document.getElementById('newBtn').click();
    return 'clicked';
  })()`);
  await stage('01-after-newgame', 'user picked tier ' + LEVEL + ' and clicked 新对局');
  const afterNew = await ev('window.__uiState()');
  console.log('AFTER-NEWGAME engineStarted=' + afterNew.pfReady + ' status=' + JSON.stringify(afterNew.status));

  // 2) the human plays a legal move through the page's own path -> AI turn begins
  const mv = await ev(`(() => {
    const legal = game.legalMoves(); if (!legal.length) return 'no-legal';
    const m = legal[0]; applyMove(m); afterHuman();
    return game.history[game.history.length - 1].notation;
  })()`);
  console.log('HUMAN-MOVE ' + mv + ' ' + at());
  await stage('02-after-human-move', 'human moved ' + mv + '; engine download should be running');
  await sampleHighlight('after-human-move');

  // 3) watch the download: sample the panel every ~1.5s until the engine is ready or it fails
  let loadShots = 0, netDone = false;
  const deadline = Date.now() + MAXWAIT * 1000;
  while (Date.now() < deadline) {
    const ui = await evSafe('window.__uiState()');
    const np = ui.pfNetProgress;
    if (loadShots < 6 && (np || !ui.pfReady)) {
      loadShots++;
      await stage('03-loading-' + loadShots, 'engine download in flight (net=' + JSON.stringify(np) + ')');
    }
    if (ui.pfReady) { netDone = true; break; }
    if (ui.pfError) { console.log('ENGINE-ERROR ' + ui.pfError); break; }
    await sleep(1500);
  }
  console.log('ENGINE-READY=' + netDone + ' ' + at());
  await stage('04-engine-ready', 'engine loaded (or failed)');

  // 4) wait for the AI's reply, then measure the highlight of the piece the AI just moved
  for (let i = 0; i < 120; i++) {
    const ui = await evSafe('window.__uiState()');
    if (ui.side === 1 || ui.thinking === false && ui.historyLen >= 2) break;
    await sleep(500);
  }
  await sleep(400);
  await stage('05-after-ai-move', 'AI replied; measure the highlight on the AI piece');
  const aiSample = await sampleHighlight('after-ai-move');

  // 5) a second human move, sampled right after it (before the AI answers)
  const mv2 = await ev(`(() => {
    const legal = game.legalMoves(); if (!legal.length) return 'no-legal';
    const m = legal[legal.length - 1]; applyMove(m); afterHuman();
    return game.history[game.history.length - 1].notation;
  })()`);
  console.log('HUMAN-MOVE-2 ' + mv2 + ' ' + at());
  await sleep(120);
  await stage('06-after-human-move2', 'human moved ' + mv2);
  const humanSample = await sampleHighlight('after-human-move2');

  const report = {
    page: PAGE, start: new Date().toISOString(),
    networkEmulationKBps: DOWN_KBPS, level: LEVEL,
    navigations: navs,
    stages, samples: { aiMove: aiSample, humanMove: humanSample },
    logEntries: logs.slice(0, 60),
  };
  fs.writeFileSync(path.join(OUTDIR, 'visual_probe.json'), JSON.stringify(report, null, 1));
  console.log('REPORT ' + path.join(OUTDIR, 'visual_probe.json'));
  console.log('=== LOG ENTRIES (' + logs.length + ') ===');
  for (const l of logs.slice(0, 30)) console.log(l);
  process.exit(0);
}
main().catch((e) => { console.log('CDP ERR ' + e.message); process.exit(1); });
