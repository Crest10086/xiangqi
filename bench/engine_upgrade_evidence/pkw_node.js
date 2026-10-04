/* pkw_node.js — 用 Node 驱动 mistboard 的 pikafish-wasm（pthread 构建） */
const fs = require('fs'); const path = require('path');
const dir = path.resolve('pkw');
const Pikafish = require(dir + '/pikafish.js');
const net = fs.readFileSync(dir + '/pikafish.nnue');
const wasm = fs.readFileSync(dir + '/pikafish.wasm');
const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const lines = [];
let mod = null;

Pikafish({
  wasmBinary: wasm,
  mainScriptUrlOrBlob: dir + '/pikafish.js',
  locateFile: (f) => dir + '/' + f,
  print: (l) => lines.push(String(l)),
  printErr: (l) => lines.push('[err] ' + String(l)),
}).then(async (m) => {
  mod = m;
  console.log('module ready, writing net (' + net.length + ' bytes)...');
  const t0 = Date.now();
  m.FS.writeFile('/pikafish.nnue', new Uint8Array(net.buffer.slice(net.byteOffset, net.byteOffset + net.byteLength)));
  const init = m.cwrap('pikafish_initialize', null, []);
  const cmd = m.cwrap('pikafish_command', null, ['string']);
  init();
  cmd('uci');
  await new Promise(r => setTimeout(r, 2000));
  console.log('--- uci id lines ---');
  console.log(lines.filter(l => /id name|NNUE|error|ERROR/i.test(l)).join('\n').slice(0, 800));
  cmd('setoption name Threads value ' + (process.env.THREADS || 1));
  cmd('setoption name Hash value 256');
  cmd('isready');
  await new Promise(r => setTimeout(r, 3000));
  console.log('--- net/eval lines ---');
  console.log(lines.filter(l => /NNUE evaluation|ERROR/i.test(l)).join('\n'));

  async function search(ms) {
    const mark = lines.length;
    let depth = 0, nodes = 0, score = null, move = null;
    cmd('position fen ' + FEN);
    const t = Date.now();
    cmd('go movetime ' + ms);
    await new Promise(r => setTimeout(r, ms + 2000));
    for (let i = mark; i < lines.length; i++) {
      const l = lines[i];
      const d = /info depth (\d+)/.exec(l); if (d) depth = Math.max(depth, +d[1]);
      const n = /nodes (\d+)/.exec(l); if (n) nodes = Math.max(nodes, +n[1]);
      const s = /score (cp (-?\d+)|mate (-?\d+))/.exec(l); if (s) score = s[2] !== undefined ? +s[2] : (s[3] > 0 ? 99999 : -99999);
      if (/^bestmove /.test(l)) move = l.split(/\s+/)[1];
    }
    return { depth, nodes, score, move, wall: Date.now() - t };
  }
  for (const ms of (process.env.TIMES || '500,2000,6000').split(',').map(Number)) {
    const r = await search(ms);
    console.log('PKW threads=' + (process.env.THREADS||1) + ' ' + ms + 'ms -> depth ' + r.depth + ' nodes ' + r.nodes + ' score ' + r.score + ' move ' + r.move);
  }
  process.exit(0);
}, (e) => { console.log('INIT FAIL: ' + (e && (e.message || e))); process.exit(1); });
