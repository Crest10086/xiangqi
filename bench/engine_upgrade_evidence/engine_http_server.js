/* engine_http_server.js — 原生引擎常驻 + 薄 HTTP/UCI 服务原型
 * GET /move?fen=...&ms=500  -> {move, depth, nodes, score, wall_ms}
 * GET /healthz
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENGINE = process.argv[2] || 'C:/Users/35165/AppData/Local/hermes/cache/scratch/pk7z/pikafish-bmi2.exe';
const ENGINE_DIR = path.dirname(ENGINE);
const PORT = +process.argv[3] || 8899;
const THREADS = +process.argv[4] || 4;

const p = spawn(ENGINE, [], { cwd: ENGINE_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const lines = [];
p.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } });
p.stderr.on('data', (d) => console.error('[engine stderr] ' + String(d).trim()));
function send(s) { p.stdin.write(s + '\n'); }

// init
send('uci');
setTimeout(() => {
  send('setoption name Hash value 256');
  send('setoption name Threads value ' + THREADS);
  send('isready');
}, 1500);

function search(fen, ms) {
  return new Promise((resolve) => {
    const mark = lines.length;
    const t0 = Date.now();
    send('position fen ' + fen);
    send('go movetime ' + ms);
    const iv = setInterval(() => {
      for (let i = mark; i < lines.length; i++) {
        const l = lines[i];
        if (/^bestmove /.test(l)) {
          clearInterval(iv);
          let depth = 0, nodes = 0, score = null;
          for (let j = mark; j <= i; j++) {
            const dd = /info depth (\d+)/.exec(lines[j]); if (dd) depth = Math.max(depth, +dd[1]);
            const nn = /nodes (\d+)/.exec(lines[j]); if (nn) nodes = Math.max(nodes, +nn[1]);
            const ss = /score (cp (-?\d+)|mate (-?\d+))/.exec(lines[j]); if (ss) score = ss[2] !== undefined ? +ss[2] : (ss[3] > 0 ? 99999 : -99999);
          }
          resolve({ move: l.split(/\s+/)[1], depth, nodes, score, wall_ms: Date.now() - t0 });
        }
      }
    }, 10);
  });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const t0 = Date.now();
  if (u.pathname === '/healthz') { res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({ ok: true })); return; }
  if (u.pathname === '/move') {
    const fen = u.searchParams.get('fen') || 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
    const ms = +(u.searchParams.get('ms') || 500);
    const r = await search(fen, ms);
    r.server_ms = Date.now() - t0;
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(r));
    return;
  }
  res.writeHead(404); res.end('nf');
}).listen(PORT, '0.0.0.0', () => console.log('engine http on :' + PORT + ' engine=' + ENGINE));
