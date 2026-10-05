/* serve_slow.js — bench-only static server, same headers as serve_upg.js (NO COOP/COEP, the GitHub
 * Pages case) but it STREAMS the .nnue at a fixed byte rate, so the client's own progress events
 * tick over several seconds and the download UI can be screenshotted mid-download.
 *
 * Why not CDP Network.emulateNetworkConditions: measured 2026-10-05, the worker's fetch of
 * pikafish.nnue completed at 1500KB/s and 200KB/s emulation settings in ~1s either way — the
 * emulation did not throttle that request, so throttling has to happen on the server side.
 *
 * COI=1 (default) also sends COOP/COEP so the page does NOT get reloaded by coi-serviceworker —
 * use that when you want to watch one download from start to finish. COI=0 reproduces the Pages
 * case (the page will be reloaded once by the shipped service worker).
 * usage: node serve_slow.js <root> <port> <log> [bytesPerSec]   env: COI=1|0
 */
const COI = (process.env.COI || '1') !== '0';
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || '.');
const port = +process.argv[3] || 8799;
const LOG = path.resolve(process.argv[4] || (root + '/../bench_results.log'));
const RATE = +process.argv[5] || 2 * 1024 * 1024; // bytes/sec
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.nnue': 'application/octet-stream', '.md': 'text/plain', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, url === '/' ? '/index.html' : url);
  if (!p.startsWith(path.resolve(root))) { res.writeHead(403); res.end(); return; }
  let data;
  try { data = fs.readFileSync(p); } catch (e) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
    'Content-Length': data.length,
    ...(COI ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}),
  });
  if (path.extname(p) !== '.nnue') { res.end(data); return; }
  fs.appendFileSync(LOG, 'SLOW-STREAM ' + url + ' bytes=' + data.length + ' rate=' + RATE + '\n');
  const t0 = Date.now();
  for (let off = 0; off < data.length; off += RATE) {
    const chunk = data.subarray(off, Math.min(off + RATE, data.length));
    res.write(chunk);
    await sleep(1000); // one chunk per second
  }
  fs.appendFileSync(LOG, 'SLOW-STREAM DONE ' + url + ' seconds=' + Math.round((Date.now() - t0) / 1000) + '\n');
  res.end();
}).listen(port, '127.0.0.1', () => console.log('serving(slow nnue ' + RATE + 'B/s) ' + root + ' on http://127.0.0.1:' + port));
