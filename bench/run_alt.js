/* bench/run_alt.js — 高手档三个候选配置各自 vs 基线高手(pf 800ms) 的对局对比
 * 每候选 4 固定局面 x 交换先后手 = 8 局；同一局面集、同一种子规则、判罚复刻 index.html
 * 输出: bench/alt_report.md + .json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ELO = (v) => [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: v }];
const OLD = { kind: 'pf', movetime: 800, book: false };
const CANDS = [
  { name: '候选 500ms+Elo2800+库', neu: { kind: 'pf', movetime: 500, book: true, uciOptions: ELO(2800) } },
  { name: '候选 500ms+Elo3133+库', neu: { kind: 'pf', movetime: 500, book: true, uciOptions: ELO(3133) } },
];
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
const PARALLEL = 5;
const resultsDir = path.join(__dirname, 'alt_out');
if (fs.existsSync(resultsDir)) for (const f of fs.readdirSync(resultsDir)) fs.unlinkSync(path.join(resultsDir, f));
fs.mkdirSync(resultsDir, { recursive: true });

const tasks = [];
CANDS.forEach((C, ci) => {
  fixtures.positions.forEach((pos) => {
    for (let g = 0; g < 2; g++) {
      tasks.push({
        gameId: 'A' + ci + '-' + pos.id + '-G' + g, cand: ci, candName: C.name,
        level: 3, levelName: '高手候选', posId: pos.id, startMoves: pos.startMoves,
        newPlaysFirst: g % 2 === 0, neu: C.neu, old: OLD,
        seed: 777000 + ci * 1000 + fixtures.positions.indexOf(pos) * 10 + g,
      });
    }
  });
});
console.log('TASKS=' + tasks.length + ' parallel=' + PARALLEL);

function runTask(task) {
  return new Promise((resolve) => {
    const tf = path.join(resultsDir, task.gameId + '.task.json');
    const rf = path.join(resultsDir, task.gameId + '.result.json');
    fs.writeFileSync(tf, JSON.stringify(task));
    const child = spawn(process.execPath, [path.join(__dirname, 'play.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write('  ' + d));
    child.stderr.on('data', (d) => { err += d; });
    const to = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(to);
      let r = null; try { r = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
      if (!r) r = { gameId: task.gameId, winner: 'error', reason: 'exit=' + code + ' ' + err.slice(0, 200), invalid: true };
      r.cand = task.cand; r.candName = task.candName;
      resolve(r);
    });
  });
}

(async () => {
  const results = [];
  let idx = 0;
  const worker = async () => { while (idx < tasks.length) { const my = idx++; const r = await runTask(tasks[my]); results.push(r); console.log('[' + results.length + '/' + tasks.length + '] ' + r.candName + ' -> ' + (r.winner === 'new' ? '候选胜' : r.winner === 'old' ? '基线胜' : r.winner)); } };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const agg = CANDS.map(() => ({ n: 0, w: 0, d: 0, l: 0 }));
  for (const r of results) { if (r.cand === undefined) continue; const a = agg[r.cand]; a.n++; if (r.winner === 'new') a.w++; else if (r.winner === 'old') a.l++; else a.d++; }
  const rows = CANDS.map((C, i) => {
    const a = agg[i]; const s = (a.w + 0.5 * a.d + 0.5) / (a.n + 1);
    const elo = s >= 1 ? 999 : Math.round(400 * Math.log10(s / (1 - s)));
    return { name: C.name, n: a.n, w: a.w, d: a.d, l: a.l, score: (a.w + 0.5 * a.d) / Math.max(a.n, 1), elo };
  });
  fs.writeFileSync(path.join(__dirname, 'alt_report.json'), JSON.stringify(rows, null, 1));
  const lines = [];
  lines.push('# 高手档候选配置 vs 基线高手(pf 800ms) 对局对比（每候选 8 局，交换先后手）');
  lines.push('');
  lines.push('| 候选 | 局数 | 胜 | 和 | 负 | 得分 | Elo |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of rows) lines.push('| ' + r.name + ' | ' + r.n + ' | ' + r.w + ' | ' + r.d + ' | ' + r.l + ' | ' + (r.score * 100).toFixed(1) + '% | ' + (r.elo > 0 ? '+' : '') + r.elo + ' |');
  const rep = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'alt_report.md'), rep);
  console.log('\n' + rep);
})().catch((e) => { console.error('ALT_FAIL', e); process.exit(1); });
