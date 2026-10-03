/* bench/run_quality.js — 质量评估版全 5 档测验
 * 题集: tactics.json + hard.json + hard800.json + hard2500.json 合并去重
 * 测量: 着法质量损失(参考引擎3000ms评估), 不要求与特定着法相同
 * 输出: bench/quality2_report.md + quality2_report.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const XQ = require(path.join(__dirname, '..', 'engine.js'));

const LEVELS = [
  { name: '入门', neu: { kind: 'builtin', depth: 2, qDepth: 0, maxNodes: 1500, randomness: 45, book: false }, old: { kind: 'builtin', depth: 2, qDepth: 0, maxNodes: 1500, randomness: 45, book: false } },
  { name: '业余', neu: { kind: 'pf', movetime: 50, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1400 }] }, old: { kind: 'builtin', depth: 4, qDepth: 2, maxNodes: 25000, randomness: 0, book: false } },
  { name: '进阶', neu: { kind: 'pf', movetime: 150, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1800 }] }, old: { kind: 'builtin', depth: 7, qDepth: 3, maxNodes: 400000, randomness: 0, book: false } },
  { name: '高手', neu: { kind: 'pf', movetime: 500, book: false }, old: { kind: 'pf', movetime: 800, book: false } },
  { name: '大师', neu: { kind: 'pf', movetime: 6000, book: true }, old: { kind: 'pf', movetime: 2500, book: false } },
];

function replayKey(startMoves) {
  const g = new XQ.Game('none', -1);
  for (const mv of startMoves) { if (!g.move(mv)) return null; }
  return g.board.join(',') + '#' + g.side;
}
// 合并去重题集
const uniq = new Map();
for (const f of ['tactics.json', 'hard.json', 'hard800.json', 'hard2500.json']) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  for (const t of JSON.parse(fs.readFileSync(p, 'utf8')).tests) {
    const k = replayKey(t.startMoves);
    if (k && !uniq.has(k)) uniq.set(k, { id: 'Q' + t.id, startMoves: t.startMoves, side: t.side, bestMove: t.bestMove });
  }
}
const tests = [...uniq.values()];
const testsFile = path.join(__dirname, 'quality_tests.json');
fs.writeFileSync(testsFile, JSON.stringify({ tests }, null, 1));
console.log('merged unique tests =', tests.length);

const outDir = path.join(__dirname, 'quality_out');
if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
fs.mkdirSync(outDir, { recursive: true });

function runLevel(li) {
  return new Promise((resolve) => {
    const tf = path.join(outDir, 'Q' + li + '.task.json');
    const rf = path.join(outDir, 'Q' + li + '.result.json');
    fs.writeFileSync(tf, JSON.stringify({ level: li, levelName: LEVELS[li].name, neu: LEVELS[li].neu, old: LEVELS[li].old, testsFile }));
    const child = spawn(process.execPath, [path.join(__dirname, 'tactics_worker2.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write('  ' + d));
    child.stderr.on('data', (d) => { err += d; });
    const to = setTimeout(() => child.kill('SIGKILL'), 40 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(to);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
      if (!r) r = { level: li, levelName: LEVELS[li].name, error: 'exit=' + code + ' ' + err.slice(0, 300) };
      resolve(r);
    });
  });
}

(async () => {
  const results = [];
  let idx = 0;
  const workers = [];
  for (let w = 0; w < 5; w++) {
    workers.push((async () => { while (idx < LEVELS.length) { const my = idx++; results.push(await runLevel(my)); } })());
  }
  await Promise.all(workers);
  results.sort((a, b) => a.level - b.level);
  fs.writeFileSync(path.join(__dirname, 'quality2_report.json'), JSON.stringify(results, null, 1));
  const lines = [];
  lines.push('# 着法质量基准（测质量损失，不要求与特定参考着法相同）');
  lines.push('');
  lines.push('- 题集: ' + tests.length + ' 个去重中局局面（平稳+混乱混合）');
  lines.push('- 方法: 参考引擎(皮卡鱼3000ms)评估局面 -> 被测配置出招 -> 再评估新局面; loss=参考评估-实际评估; 同 worker 内两配置共用同一参考标准与种子');
  lines.push('- 打分: loss<=10→1.0, <=50→0.9, <=100→0.7, <=200→0.4, <=400→0.15, 否则0');
  lines.push('');
  lines.push('| 档位 | 质量得分(新) | 质量得分(基线) | 平均损失cp(新) | 平均损失cp(基线) | 大失误数(新) | 大失误数(基线) | 判定 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    if (r.error) { lines.push('| ' + r.levelName + ' | ERROR: ' + r.error + ' |'); continue; }
    const verdict = r.neu.score > r.old.score ? '提升' : (r.neu.score === r.old.score ? '持平' : '下降');
    lines.push('| ' + r.levelName +
      ' | ' + (r.neu.score * 100).toFixed(1) + '% | ' + (r.old.score * 100).toFixed(1) + '%' +
      ' | ' + r.neu.avgLoss.toFixed(0) + ' | ' + r.old.avgLoss.toFixed(0) +
      ' | ' + r.neu.bigMistakes + ' | ' + r.old.bigMistakes + ' | ' + verdict + ' |');
  }
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'quality2_report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });