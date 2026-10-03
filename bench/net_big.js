/* bench/net_big.js — 用替换后的 .data（内含官方 50.7MB 网络）启动引擎，验证加载与搜索深度
 * 用法: node net_big.js [data文件路径]   默认用项目里的 pikafish.data 作对照
 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'js', 'engines', 'pikafish');
const PK = require(process.env.ENGINE || path.join(dir, 'pikafish.js'));
const DATA = process.argv[2] || path.join(dir, 'pikafish.data');
const FENS = [
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
  '4k4/9/9/9/9/9/9/9/4K4 w - - 0 1',
];
const lines = [];
let mod = null;

function search(fen, ms) {
  return new Promise((resolve) => {
    let depth = 0, nodes = 0, done = false;
    const mark = lines.length;
    mod.sendCommand('position fen ' + fen);
    mod.sendCommand('go movetime ' + ms);
    const iv = setInterval(() => {
      for (let i = mark; i < lines.length; i++) {
        const l = lines[i];
        const d = /info depth (\d+)/.exec(l); if (d) depth = +d[1];
        const n = /nodes (\d+)/.exec(l); if (n) nodes = +n[1];
        if (/^bestmove /.test(l) && !done) { done = true; clearInterval(iv); resolve({ depth, nodes }); }
      }
    }, 100);
    setTimeout(() => { if (!done) { clearInterval(iv); resolve({ depth, nodes, timeout: true }); } }, ms + 5000);
  });
}

process.on('unhandledRejection', (e) => { console.log('UNHANDLED: ' + (e && (e.message || String(e)))); });
PK({
  wasmBinary: fs.readFileSync(path.join(dir, 'pikafish.wasm')),
  locateFile: (p) => path.join(dir, p),
  getPreloadedPackage: () => {
    const b = fs.readFileSync(DATA);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
  onReceiveStdout: (l) => { lines.push(String(l || '').replace(/[\r\n]+$/, '')); },
  onReceiveStderr: (s) => { console.log('[stderr] ' + String(s).replace(/[\r\n]+$/, '')); },
  onAbort: (r) => { console.log('ABORT: ' + r); },
  onExit: (c) => { console.log('ENGINE EXIT = ' + c); },
}).then(async (m) => {
  mod = m;
  console.log('DATA = ' + DATA + ' (' + fs.statSync(DATA).size + ' bytes)');
  try { console.log('WASM MEMORY = ' + (m.buffer ? (m.buffer.byteLength / 1048576).toFixed(0) + ' MiB' : 'n/a')); } catch (e) {}
  mod.sendCommand('uci');
  mod.sendCommand('setoption name Hash value ' + (process.env.HASH || 32));
  mod.sendCommand('isready');
  await new Promise(r => setTimeout(r, 4000));
  console.log('--- net load lines ---');
  console.log(lines.filter(l => /NNUE evaluation|Failed to load|classical/i.test(l)).join('\n'));
  console.log('--- all captured lines (' + lines.length + ') ---');
  console.log(lines.slice(0, 25).join('\n'));
  for (const ms of (process.env.TIMES || '500,2000,6000').split(',').map(Number)) {
    const r = await search(FENS[0], ms);
    console.log('STARTPOS ' + ms + 'ms -> depth ' + r.depth + ' nodes ' + r.nodes);
  }
  try { mod.sendCommand('quit'); } catch (e) {}
  process.exit(0);
}, (e) => { console.log('INIT FAIL', e && e.message); process.exit(1); });
