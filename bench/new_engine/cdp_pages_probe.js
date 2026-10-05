/* cdp_pages_probe.js — drive the REAL deployed site (GitHub Pages) over CDP with headless Chrome.
 * No local server, no COOP/COEP from the host: this is the production-deployment test, deliberately
 * different from cdp_run_probe.js (which drives a local server and, for the UI probe, sets the
 * COOP/COEP headers itself). Here coi-serviceworker.js has to supply the isolation, and the assets
 * come from the real CDN, so we also record network/transfer facts.
 *
 * usage: node cdp_pages_probe.js <cdpPort> <pageUrl> <smoke|ui> [exprFile] [maxWaitSec]
 *   smoke : poll the page's own #log (online_smoke.html writes SMOKE/READY/SEL/CHECK/RECOVER lines)
 *           until 'SMOKE DONE' / 'SMOKE FAIL'. The page POSTs to /__log which does not exist on
 *           Pages, so the log only lives in the DOM and is WIPED by the coi reload -> we poll fast
 *           and union every line we ever saw, in order.
 *   ui    : warm up the COOP/COEP gate (PF.load()), wait until the page really is crossOriginIsolated,
 *           then run the probe expression detached (same expr file as the local UI probe) and poll.
 *
 * Both modes additionally record: main-frame navigations (the reload coi-serviceworker forces),
 * response headers containing Cross-Origin-* (proof the SW injected them, not the host), per-asset
 * transferSize/duration from performance.getEntriesByType('resource'), and, for ui mode,
 * performance.measureUserAgentSpecificMemory() (page + workers total; needs COEP, which we have).
 */
const fs = require('fs');
const PORT = process.argv[2] || '9362';
const PAGE = process.argv[3];
const MODE = process.argv[4] || 'smoke';
const EXPR_FILE = MODE === 'ui' ? process.argv[5] : null;
const MAXWAIT = +(MODE === 'ui' ? process.argv[6] : process.argv[5]) || 600;
if (!PAGE) { console.log('usage: cdp_pages_probe.js <cdpPort> <pageUrl> <smoke|ui> [exprFile] [maxWaitSec]'); process.exit(2); }
const EXPR = EXPR_FILE ? fs.readFileSync(EXPR_FILE, 'utf8') : null;

const T0 = Date.now();
const at = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
function httpJson(url) {
  return new Promise((resolve, reject) => {
    require('http').get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('bad json: ' + b.slice(0, 300))); } });
    }).on('error', reject);
  });
}

async function main() {
  const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const logs = [];            // console / log entries from the page
  const navs = [];            // main-frame navigations (the coi reload shows up here)
  const coiHeaders = [];      // responses that carried Cross-Origin-* headers
  const reqs = new Map();     // requestId -> url (to label header records)
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
      return;
    }
    if (m.method === 'Log.entryAdded') logs.push('[' + m.params.entry.level + '] ' + m.params.entry.text);
    else if (m.method === 'Runtime.consoleAPICalled') logs.push('[console] ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    else if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) navs.push(at() + ' ' + m.params.frame.url);
    else if (m.method === 'Network.requestWillBeSent') reqs.set(m.params.requestId, m.params.request.url);
    else if (m.method === 'Network.responseReceived' || m.method === 'Network.responseReceivedExtraInfo') {
      const h = (m.params.headers) || {};
      const keys = Object.keys(h).filter((k) => /^cross-origin-(opener|embedder|embedder-include-opener)$/i.test(k));
      if (keys.length) {
        const url = reqs.get(m.params.requestId) || '(unknown request)';
        coiHeaders.push(at() + ' ' + url + ' :: ' + keys.map((k) => k + '=' + h[k]).join(' | '));
      }
    }
  };
  // Eval that survives a page reload (context is recreated; a failed eval just returns null).
  const ev = async (expr, timeoutMs) => {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs || 30000 });
      if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 300) };
      return r.result && r.result.value;
    } catch (e) { return { __err: String(e.message || e).slice(0, 200) }; }
  };
  await new Promise((res, rej) => {
    if (ws.readyState === 1) return res();
    ws.onopen = res; ws.onerror = () => rej(new Error('ws error'));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  try { await send('Performance.enable'); } catch (e) { /* not fatal */ }
  // Optional weak-device emulation (NOT a real phone): slow the CPU by an integer factor.
  const THROTTLE = +(process.env.THROTTLE || 0);
  if (THROTTLE > 1) {
    try { await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); console.log('CPU-THROTTLE x' + THROTTLE + ' (emulation, not a real device)'); }
    catch (e) { console.log('CPU-THROTTLE FAILED ' + e.message); }
  }

  // Cold start: drop any service worker a previous run left behind and clear the reload counter,
  // so what we measure is a real first visit (coi-serviceworker not yet installed).
  // COLD=0 keeps whatever the profile already has — that is the returning-visitor case.
  const COLD = (process.env.COLD || '1') !== '0';
  if (COLD) {
    await ev('navigator.serviceWorker&&navigator.serviceWorker.getRegistrations?Promise.all(navigator.serviceWorker.getRegistrations().then(rs=>rs.map(r=>r.unregister()))):null', 15000);
    await ev('try{sessionStorage.removeItem("coiTries")}catch(e){} "cleared"', 5000);
  }
  console.log('PAGES-PROBE mode=' + MODE + ' url=' + PAGE + ' start=' + new Date().toISOString() +
              ' (' + (COLD ? 'cold: SW unregistered, coiTries cleared' : 'warm: profile kept as-is') + ')');
  await send('Page.navigate', { url: PAGE });

  const seen = new Set(); const pageLog = [];
  const absorb = (txt) => {
    if (typeof txt !== 'string') return;
    for (const line of txt.split('\n')) {
      const s = line.trim();
      if (!s || seen.has(s)) continue;
      seen.add(s); pageLog.push(s);
    }
  };
  const readPageLog = async () => absorb(await ev('document.getElementById("log")?document.getElementById("log").textContent:""', 5000));
  const readEnv = async () => ev('JSON.stringify({coi:!!self.crossOriginIsolated,sab:typeof SharedArrayBuffer!=="undefined",coiTries:sessionStorage.getItem("coiTries"),sw:!!(navigator.serviceWorker&&navigator.serviceWorker.controller),href:location.href})', 5000);

  const deadline = Date.now() + MAXWAIT * 1000;
  let env = null, probeResult = null, state = 'loading', hdrProbe = null;
  // Pages-side probe pages signal completion in their own #log; the marker is configurable so the
  // same driver can run the wiring smoke (SMOKE DONE) and the memory probe (MEM DONE).
  const DONE_MARK = process.env.DONE_MARK || 'SMOKE DONE';
  const FAIL_MARK = process.env.FAIL_MARK || 'SMOKE FAIL';

  if (MODE === 'smoke') {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      await readPageLog();
      env = (await readEnv()) || env;
      const joined = pageLog.join('\n');
      if (joined.indexOf(DONE_MARK) >= 0) { state = 'DONE'; break; }
      if (joined.indexOf(FAIL_MARK) >= 0) { state = 'FAIL'; break; }
      process.stdout.write('.');
    }
  } else {
    // Real user path: index.html only touches the engine when a game actually starts, so we run the
    // shipped probe expression (it clicks 新对局) and let the COI reload happen on its own. A reload
    // destroys the page, so after each reload we re-issue the probe (window.__PROBE_STARTED is gone
    // with the page, which is exactly how we detect that a reload happened).
    await new Promise((r) => setTimeout(r, 6000));
    console.log('\nboot: ' + await readEnv());
    const START = 'window.__PROBE_DONE=false;window.__PROBE_RESULT=null;window.__PROBE_STARTED=true;' +
                  'Promise.resolve(' + EXPR + ')' +
                  '.then(v=>{window.__PROBE_RESULT=v}).catch(e=>{window.__PROBE_RESULT="PROBE THREW: "+(e&&e.stack||e)})' +
                  '.then(()=>{window.__PROBE_DONE=true});"started"';
    let starts = 0;
    const probeState = async () => {
      const s = await ev('({done:window.__PROBE_DONE===true,started:window.__PROBE_STARTED===true})', 10000);
      return (s && typeof s === 'object' && !s.__err) ? s : { done: false, started: false };
    };
    while (Date.now() < deadline && starts < 3) {
      const st = await probeState();
      if (!st.done) {
        starts++;
        await ev(START, 15000);
        console.log('\n[probe start#' + starts + ' @' + at() + '] env=' + JSON.stringify(await readEnv()));
      }
      let done = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const st2 = await probeState();
        if (st2.done === true) { done = true; break; }
        if (st2.started !== true) break; // page was replaced (COI reload) -> re-issue the probe
        process.stdout.write('.');
      }
      if (done === true) { probeResult = await ev('window.__PROBE_RESULT', 30000); state = 'DONE'; break; }
    }
  }

  // ---- measurements ----
  // Proof that the isolation headers come from the SHIPPED coi-serviceworker.js (not from the host):
  // ask the live origin for the same document through the page's own fetch() — the SW's fetch
  // handler is what adds Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy.
  await ev('window.__HDRS=null;(async()=>{try{const r=await fetch(location.href,{cache:"no-store"});' +
           'const h={};for(const[k,v]of r.headers.entries())if(/^cross-origin-/i.test(k))h[k]=v;' +
           'window.__HDRS=JSON.stringify({status:r.status,type:r.type,swControlled:!!(navigator.serviceWorker&&navigator.serviceWorker.controller),headers:h});' +
           '}catch(e){window.__HDRS="HDR FETCH ERR "+(e&&e.message||e)}})();"kicked"', 20000);
  for (let k = 0; k < 8; k++) {
    const v = await ev('window.__HDRS', 10000);
    if (v) { hdrProbe = v; break; }
    await new Promise((r) => setTimeout(r, 1500));
  }

  const res = await ev(
    'JSON.stringify(performance.getEntriesByType("resource")' +
    '.filter(e=>/pikafish|tier_|book|engine\\.js|coi-service|worker\\.js/i.test(e.name))' +
    '.map(e=>({url:e.name.replace(location.origin,""),initiator:e.initiatorType,' +
    'transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize,duration:Math.round(e.duration),' +
    'start:Math.round(e.startTime)})))', 20000);
  const nav = await ev('JSON.stringify(performance.getEntriesByType("navigation").map(e=>({url:e.name,duration:Math.round(e.duration),domContentLoaded:Math.round(e.domContentLoadedEventEnd),loadEvent:Math.round(e.loadEventEnd),transfer:e.transferSize,encoded:e.encodedBodySize})))', 10000);
  const heap = await ev('JSON.stringify(performance.memory?{jsHeapMB:Math.round(performance.memory.usedJSHeapSize/1048576),jsHeapLimitMB:Math.round(performance.memory.jsHeapSizeLimit/1048576)}:null)', 10000);
  let uaMem = null;
  if (MODE === 'ui') {
    // store-then-read (same pattern as the probe result): avoids relying on awaitPromise for a promise value
    await ev('window.__UAMEM=null;(async()=>{try{if(!performance.measureUserAgentSpecificMemory){window.__UAMEM="UA-MEM unavailable in this Chrome";return;}' +
             'const v=await performance.measureUserAgentSpecificMemory();' +
             'window.__UAMEM=JSON.stringify({totalMB:Math.round(v.bytes/1048576),breakdown:(v.breakdown||[]).map(b=>({MB:Math.round(b.bytes/1048576,for:JSON.stringify(b.for||{})).slice(0,70)}))});' +
             '}catch(e){window.__UAMEM="UA-MEM ERR "+(e&&e.message||e)}})();"kicked"', 20000);
    for (let k = 0; k < 30; k++) {
      await new Promise((r) => setTimeout(r, 2000));
      const v = await ev('window.__UAMEM', 10000);
      if (v) { uaMem = v; break; }
    }
  }

  console.log('\n=== STATE === ' + state + ' (' + at() + ')');
  console.log('=== NAVIGATIONS (' + navs.length + ') ===');
  navs.forEach((n) => console.log('NAV ' + n));
  console.log('=== COOP/COEP RESPONSES (' + coiHeaders.length + ') ===');
  coiHeaders.forEach((h) => console.log('HDR ' + h));
  console.log('=== COOP/COEP VIA SW FETCH === ' + hdrProbe);
  console.log('=== PAGE ENV === ' + JSON.stringify(env));
  console.log('=== PAGE LOG (' + pageLog.length + ' lines) ===');
  pageLog.forEach((l) => console.log(l));
  if (probeResult !== null) {
    console.log('\n=== PROBE RESULT ===');
    console.log(typeof probeResult === 'string' ? probeResult : JSON.stringify(probeResult, null, 1));
  }
  console.log('\n=== RESOURCE TIMING === ' + res);
  console.log('=== NAVIGATION TIMING === ' + nav);
  console.log('=== JS HEAP === ' + heap);
  if (MODE === 'ui') console.log('=== UA MEMORY === ' + uaMem);
  console.log('=== LOG ENTRIES (' + logs.length + ') ===');
  logs.slice(0, 40).forEach((l) => console.log(l));
  console.log('PAGES-PROBE ' + (state === 'DONE' ? 'DONE' : 'INCOMPLETE:' + state));
  process.exit(state === 'DONE' ? 0 : 1);
}
main().catch((e) => { console.log('CDP ERR ' + e.message); process.exit(1); });
