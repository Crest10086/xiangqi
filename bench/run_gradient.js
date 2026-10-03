/* bench/run_gradient.js — 可区分性验证: 相邻档位互弈 (高档 vs 低档)
 * 对: 入门vs业余, 业余vs进阶, 进阶vs高手, 高手vs大师
 * 每对: 低对 6 局(3局面x交换先后手), 高对 4 局(2局面x交换先后手)
 * 输出: bench/gradient_report.md/.json 或 g3_report.md/.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 分级(用户定案): 大师=无库满强度长考; 高手=开局库+200ms+UCI_Elo2400; 进阶150ms+Elo1800; 业余50ms+Elo1400; 入门内置d2
const CFG = [
  { name: '入门', kind: 'builtin', depth: 2, qDepth: 0, maxNodes: 1500, randomness: 45, book: false },
  { name: '业余', kind: 'pf', movetime: 50, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1400 }] },
  { name: '进阶', kind: 'pf', movetime: 150, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1800 }] },
  { name: '高手', kind: 'pf', movetime: 200, book: true, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 2400 }] },
  { name: '大师', kind: 'pf', movetime: 6000, book: false },
];
function estSec(c) { return c.kind === 'builtin' ? (c.maxNodes / 1500) * 2 : c.movetime * 0.30; }

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
// 用法: node run_gradient.js        -> 全部相邻对
//       node run_gradient.js g3      -> 只测 大师 vs 高手(8局), 报告写 g3_report.*
const G3 = process.argv.indexOf('g3') >= 0;
const PAIRS = G3 ? [ { hi: 4, lo: 3, n: 8 } ] : [ { hi: 1, lo: 0, n: 6 }, { hi: 2, lo: 1, n: 6 }, { hi: 3, lo: 2, n: 8 }, { hi: 4, lo: 3, n: 4 } ];

const tasks = [];
PAIRS.forEach((p, pi) => {
  const positions = fixtures.positions.slice(0, Math.ceil(p.n / 2));
  positions.forEach((pos, pIdx) => {
    for (let g = 0; g < 2 && tasks.filter(t => t.pair === pi).length < p.n; g++) {
      tasks.push({
        gameId: 'G' + pi + '-' + pos.id + '-G' + g,
        pair: pi, hi: p.hi, lo: p.lo,
        pairName: CFG[p.hi].name + ' vs ' + CFG[p.lo].name,
        posId: pos.id, startMoves: pos.startMoves,
        newPlaysFirst: g % 2 === 0,
        neu: CFG[p.hi], old: CFG[p.lo],
        seed: 987000 + pi * 1000 + pIdx * 10 + g,
      });
    }
  });
});
tasks.sort((a, b) => Math.max(estSec(b.neu), estSec(b.old)) - Math.max(estSec(a.neu), estSec(a.old)));
console.log('TASKS=' + tasks.length + ' pairs=' + PAIRS.length);

const REPORT_BASE = G3 ? 'g3' : 'gradient';
const resultsDir = path.join(__dirname, (G3 ? 'g3' : 'gradient') + '_out');
if (fs.existsSync(resultsDir)) for (const f of fs.readdirSync(resultsDir)) fs.unlinkSync(path.join(resultsDir, f));
fs.mkdirSync(resultsDir, { recursive: true });
const PARALLEL = 5;

function runTask(task) {
  return new Promise((resolve) => {
    const tf = path.join(resultsDir, task.gameId + '.task.json');
    const rf = path.join(resultsDir, task.gameId + '.result.json');
    fs.writeFileSync(tf, JSON.stringify(task));
    const child = spawn(process.execPath, [path.join(__dirname, 'play.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write('  ' + d));
    child.stderr.on('data', (d) => { err += d; });
    const to = setTimeout(() => child.kill('SIGKILL'), 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(to);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
      if (!r) r = { gameId: task.gameId, winner: 'error', reason: 'exit=' + code + ' ' + err.slice(0, 200), invalid: true };
      r.pair = task.pair; r.pairName = task.pairName; r.hi = task.hi; r.lo = task.lo;
      resolve(r);
    });
  });
}

(async () => {
  const results = [];
  let idx = 0;
  const t0 = Date.now();
  const workers = [];
  for (let w = 0; w < Math.min(PARALLEL, tasks.length); w++) {
    workers.push((async () => {
      while (idx < tasks.length) {
        const my = tasks[idx++];
        const r = await runTask(my);
        results.push(r);
        console.log('[' + results.length + '/' + tasks.length + '] ' + r.gameId + ' ' + r.pairName + ' -> ' + r.winner + ' (' + r.reason + ') ' + ((Date.now() - t0) / 60000).toFixed(1) + 'min');
      }
    })());
  }
  await Promise.all(workers);

  fs.writeFileSync(path.join(__dirname, REPORT_BASE + '_report.json'), JSON.stringify(results, null, 1));
  const perPair = {};
  for (const r of results) {
    const p = perPair[r.pair] = perPair[r.pair] || { name: r.pairName, hi: r.hi, lo: r.lo, hiWin: 0, draw: 0, loWin: 0, n: 0 };
    p.n++;
    if (r.winner === 'new') p.hiWin++;
    else if (r.winner === 'old') p.loWin++;
    else p.draw++;
  }
  const lines = [];
  lines.push('# 可区分性验证: 相邻档位互弈（高档 vs 低档, 同一固定局面集, 交换先后手）');
  lines.push('');
  lines.push('- 配置 = 生产参数(入门内置d2无库 / 业余50ms+Elo1400 / 进阶150ms+Elo1800 / 高手200ms+开局库+Elo2400 / 大师6000ms满强度无库); 判罚=index.html 严格复刻, 250步上限判和');
  lines.push('- 高档得分 = (胜+0.5和)/局数; 明显高于50% = 两档可区分');
  lines.push('');
  lines.push('| 对局 | 局数 | 高档胜 | 和 | 低档胜 | 高档得分 | 判定 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const pi of Object.keys(perPair).sort()) {
    const p = perPair[pi];
    const sc = (p.hiWin + 0.5 * p.draw) / p.n;
    let verdict = '可区分';
    if (sc <= 0.5) verdict = '不可区分(高档未占优)';
    else if (sc < 0.66) verdict = '弱区分';
    lines.push('| ' + p.name + ' | ' + p.n + ' | ' + p.hiWin + ' | ' + p.draw + ' | ' + p.loWin + ' | ' + (sc * 100).toFixed(1) + '% | ' + verdict + ' |');
  }
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, REPORT_BASE + '_report.md'), report);
  console.log('\n' + report);
  console.log('TOTAL ' + ((Date.now() - t0) / 60000).toFixed(1) + 'min');
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });