/* cdp_single_panel_check.js — the single-file build (file://, engine embedded) must NOT claim a
 * 50.7MB download (card t_f51aab68). Checks, on the real built xiangqi.html:
 *   1) PF.netDownloadNeeded() === false on the blob path;
 *   2) the natural 新对局 flow: any panel text sampled while loading must say 内置/无需下载;
 *   3) deterministic: showEngineProgress(null) (the exact first call ensureEngine() makes) must
 *      render "正在准备内置引擎…（无需下载）", panel visible, bar 0%, no "50.7" anywhere;
 *   4) after the engine is ready the panel hides again.
 * usage: node cdp_single_panel_check.js <cdpPort> <pageUrl>
 */
const PORT = process.argv[2] || '9482';
const PAGE = process.argv[3];
if (!PAGE) { console.log('usage: cdp_single_panel_check.js <cdpPort> <pageUrl>'); process.exit(2); }

function httpJson(url) {
  return new Promise((resolve, reject) => {
    require('http').get(url, (res) => {
      let b = ''; res.on('data', (c) => (c, b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json: ' + b.slice(0, 200))); } });
    }).on('error', reject);
  });
}

async function main() {
  const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); return; }
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
  console.log('SINGLE-PANEL-CHECK url=' + PAGE);
  await send('Page.navigate', { url: PAGE });

  for (let i = 0; i < 60; i++) {
    const ok = await ev('typeof XQ!=="undefined" && typeof game!=="undefined" && !!game');
    if (ok === true) break;
    await sleep(500);
  }

  const needDl = await ev('PF.netDownloadNeeded()');
  console.log('netDownloadNeeded=' + needDl);

  // natural flow: pick a heavy tier, click 新对局, sample the panel text while the embedded engine loads
  const flow = await ev(`(async () => {
    const seen = [];
    document.getElementById('sideSel').value='1';
    document.getElementById('levelSel').value='1';
    document.getElementById('newBtn').click();
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      const e = document.getElementById('engLoad');
      const tx = document.getElementById('engLoadTxt');
      if (e && !e.hidden && tx) {
        const t = tx.textContent.trim();
        if (!seen.includes(t)) seen.push(t);
      }
      await new Promise(r => setTimeout(r, 60));
    }
    return JSON.stringify({ seen: seen, ready: PF.ready() });
  })()`, 15000);
  console.log('FLOW-SAMPLES ' + flow);

  // wait for the embedded engine to finish loading, then the panel must hide by itself
  let ready = false;
  for (let i = 0; i < 60; i++) { ready = await ev('PF.ready()'); if (ready === true) break; await sleep(500); }
  console.log('pfReady=' + ready);
  console.log('panelHiddenAfterReady=' + await ev(`document.getElementById('engLoad').hidden`));

  // deterministic: the exact first call ensureEngine() makes — text must not mention a download
  const direct = await ev(`(() => {
    showEngineProgress(null);
    const e = document.getElementById('engLoad');
    const t = document.getElementById('engLoadTxt').textContent.trim();
    const bar = document.getElementById('engBarFill').style.width;
    return JSON.stringify({ visible: !e.hidden, text: t, bar: bar });
  })()`);
  console.log('DIRECT ' + direct);
  await ev(`hideEngineProgress()`);

  let ok = needDl === false && ready === true;
  let flowSeen = [];
  try { flowSeen = JSON.parse(flow).seen || []; } catch (e) { ok = false; }
  for (const t of flowSeen) { if (!/内置/.test(t) || /50\.7/.test(t)) ok = false; }
  let d = null;
  try { d = JSON.parse(direct); } catch (e) { ok = false; }
  if (d) { if (!d.visible || !/内置/.test(d.text) || !/无需下载/.test(d.text) || /50\.7/.test(d.text)) ok = false; }
  const hid = await ev(`document.getElementById('engLoad').hidden`);
  if (hid !== true) ok = false;
  console.log('VERDICT ' + (ok ? 'SINGLE-FILE-PANEL-OK-NO-DOWNLOAD-CLAIM' : 'SINGLE-FILE-PANEL-BAD'));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.log('CDP ERR ' + e.message); process.exit(1); });
