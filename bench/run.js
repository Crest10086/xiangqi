/* bench/run.js — 基准编排器: 40局任务池(5档×4局面×2先后) + 并行执行 + 报告
 * 用法: node run.js [--games-per-pos N] [--parallel P] [--only levelIndex]
 * 输出: bench/report.md + bench/report.json + bench/results/*.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const GPP = arg('--games-per-pos', 2);       // 每局面局数(交换先后手)
const PARALLEL = arg('--parallel', 5);
const ONLY = args.includes('--only') ? arg('--only', -1) : -1;

// ---- 档位配置: 对照生产 vs 基线 bad6bc5 ----
// 生产(定案): 入门内置d2无库 / 业余50ms+Elo1400 / 进阶150ms+Elo1800 / 高手200ms+开局库+Elo2400 / 大师6000ms满强度无库
// 基线 bad6bc5: 业余内置d4 / 进阶内置d7 / 高手pf800ms / 大师pf2500ms, 无开局库
const LEVELS = [
  {
    name: '入门',
    neu: { kind: 'builtin', depth: 2, qDepth: 0, maxNodes: 1500, randomness: 45, book: true },
    old: { kind: 'builtin', depth: 2, qDepth: 0, maxNodes: 1500, randomness: 45, book: false },
  },
  {
    name: '业余',
    neu: { kind: 'pf', movetime: 50, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1400 }] },
    old: { kind: 'builtin', depth: 4, qDepth: 2, maxNodes: 25000, randomness: 0, book: false },
  },
  {
    name: '进阶',
    neu: { kind: 'pf', movetime: 150, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1800 }] },
    old: { kind: 'builtin', depth: 7, qDepth: 3, maxNodes: 400000, randomness: 0, book: false },
  },
  {
    name: '高手',
    neu: { kind: 'pf', movetime: 200, book: true, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 2400 }] },
    old: { kind: 'pf', movetime: 800, book: false },
  },
  {
    name: '大师',
    neu: { kind: 'pf', movetime: 6000, book: false },
    old: { kind: 'pf', movetime: 2500, book: false },
  },
];

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
const resultsDir = path.join(__dirname, 'results');
if (fs.existsSync(resultsDir)) for (const f of fs.readdirSync(resultsDir)) fs.unlinkSync(path.join(resultsDir, f));
fs.mkdirSync(resultsDir, { recursive: true });

// ---- 生成任务 (按预估耗时降序, 长任务先启动) ----
const estSec = (L) => {
  const s = (c) => (c.kind === 'pf' ? c.movetime : 6000);  // 内置 d7 约6s/步的粗估
  return (s(L.neu) + s(L.old)) / 1000 * 50;                 // 约50步双方合计
};
const tasks = [];
LEVELS.forEach((L, li) => {
  if (ONLY >= 0 && li !== ONLY) return;
  fixtures.positions.forEach((pos) => {
    for (let g = 0; g < GPP; g++) {
      tasks.push({
        gameId: 'L' + li + '-' + pos.id + '-G' + g,
        level: li, levelName: L.name, posId: pos.id,
        startMoves: pos.startMoves,
        newPlaysFirst: g % 2 === 0,
        neu: L.neu, old: L.old,
        seed: 424242 + li * 1000 + fixtures.positions.indexOf(pos) * 10 + g,
      });
    }
  });
});
tasks.sort((a, b) => estSec(LEVELS[b.level]) - estSec(LEVELS[a.level]));
console.log('TASKS=' + tasks.length + ' parallel=' + PARALLEL + ' games-per-pos=' + GPP);

// ---- 任务池执行 ----
function runTask(task) {
  return new Promise((resolve) => {
    const tf = path.join(resultsDir, task.gameId + '.task.json');
    const rf = path.join(resultsDir, task.gameId + '.result.json');
    fs.writeFileSync(tf, JSON.stringify(task));
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, 'play.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write('  ' + d); });
    child.stderr.on('data', (d) => { err += d; });
    const to = setTimeout(() => { child.kill('SIGKILL'); }, 25 * 60 * 1000); // 单局25分钟硬上限
    child.on('close', (code) => {
      clearTimeout(to);
      let result = null;
      try { result = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
      if (!result) result = { gameId: task.gameId, winner: 'error', reason: 'exit=' + code + ' ' + err.slice(0, 200), invalid: true };
      result.level = task.level; result.levelName = task.levelName;
      resolve(result);
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
        const done = results.length;
        console.log('[' + done + '/' + tasks.length + '] ' + r.gameId + ' -> ' + r.winner + ' (' + r.reason + ') ' + ((Date.now() - t0) / 60000).toFixed(1) + 'min');
      }
    })());
  }
  await Promise.all(workers);
  console.log('ALL_DONE ' + ((Date.now() - t0) / 60000).toFixed(1) + 'min');

  // ---- 汇总 ----
  fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(results, null, 1));
  const lines = [];
  lines.push('# 棋力基准报告: 新版 vs 基线(bad6bc5)');
  lines.push('');
  lines.push('- 局面集: ' + fixtures.positions.map(p => p.id + '(' + p.label + ')').join(' / ') + ' — ' + fixtures.generated);
  lines.push('- 每局面 ' + GPP + ' 局(交换先后手), 随机种子固定(mulberry32), 规则=index.html 严格判罚复刻, 250步上限判和');
  lines.push('- 新版=生产配置(全档开局库+MILLIS{1:200,2:600,3:1800,4:6000}); 基线=bad6bc5(无库+MILLIS{3:800,4:2500}, 业余/进阶为内置d4/d7)');
  lines.push('');
  lines.push('| 档位 | 局数 | 新版胜 | 和 | 基线胜 | 新版得分 | Elo增益 | 判定 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  const perLevel = {};
  for (const r of results) {
    if (r.invalid || r.winner === 'error') continue;
    const k = r.level;
    perLevel[k] = perLevel[k] || { n: 0, w: 0, d: 0, l: 0 };
    perLevel[k].n++;
    if (r.winner === 'new') perLevel[k].w++;
    else if (r.winner === 'old') perLevel[k].l++;
    else perLevel[k].d++;
  }
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const s = perLevel[i];
    if (!s) continue;
    const score = (s.w + 0.5 * s.d) / s.n;
    const smooth = (s.w + 0.5 * s.d + 0.5) / (s.n + 1);   // 拉普拉斯平滑防 Infinity
    const elo = 400 * Math.log10(smooth / (1 - smooth));
    const verdict = score > 0.5 ? '提升' : (score === 0.5 ? '持平' : '下降');
    rows.push('| ' + LEVELS[i].name + ' | ' + s.n + ' | ' + s.w + ' | ' + s.d + ' | ' + s.l + ' | ' + (score * 100).toFixed(1) + '% | +' + elo.toFixed(0) + ' | ' + verdict + ' |');
  }
  lines.push(...rows);
  lines.push('');
  lines.push('说明: Elo增益 = 400·log10(平滑得分率/(1-平滑得分率)), 平滑=(胜+0.5和+0.5)/(n+1); 正值=新版更强。');
  const errs = results.filter(r => r.invalid || r.winner === 'error');
  if (errs.length) lines.push('无效局: ' + errs.length + ' (报告已剔除): ' + errs.map(e => e.gameId + ':' + e.reason).join(', '));
  lines.push('');
  lines.push('## 分局明细');
  lines.push('| 局 | 先手 | 结果 | 判定 | 步数 | 耗时 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results.slice().sort((a, b) => (a.gameId > b.gameId ? 1 : -1))) {
    lines.push('| ' + r.gameId + ' | ' + (r.newPlaysFirst ? '新' : '旧') + ' | ' + r.winner + ' | ' + r.reason + ' | ' + r.plies + ' | ' + (r.elapsedMs ? (r.elapsedMs / 1000).toFixed(0) + 's' : '-') + ' |');
  }
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });