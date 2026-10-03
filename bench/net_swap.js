/* bench/net_swap.js — 把官方 50MB 网络塞进 WASM 引擎，对比小网络下的搜索质量
 * 步骤: 小网络搜索 -> FS 写入大网络 -> EvalFile 切换 -> 再搜索
 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'js', 'engines', 'pikafish');
const PK = require(path.join(dir, 'pikafish.js'));
const BIG = 'C:/Users/35165/pikafish-src/pikafish.nnue';
const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const lines = [];
let mod = null;

function search(ms) {
  return new Promise((resolve) => {
    let depth = 0, nodes = 0, done = false;
    const mark = lines.length;
    mod.sendCommand('position fen ' + FEN);
    mod.sendCommand('go movetime ' + ms);
    const iv = setInterval(() => {
      for (let i = mark; i < lines.length; i++) {
        const l = lines[i];
        const d = /info depth (\d+)/.exec(l); if (d) depth = +d[1];
        const n = /nodes (\d+)/.exec(l); if (n) nodes = +n[1];
        if (/^bestmove /.test(l) && !done) { done = true; clearInterval(iv); resolve({ depth, nodes, move: l.split(/\s+/)[1] }); }
      }
    }, 100);
    setTimeout(() => { if (!done) { clearInterval(iv); resolve({ depth, nodes, move: null }); } }, ms + 4000);
  });
}

const netBytes = fs.readFileSync(BIG);
PK({
  wasmBinary: fs.readFileSync(path.join(dir, 'pikafish.wasm')),
  locateFile: (p) => path.join(dir, p),
  getPreloadedPackage: () => {
    const b = fs.readFileSync(path.join(dir, 'pikafish.data'));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
  postRun: [(m) => {
    try {
      const u8 = new Uint8Array(netBytes.buffer.slice(netBytes.byteOffset, netBytes.byteOffset + netBytes.byteLength));
      m.FS.writeFile('big.nnue', u8);
      console.log('postRun FS.writeFile ok, bytes=' + u8.length);
    } catch (e) { console.log('postRun FS FAIL: ' + e.message); }
  }],
  onReceiveStdout: (l) => { lines.push(String(l || '').replace(/[\r\n]+$/, '')); },
  onReceiveStderr: () => {},
  onExit: () => {},
}).then(async (m) => {
  mod = m;
  mod.sendCommand('uci');
  mod.sendCommand('setoption name Hash value 256');
  mod.sendCommand('isready');
  await new Promise(r => setTimeout(r, 2500));
  const small = await search(2000);
  console.log('SMALL NET: ' + JSON.stringify(small));
  mod.sendCommand('setoption name EvalFile value big.nnue');
  mod.sendCommand('isready');
  await new Promise(r => setTimeout(r, 8000));
  const big = await search(2000);
  console.log('BIG NET: ' + JSON.stringify(big));
  console.log('--- net load lines ---');
  console.log(lines.filter(l => /NNUE evaluation|Failed to load|info string.*(net|Evaluation)/i.test(l)).join('\n'));
  try { mod.sendCommand('quit'); } catch (e) {}
  process.exit(0);
}, (e) => { console.log('INIT FAIL', e && e.message); process.exit(1); });
