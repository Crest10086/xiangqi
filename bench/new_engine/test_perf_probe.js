/* new_engine/test_perf_probe.js — tests for the device self-check page (card t_0918db73).
 *
 * Input evidence (user, 2026-10-05 09:03): on a phone, https://crest10086.github.io/xiangqi/perf_probe.html
 * showed 「加载中…」 and then 「引擎加载失败」. The acceptance criterion that follows from it:
 *   the page must say WHY the engine failed, and when it succeeds it must report memory, thread count
 *   and first-load cost — in the same units the bench harness uses, so a phone number can be compared
 *   with the desktop numbers in bench/NEW_ENGINE_TIER_CALIBRATION.md.
 *
 * What this guards:
 *   A. the engine worker reports first-load stage costs (COST), its WASM memory (HEAP) and the thread
 *      count it actually got (ENV.threads clamped by hardwareConcurrency) — exercised for real in a
 *      stub worker environment, not by grepping.
 *   B. the bridge surfaces those as PF.lastCost.stages / PF.lastHeap / PF.env, exposes
 *      PF.requestHeap(tag), and never swallows the real load failure (PF.lastLoadError).
 *   C. perf_probe.html reads all of it: environment first (so a failure is explainable), the real
 *      error text, per-stage first-load timings against the recorded desktop baseline, engine memory
 *      in MB, thread count, and a copy button so a phone user can send the whole report back.
 *      The original node-count/depth ratio probe and its three verdict branches are still there.
 *
 * Run: node bench/new_engine/test_perf_probe.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log(' FAIL  ' + name); }
}

const WORKER_SRC = fs.readFileSync(path.join(ROOT, 'js', 'engines', 'pikafish', 'pikafish.worker.js'), 'utf8');
const tick = async (n) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const BRIDGE_SRC = fs.readFileSync(path.join(ROOT, 'js', 'pikafish_bridge.js'), 'utf8');
const PAGE_SRC = fs.readFileSync(path.join(ROOT, 'perf_probe.html'), 'utf8');

// ---------------------------------------------------------------------------
// A. the worker, for real: stub the browser/worker side and drive INIT
// ---------------------------------------------------------------------------
async function main() {
function runWorker(opts) {
  const o = opts || {};
  const sent = [];
  const netBytes = 4096;
  const heapLen = 322174976; // same magnitude as the measured Hash256 heap (307MB)
  const sandbox = {
    console, Math, JSON, Promise, Uint8Array, Error, String, Number, Object, Array, Buffer,
    performance: { now: () => Date.now() },
    navigator: { hardwareConcurrency: o.hc === undefined ? 4 : o.hc },
    SharedArrayBuffer: o.sab === false ? undefined : class {},
    crossOriginIsolated: o.coi !== false,
    fetch: async (url) => ({
      ok: o.netOk !== false, status: o.netOk === false ? 500 : 200,
      headers: { get: () => String(netBytes) },
      body: null,
      arrayBuffer: async () => new Uint8Array(netBytes).buffer
    }),
    importScripts: () => {
      sandbox.self.Pikafish = async (cfg) => {
        sandbox.__cfg = cfg;
        return {
          FS: { writeFile: (p, data) => { sandbox.__written = data.byteLength; } },
          cwrap: (name) => (name === 'pikafish_command'
            ? (line) => { sandbox.__cmds = (sandbox.__cmds || []).concat(line); if (line === 'uci') cfg.print('uciok'); }
            : () => {}),
          HEAPU8: { length: heapLen }
        };
      };
    }
  };
  const selfObj = {
    location: { href: 'https://example.test/xiangqi/js/engines/pikafish/pikafish.worker.js' },
    postMessage: (m) => sent.push(m),
    addEventListener: (type, fn) => { (sandbox.__handlers = sandbox.__handlers || {})[type] = fn; },
    importScripts: sandbox.importScripts,
    crossOriginIsolated: o.coi !== false
  };
  sandbox.self = selfObj;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(WORKER_SRC, sandbox);
  return { sent, sandbox, onmessage: selfObj.onmessage };
}

{
  const { sent, onmessage } = runWorker({ hc: 4 });
  onmessage({ data: { type: 'INIT', threads: 8, hash: 256 } }); // asks for 8 on a 4-core device
  await tick(60); // let the async init chain run
  const env = sent.find((m) => m.type === 'ENV');
  const costs = sent.filter((m) => m.type === 'COST');
  const heap = sent.filter((m) => m.type === 'HEAP');
  const ready = sent.find((m) => m.type === 'READY');

  t('worker reports the environment it is really in (coi / sab / hc)',
    !!env && env.coi === true && env.sab === true && env.hc === 4);
  t('worker reports the thread count it ACTUALLY got (8 requested on a 4-core device => 4)',
    !!env && env.threads === 4);
  t('worker reports first-load stage costs (importScripts / wasmModule / netDownload / nnueFsWrite / engineInitialize)',
    ['importScripts', 'wasmModule', 'netDownload', 'nnueFsWrite', 'engineInitialize']
      .every((k) => costs.some((c) => c.k === k && typeof c.ms === 'number')));
  t('worker reports the engine WASM memory after init (HEAPU8 length, tagged "ready")',
    heap.some((h) => h.tag === 'ready' && h.bytes === 322174976));
  t('worker still reports the downloaded network byte count',
    sent.some((m) => m.type === 'NET_WRITTEN' && m.bytes === 4096));
  t('READY is still emitted (the load contract is unchanged)', !!ready);
}
{
  const { sent, onmessage } = runWorker({ hc: null });
  onmessage({ data: { type: 'INIT', threads: 4, hash: 64 } });
  for (let i = 0; i < 40; i++) { await Promise.resolve(); }
  const env = sent.find((m) => m.type === 'ENV');
  t('a device that does not report hardwareConcurrency does not get 0 threads',
    !!env && env.threads >= 1);
  onmessage({ data: { type: 'HEAPREQ', tag: 'probe' } });
  t('HEAPREQ answers with the current engine memory (self-check sampling)',
    sent.some((m) => m.type === 'HEAP' && m.tag === 'probe' && m.bytes === 322174976));
}
{
  const { sent, onmessage } = runWorker({ netOk: false });
  onmessage({ data: { type: 'INIT', threads: 4, hash: 64 } });
  for (let i = 0; i < 40; i++) { await Promise.resolve(); }
  const err = sent.find((m) => m.type === 'ERROR');
  t('a failed 50.7MB download produces an ERROR with the HTTP status in it (not a silent timeout)',
    !!err && /HTTP 500/.test(String(err.message)));
}
{
  const { sent, onmessage, sandbox } = runWorker({});
  sandbox.importScripts = () => { throw new TypeError('importScripts failed'); };
  onmessage({ data: { type: 'INIT', threads: 4, hash: 64 } });
  await tick(60);
  const err = sent.find((m) => m.type === 'ERROR');
  t('a missing engine script is named as such (not a vague "thread error")',
    !!err && /引擎脚本加载失败/.test(String(err.message)) && /pikafish\.js/.test(String(err.message)));
  console.log('    engine-script error = ' + JSON.stringify(err && String(err.message).slice(0, 120)));
}

// ---------------------------------------------------------------------------
// B. the bridge: exposes the self-check data and keeps the real failure reason
// ---------------------------------------------------------------------------
function loadBridge(extra) {
  const isolated = !extra || extra.coi !== false;
  const sandbox = {
    window: { crossOriginIsolated: isolated, isSecureContext: true }, console, Math, JSON, Blob: class {}, URL, performance: { now: () => 0 },
    setTimeout, clearTimeout, Promise, Error, Object, String, Number, Array, atob: () => '',
    location: { protocol: 'https:' }, navigator: { hardwareConcurrency: 4 }, sessionStorage: { getItem: () => null, setItem: () => {} }
  };
  sandbox.window.PF_TIERS = require(path.join(ROOT, 'js', 'tier_config.js')).PF_TIERS;
  sandbox.globalThis = sandbox;
  Object.assign(sandbox, extra || {});
  vm.runInNewContext(BRIDGE_SRC, sandbox);
  return sandbox.window.PF;
}
{
  const PF = loadBridge();
  t('bridge exposes PF.requestHeap / PF.lastHeap / PF.lastLoadError',
    typeof PF.requestHeap === 'function' && 'lastHeap' in PF && 'lastLoadError' in PF);
  t('PF.requestHeap without an engine returns false instead of throwing',
    PF.requestHeap('probe') === false);
}
{
  // no Worker in this sandbox: the load must fail AND say why
  const PF = loadBridge({ coi: false });   // the phone case: Pages without isolation, no SW available
  const ok = await PF.whenReady();
  t('whenReady() still returns false when the engine cannot load', ok === false);
  t('the real reason survives whenReady() (PF.lastLoadError is a non-empty string, not swallowed)',
    typeof PF.lastLoadError === 'string' && PF.lastLoadError.length > 0);
  console.log('    lastLoadError = ' + JSON.stringify(PF.lastLoadError));
}
{
  // engine-side ERROR / COST / HEAP messages reach the page state
  let posted = [];
  class FakeWorker {
    constructor() { FakeWorker.instance = this; }
    postMessage(m) { posted.push(m); }
  }
  const PF = loadBridge({ Worker: FakeWorker });   // isolated + a Worker stub => the real A path runs
  PF.load();
  await tick(20);            // the A path creates the worker inside a promise chain
  const w = FakeWorker.instance;
  const handler = w.onmessage; // installed by attach()
  handler({ data: { type: 'COST', k: 'engineInitialize', ms: 812 } });
  handler({ data: { type: 'COST', k: 'netDownload', ms: 1440, bytes: 50706378 } });
  handler({ data: { type: 'HEAP', tag: 'ready', bytes: 322174976 } });
  handler({ data: { type: 'ERROR', message: '皮卡鱼初始化失败: out of memory' } });
  t('worker COST stages accumulate into PF.lastCost.stages (per-stage first-load report)',
    PF.lastCost && PF.lastCost.stages && PF.lastCost.stages.engineInitialize === 812 && PF.lastCost.stages.netDownload === 1440);
  t('worker HEAP lands in PF.lastHeap (engine memory the page can print)',
    PF.lastHeap && PF.lastHeap.bytes === 322174976 && PF.lastHeap.tag === 'ready');
  t('an engine-side ERROR is recorded as the load failure reason',
    /out of memory/.test(String(PF.lastLoadError)));
  PF.requestHeap('probe');
  t('PF.requestHeap posts a HEAPREQ to the engine worker',
    posted.some((m) => m.type === 'HEAPREQ' && m.tag === 'probe'));
}

// ---------------------------------------------------------------------------
// C. the page: environment first, real reason on failure, memory/threads/first-load on success
// ---------------------------------------------------------------------------
t('perf_probe.html loads the shipped bridge (same engine path as the game page)',
  /<script src="js\/pikafish_bridge\.js"><\/script>/.test(PAGE_SRC));
t('the page prints the device/browser environment BEFORE loading the engine',
  /hardwareConcurrency/.test(PAGE_SRC) && /deviceMemory/.test(PAGE_SRC) &&
  /crossOriginIsolated/.test(PAGE_SRC) && /SharedArrayBuffer/.test(PAGE_SRC) &&
  PAGE_SRC.indexOf('hardwareConcurrency') < PAGE_SRC.indexOf('PF.whenReady'));
t('on failure the page prints the real reason (PF.lastLoadError) instead of only "引擎加载失败"',
  /PF\.lastLoadError/.test(PAGE_SRC) && /function diagnose\(/.test(PAGE_SRC) &&
  /引擎加载失败/.test(PAGE_SRC));
t('the failure diagnosis covers the three known causes (not isolated / no SAB / timeout or init failure)',
  /crossOriginIsolated=false/.test(PAGE_SRC) && /SharedArrayBuffer/.test(PAGE_SRC) &&
  /加载超时/.test(PAGE_SRC) && /初始化失败/.test(PAGE_SRC));
t('on success the page reports first-load stage costs and compares them with the recorded desktop baseline',
  /lastCost/.test(PAGE_SRC) && /stages/.test(PAGE_SRC) &&
  /importScripts/.test(PAGE_SRC) && /nnueFsWrite/.test(PAGE_SRC) && /engineInitialize/.test(PAGE_SRC) &&
  /DESKTOP_FIRSTLOAD/.test(PAGE_SRC));
t('the page reports engine memory in MB with the desktop baseline next to it (307MB / 547MB)',
  /PF\.lastHeap/.test(PAGE_SRC) && /requestHeap/.test(PAGE_SRC) &&
  /DESKTOP_HEAP=\{readyMB:307,grewToMB:547\}/.test(PAGE_SRC) && /const MB=\(/.test(PAGE_SRC));
t('the page reports the thread count the engine actually got',
  /env\.threads/.test(PAGE_SRC) && /实际线程/.test(PAGE_SRC));
t('the page reports the engine-ready time against the measured online baseline (2093ms)',
  /2093/.test(PAGE_SRC) && /whenReady\(\)/.test(PAGE_SRC));
t('the original search-volume probe is kept (500/2000/6000ms, depth + nodes + nodes/sec + desktop ratio)',
  /\[500,2000,6000\]/.test(PAGE_SRC) &&
  /nodes\/Math\.max\(ms,1\)\*1000/.test(PAGE_SRC) &&   // fixed: the old code printed nodes/1000 "k节点/秒"
  /DESKTOP=\{500:\{nodes:96000,depth:15\}/.test(PAGE_SRC) &&
  /ratio=Math\.min\(ratio===null\?1e9:ratio, nodes\/DESKTOP\[ms\]\.nodes\)/.test(PAGE_SRC));
t('the three verdict branches are kept (>=80% / >=40% / below)',
  /pct>=80/.test(PAGE_SRC) && /pct>=40/.test(PAGE_SRC));
t('the whole report can be copied out of the phone (so the evidence reaches the developer)',
  /id="copy"/.test(PAGE_SRC) && /clipboard\.writeText/.test(PAGE_SRC) && /let REPORT=/.test(PAGE_SRC));
t('the page invents no device numbers: every baseline it prints is a named constant from the bench record',
  /const DESKTOP_FIRSTLOAD=/.test(PAGE_SRC) && /const DESKTOP_HEAP=/.test(PAGE_SRC));

// ---------------------------------------------------------------------------
// D. the shipped engine assets and the load contract are untouched
// ---------------------------------------------------------------------------
t('the worker still sends only Threads/Hash/MultiPV to the engine (the new build rejects the old options)',
  (() => {
    const opts = (WORKER_SRC.match(/setoption name [A-Za-z0-9_]+/g) || []).map((s) => s.replace('setoption name ', ''));
    return opts.length > 0 && opts.every((o) => ['Threads', 'Hash', 'MultiPV'].includes(o));
  })());
t('the bridge still refuses the multi-threaded build without COOP/COEP before downloading anything',
  /ensureIsolated\(\)/.test(BRIDGE_SRC) && /浏览器未隔离/.test(BRIDGE_SRC));
t('PF.NET_BYTES is still the shipped .nnue size', (() => {
  const real = fs.statSync(path.join(ROOT, 'js', 'engines', 'pikafish', 'pikafish.nnue')).size;
  return new RegExp(String(real)).test(BRIDGE_SRC);
})());

} // main()

main().then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log(' TEST THREW ' + (e && e.stack || e)); process.exit(1); });
