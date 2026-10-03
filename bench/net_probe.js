/* bench/net_probe.js — 引擎启动自述：用的什么评估、多大 hash、几条线程 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'js', 'engines', 'pikafish');
const PK = require(path.join(dir, 'pikafish.js'));
const lines = [];
PK({
  wasmBinary: fs.readFileSync(path.join(dir, 'pikafish.wasm')),
  locateFile: (p) => path.join(dir, p),
  getPreloadedPackage: () => {
    const b = fs.readFileSync(path.join(dir, 'pikafish.data'));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
  onReceiveStdout: (l) => { lines.push(String(l || '').replace(/[\r\n]+$/, '')); },
  onReceiveStderr: (s) => { lines.push('[stderr] ' + String(s).replace(/[\r\n]+$/, '')); },
  onExit: () => {},
}).then((mod) => {
  mod.sendCommand('uci');
  mod.sendCommand('setoption name Hash value 256');
  mod.sendCommand('isready');
  mod.sendCommand('position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
  mod.sendCommand('go movetime 1500');
  setTimeout(() => {
    const keep = lines.filter(l => /uciok|readyok|option name (Threads|Hash|EvalFile|UseNNUE)|info string|NNUE|valuation|evaluation|Hybrid|classical|Failed|error/i.test(l));
    console.log('TOTAL LINES = ' + lines.length);
    console.log('--- first 12 lines verbatim ---');
    console.log(lines.slice(0, 12).join('\n'));
    console.log('--- evaluation / option lines ---');
    console.log(keep.join('\n'));
    try { mod.sendCommand('quit'); } catch (e) {}
    process.exit(0);
  }, 9000);
}, (e) => { console.log('INIT FAIL', e && e.message); process.exit(1); });
