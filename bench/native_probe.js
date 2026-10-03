/* bench/native_probe.js — 原生 Pikafish (bmi2) 作强度锚点：同一局面、同一思考时间下的深度/节点对比 */
const { spawn } = require('child_process');
const path = require('path');
const DIR = 'C:/Users/35165/AppData/Local/hermes/cache/scratch/pk7z';
const EXE = DIR + '/pikafish-bmi2.exe';
const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const p = spawn(EXE, [], { cwd: DIR, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const lines = [];
p.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } });
p.stderr.on('data', (d) => console.log('[stderr] ' + String(d).trim()));

function send(s) { p.stdin.write(s + '\n'); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  send('uci');
  await sleep(2500);
  console.log('NET LINES:');
  console.log(lines.filter(l => /NNUE|Evaluation|Failed/i.test(l)).join('\n'));
  send('setoption name Hash value 256');
  send('setoption name Threads value 4');
  send('isready');
  await sleep(1500);
  for (const ms of [500, 2000, 6000]) {
    const mark = lines.length;
    send('position fen ' + FEN);
    send('go movetime ' + ms);
    await sleep(ms + 1500);
    let depth = 0, nodes = 0;
    for (let i = mark; i < lines.length; i++) {
      const l = lines[i];
      const d = /info depth (\d+)/.exec(l); if (d) depth = Math.max(depth, +d[1]);
      const n = /nodes (\d+)/.exec(l); if (n) nodes = Math.max(nodes, +n[1]);
    }
    console.log('NATIVE STARTPOS ' + ms + 'ms -> depth ' + depth + ' nodes ' + nodes);
  }
  send('quit');
  setTimeout(() => { p.kill(); process.exit(0); }, 1500);
})();
