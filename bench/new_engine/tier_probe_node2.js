/* tier_probe_node2.js — TEST-ONLY probe (card t_a8096ea3): can Node drive the nothreads WASM
 * build (bench/wasm_build/pikafish_nothreads.js) with the full net, and can the pthread build be
 * driven from Node by polyfilling globalThis.Worker from worker_threads?
 * Prints init time + a MultiPV=8 search result for whichever path works.
 */
const fs = require('fs');
const path = require('path');
const NE = path.join(__dirname) + path.sep;
const WB = path.join(__dirname, '..', 'wasm_build') + path.sep;
const mode = process.argv[2] || 'nothreads';

if (mode === 'pthread_worker_polyfill') {
  try { globalThis.Worker = require('worker_threads').Worker; } catch (e) { console.log('polyfill fail', e.message); }
}
const dir = mode === 'nothreads' ? WB : NE;
const jsFile = mode === 'nothreads' ? 'pikafish_nothreads.js' : 'pikafish.js';
const Pikafish = require(dir + jsFile);
const net = fs.readFileSync(NE + 'pikafish.nnue');
const t0 = Date.now();
const lines = [];

Pikafish({
  locateFile: (f) => (f.endsWith('.wasm') ? dir + (mode === 'nothreads' ? 'pikafish_nothreads.wasm' : 'pikafish.wasm') : dir + f),
  mainScriptUrlOrBlob: dir + jsFile,
  print: (l) => { lines.push(String(l)); },
  printErr: (l) => { if (String(l).length < 300) lines.push('[err] ' + String(l)); },
}).then(async (m) => {
  console.log('MODE=' + mode + ' module ready in ' + (Date.now() - t0) + 'ms');
  const buf = new Uint8Array(net.buffer.slice(net.byteOffset, net.byteOffset + net.byteLength));
  m.FS.writeFile('/pikafish.nnue', buf);
  const send = (s) => {
    if (typeof m._pikafish_command === 'function') return m._pikafish_command(s);
    if (typeof m.sendCommand === 'function') return m.sendCommand(s);
    throw new Error('no command channel');
  };
  send('uci');
  await new Promise(r => setTimeout(r, 1200));
  console.log('--- id/eval lines ---');
  console.log(lines.filter(l => /id name|id version|NNUE|ERROR|error/i.test(l)).join('\n').slice(0, 600));
  send('setoption name Threads value 4');
  send('setoption name Hash value 64');
  send('setoption name MultiPV value 8');
  send('isready');
  await new Promise(r => setTimeout(r, 1200));
  const mark = lines.length;
  const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  send('position fen ' + FEN);
  const ts = Date.now();
  send('go movetime 300');
  await new Promise(r => setTimeout(r, 4000));
  const out = lines.slice(mark);
  let depth = 0, nodes = 0;
  const slots = {};
  for (const l of out) {
    const d = /depth (\d+)/.exec(l); if (d) depth = Math.max(depth, +d[1]);
    const n = /nodes (\d+)/.exec(l); if (n) nodes = Math.max(nodes, +n[1]);
    const mm = l.match(/\bmultipv (\d+)/); if (!mm) continue;
    const sm = l.match(/\bscore (cp|mate) (-?\d+)/); if (!sm) continue;
    slots[+mm[1]] = sm[1] === 'mate' ? (sm[2] > 0 ? 100000 : -100000) : +sm[2];
  }
  console.log('SEARCH wall=' + (Date.now() - ts) + 'ms depth=' + depth + ' nodes=' + nodes + ' slots=' + JSON.stringify(slots));
  console.log('bestmove: ' + out.filter(l => /^bestmove/.test(l)).join(' | '));
  console.log('lines=' + out.length);
  process.exit(0);
}, (e) => { console.log('INIT FAIL: ' + (e && (e.message || e))); process.exit(1); });
