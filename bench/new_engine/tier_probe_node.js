/* tier_probe_node.js — TEST-ONLY (card t_a8096ea3).
 * Probe: can the Node process drive bench/new_engine/pikafish.* (mistboard pthread WASM build,
 * full 50.7MB net) the same way worker_mb.js does in the browser? We need this to run the
 * calibration grid without a Chrome round per iteration.
 * Prints: init time, id/NNUE self-report lines, and a MultiPV=8 search on the start position.
 */
const fs = require('fs');
const path = require('path');
const DIR = __dirname + path.sep;
const Pikafish = require(DIR + 'pikafish.js');
const net = fs.readFileSync(DIR + 'pikafish.nnue');
const t0 = Date.now();
const lines = [];

Pikafish({
  locateFile: (f) => DIR + f,
  mainScriptUrlOrBlob: DIR + 'pikafish.js',
  print: (l) => { lines.push(String(l)); },
  printErr: (l) => { lines.push('[err] ' + String(l)); },
}).then(async (m) => {
  console.log('module ready in ' + (Date.now() - t0) + 'ms');
  m.FS.writeFile('/pikafish.nnue', new Uint8Array(net.buffer.slice(net.byteOffset, net.byteOffset + net.byteLength)));
  const hasInit = typeof m._pikafish_initialize === 'function';
  const hasCmd = typeof m._pikafish_command === 'function';
  console.log('exports: pikafish_initialize=' + hasInit + ' pikafish_command=' + hasCmd);
  const send = (s) => {
    if (hasCmd) { m._pikafish_command(m._pikafish_command.length ? s : s); return; }
    if (typeof m.sendCommand === 'function') { m.sendCommand(s); return; }
    throw new Error('no command channel');
  };
  send('uci');
  await new Promise(r => setTimeout(r, 1500));
  console.log('--- id/eval lines ---');
  console.log(lines.filter(l => /id name|id version|NNUE|ERROR|error/i.test(l)).join('\n').slice(0, 900));
  send('setoption name Threads value 4');
  send('setoption name Hash value 64');
  send('setoption name MultiPV value 8');
  send('isready');
  await new Promise(r => setTimeout(r, 1500));
  const mark = lines.length;
  const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  send('position fen ' + FEN);
  const ts = Date.now();
  send('go movetime 150');
  await new Promise(r => setTimeout(r, 2500));
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
  console.log('bestmove lines: ' + out.filter(l => /^bestmove/.test(l)).join(' | '));
  console.log('total lines=' + out.length);
  process.exit(0);
}, (e) => { console.log('INIT FAIL: ' + (e && (e.message || e))); process.exit(1); });
