/* cdp_run_probe.js — navigate to a page, start a long-running probe expression in it, poll
 * until it signals done, then print its result. (Runtime.evaluate has a 120s cap, which is too
 * short for a probe that plays several AI moves, so the probe runs detached and we poll.)
 * usage: node cdp_run_probe.js <cdpPort> <pageUrl> <exprFile> [maxWaitSec]
 */
const fs = require('fs');
const PORT = process.argv[2] || '9342';
const PAGE = process.argv[3];
const EXPR = fs.readFileSync(process.argv[4], 'utf8');
const MAXWAIT = +process.argv[5] || 600;

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
  let id = 0; const pend = new Map(); const logs = [];
  const send = (method, params) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); }
    else if (m.method === 'Log.entryAdded') { logs.push('[' + m.params.entry.level + '] ' + m.params.entry.text); }
    else if (m.method === 'Runtime.consoleAPICalled') { logs.push('[console] ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ')); }
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result && r.result.value;
  };
  await new Promise((res, rej) => {
    if (ws.readyState === 1) return res(); // 事件可能已经触发过，不能只等 onopen
    ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error'));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.navigate', { url: PAGE });
  await new Promise((r) => setTimeout(r, 6000));
  console.log('boot: ' + await ev('JSON.stringify({coi:!!self.crossOriginIsolated, url:location.href})'));
  // start the probe detached; result lands in window.__PROBE_RESULT
  await ev('window.__PROBE_DONE=false;window.__PROBE_RESULT=null;Promise.resolve(' + EXPR + ')' +
          '.then(v=>{window.__PROBE_RESULT=v}).catch(e=>{window.__PROBE_RESULT="PROBE THREW: "+(e&&e.stack||e)})' +
          '.then(()=>{window.__PROBE_DONE=true});"started"');
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < MAXWAIT * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    done = await ev('window.__PROBE_DONE===true');
    process.stdout.write(done ? ' done\n' : '.');
    if (done) break;
  }
  console.log('\n=== PROBE RESULT (' + ((Date.now() - t0) / 1000).toFixed(0) + 's) ===');
  const out = await ev('window.__PROBE_RESULT');
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  console.log('=== LOG ENTRIES (' + logs.length + ') ===');
  for (const l of logs.slice(0, 40)) console.log(l);
  process.exit(0);
}
main().catch((e) => { console.log('CDP ERR ' + e.message); process.exit(1); });
