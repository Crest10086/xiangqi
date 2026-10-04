/* worker_mb.js — mistboard pikafish-wasm worker + timing/memory instrumentation (test copy, scratch only) */
let command = null;
let modRef = null;
let tInit = 0;
function stamp(k, extra) { self.postMessage(Object.assign({ type: 'timing', k: k, ms: (performance.now() - tInit) }, extra || {})); }
async function fetchNet(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('net fetch failed: ' + response.status);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    self.postMessage({ type: 'net-progress', loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function measureMem(tag) {
  try {
    if (typeof performance !== 'undefined' && performance.measureUserAgentSpecificMemory) {
      performance.measureUserAgentSpecificMemory().then(function (m) {
        self.postMessage({ type: 'mem', tag: tag, total: m.bytes, bd: (m.breakdown || []).map(function (b) { return { t: (b.types || []).join('+'), b: b.bytes }; }) });
      }).catch(function (e) { self.postMessage({ type: 'mem-err', tag: tag, e: String(e) }); });
    } else {
      self.postMessage({ type: 'mem-na', tag: tag });
    }
  } catch (e) { self.postMessage({ type: 'mem-err', tag: tag, e: String(e) }); }
}
self.addEventListener('error', function (e) { self.postMessage({ type: 'error', error: 'onerror: ' + (e.message || e.type || 'unknown') }); });
self.addEventListener('unhandledrejection', function (e) { self.postMessage({ type: 'error', error: 'unhandled: ' + String(e.reason) }); });
self.addEventListener('message', async (event) => {
  const message = event.data;
  if (message && message.type === 'init') {
    tInit = performance.now();
    try {
      self.postMessage({ type: 'env', sab: (typeof SharedArrayBuffer !== 'undefined'), coi: (typeof self.crossOriginIsolated !== 'undefined' ? self.crossOriginIsolated : null) });
      const netPromise = fetchNet(message.netUrl).then(function (n) { stamp('net', { bytes: n.byteLength }); return n; });
      importScripts(message.jsUrl);
      stamp('importScripts');
      const factory = self.Pikafish;
      if (typeof factory !== 'function') { throw new Error('Pikafish factory missing after script load'); }
      const module = await factory({
        locateFile: (file) => (file.endsWith('.wasm') ? message.wasmUrl : file),
        mainScriptUrlOrBlob: message.jsUrl,
        print: (line) => self.postMessage({ type: 'line', line: String(line) }),
        printErr: (line) => self.postMessage({ type: 'stderr', line: String(line) }),
      });
      stamp('module');
      const net = await netPromise;
      module.FS.writeFile('/pikafish.nnue', net);
      stamp('fs-write', { bytes: net.byteLength });
      self.postMessage({ type: 'net-written', bytes: net.byteLength });
      const initialize = module.cwrap('pikafish_initialize', null, []);
      command = module.cwrap('pikafish_command', null, ['string']);
      initialize();
      stamp('initialize');
      modRef = module;
      try { self.postMessage({ type: 'heap', tag: 'ready', bytes: (module.HEAPU8 && module.HEAPU8.length) || null }); } catch (e) {}
      measureMem('ready');
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message && message.type === 'measure') { measureMem(message.tag || 'manual'); return; }
  if (message && message.type === 'heapreq') {
    try { self.postMessage({ type: 'heap', tag: message.tag || 'req', bytes: modRef && modRef.HEAPU8 ? modRef.HEAPU8.length : null }); }
    catch (e) { self.postMessage({ type: 'heap', tag: message.tag || 'req', bytes: null }); }
    return;
  }
  if (message && message.type === 'command' && typeof message.command === 'string') {
    if (!command) { self.postMessage({ type: 'error', error: 'Pikafish worker is not ready' }); return; }
    command(message.command);
  }
});
