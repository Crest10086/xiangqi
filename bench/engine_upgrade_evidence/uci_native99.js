// .99 本机原生 pikafish 基准（与 .100 同引擎同网络）
const { spawn } = require('child_process');
const path = require('path');
const EXE = 'C:/Users/35165/AppData/Local/hermes/cache/scratch/pk7z/pikafish-bmi2.exe';
const p = spawn(EXE, [], { cwd: path.dirname(EXE), stdio: ['pipe','pipe','ignore'] });
let buf = ''; const lines = [];
p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0,i).replace(/\r$/,'')); buf = buf.slice(i+1); } });
const send = s => p.stdin.write(s + '\n');
send('uci');
setTimeout(() => { send('setoption name Hash value 256'); send('setoption name Threads value 4'); send('isready'); }, 2000);
const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
function search(ms) { return new Promise(res => { const mark = lines.length; const t0 = Date.now(); send('position fen ' + FEN); send('go movetime ' + ms);
  const iv = setInterval(() => { for (let i = mark; i < lines.length; i++) { if (/^bestmove/.test(lines[i])) { clearInterval(iv); let d=0,n=0; for (let j=mark;j<=i;j++){ const dd=/info depth (\d+)/.exec(lines[j]); if(dd)d=Math.max(d,+dd[1]); const nn=/nodes (\d+)/.exec(lines[j]); if(nn)n=Math.max(n,+nn[1]); } res({ms:Date.now()-t0,depth:d,nodes:n}); } } }, 10); }); }
(async () => { for (const ms of [500,2000,6000]) { const r = await search(ms); console.log('NATIVE-99 ' + ms + 'ms -> depth ' + r.depth + ' nodes ' + r.nodes); } p.kill(); process.exit(0); })();
