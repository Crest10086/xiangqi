/* tier_probe_node3.js — TEST-ONLY probe (t_a8096ea3): drive the new engine from Node by passing
 * wasmBinary explicitly (the Emscripten Node path has no readBinary, so wasmBinary is required).
 * Tries: (a) nothreads build, (b) pthread build with a worker_threads Worker polyfill.
 */
const fs = require('fs');
const path = require('path');
const NE = path.join(__dirname) + path.sep;
const WB = path.join(__dirname, '..', 'wasm_build') + path.sep;
const mode = process.argv[2] || 'nothreads';

if (mode === 'pthread') {
  try { globalThis.Worker = require('worker_threads').Worker; console.log('Worker polyfill installed'); }
  catch (e) { console.log('polyfill fail: ' + e.message); }
}
const dir = mode === 'nothreads' ? WB : NE;
const jsFile = mode === 'nothreads' ? 'pikafish_nothreads.js' : 'pikafish.js';
const wasmFile = mode === 'nothreads' ? 'pikafish_nothreads.wasm' : 'pikafish.wasm';
const Pikafish = require(dir + jsFile);
const net = fs.readFileSync(NE + 'pikafish.nnue');
const wasm = fs.readFileSync(dir + wasmFile);
const t0 = Date.now();
const lines = [];

Pikafish({
  wasmBinary: wasm,
  locateFile: (f) => dir + f,
  mainScriptUrlOrBlob: dir + jsFile,
  print: (l) => { lines.push(String(l)); },
  printErr: (l) => { const s = String(l); if (s.length < 200) lines.push('[err] ' + s); },
}).then(async (m) => {
  console.log('MODE=' + mode + ' module ready in ' + (Date.now() - t0) + 'ms');
  m.FS.writeFile('/pikafish.nnue', new Uint8Array(net.buffer.slice(net.byteOffset, net.byteOffset + net.byteLength)));
  const send = (s) => {
    if (typeof m._pikafish_command === 'function') return m._pikafish_command(s);
    if (typeof m.sendCommand === 'function') return m.sendCommand(s);
    throw new Error('no command channel');
  };
  send('uci');
  await new Promise(r => setTimeout(r, 1500));
  console.log('--- id/eval lines ---');
  console.log(lines.filter(l => /id name|id version|NNUE|ERROR|error/i.test(l)).join('\n').slice(0, 600));
  send('setoption name Threads value ' + (mode === 'nothreads' ? 1 : 4));
  send('setoption name Hash value 64');
  send('setoption name MultiPV value 8');
  send('isready');
  await new Promise(r => setTimeout(r, 1500));
  const mark = lines.length;
  const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  send('position fen ' + FEN);
  const ts = Date.now();
  send('go movetime 300');
  for (let i = 0; i < 60; i++) {
    if (lines.slice(mark).some(l => /^bestmove/.test(l))) break;
    await new Promise(r => setTimeout(r, 200));
  }
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
  console.log('SEARCH wall=' + (Date.now() - ts) + 'ms depth=' + depth + ' nodes=' + nodes);
  console.log('slots=' + JSON.stringify(slots));
  console.log('bestmove: ' + out.filter(l => /^bestmove/.test(l)).join(' | '));
  console.log('lines=' + out.length);
  process.exit(0);
}, (e) => { console.log('INIT FAIL: ' + (e && (e.message || e))); process.exit(1); });
