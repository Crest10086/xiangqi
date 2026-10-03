/* bench/run_diverge.js — 在"浅深评估分歧"题集上测 高手/大师 档
 * 参考评估 = 6000ms(深), 测各配置接近深搜判断的程度
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const JOBS = [
  { level: 3, name: '高手', testsFile: 'diverge800.json', refMs: 6000, neu: { kind: 'pf', movetime: 1800, book: true }, old: { kind: 'pf', movetime: 800, book: false } },
  { level: 4, name: '大师', testsFile: 'diverge2500.json', refMs: 6000, neu: { kind: 'pf', movetime: 6000, book: true }, old: { kind: 'pf', movetime: 2500, book: false } },
];
for (const j of JOBS) {
  const p = path.join(__dirname, j.testsFile);
  if (!fs.existsSync(p)) { console.error('缺 ' + j.testsFile); process.exit(1); }
  j.nTests = JSON.parse(fs.readFileSync(p, 'utf8')).tests.length;
  if (j.nTests === 0) { console.error(j.testsFile + ' 为空(无分歧题)'); process.exit(2); }
}
console.log('jobs:', JOBS.map(j => j.name + '(' + j.nTests + '题)').join(', '));

const outDir = path.join(__dirname, 'diverge_out');
if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
fs.mkdirSync(outDir, { recursive: true });

function runJob(j) {
  return new Promise((resolve) => {
    const tf = path.join(outDir, 'D' + j.level + '.task.json');
    const rf = path.join(outDir, 'D' + j.level + '.result.json');
    fs.writeFileSync(tf, JSON.stringify({ level: j.level, levelName: j.name, neu: j.neu, old: j.old, testsFile: path.join(__dirname, j.testsFile), refMs: j.refMs }));
    const child = spawn(process.execPath, [path.join(__dirname, 'tactics_worker2.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write('  ' + d));
    child.stderr.on('data', (d) => { err += d; });
    const to = setTimeout(() => child.kill('SIGKILL'), 35 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(to);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
      if (!r) r = { level: j.level, levelName: j.name, error: 'exit=' + code + ' ' + err.slice(0, 300) };
      resolve(r);
    });
  });
}

(async () => {
  const results = await Promise.all(JOBS.map(runJob));
  fs.writeFileSync(path.join(__dirname, 'diverge_report.json'), JSON.stringify(results, null, 1));
  const lines = [];
  lines.push('# 分歧题测验：只有深搜才能正确评估的局面');
  lines.push('');
  lines.push('- 题集: 800ms 与 6000ms 评估分歧>=150cp 的 ' + JOBS[0].nTests + ' 题(测高手档); 2500ms 与 6000ms 分歧>=150cp 的 ' + JOBS[1].nTests + ' 题(测大师档)');
  lines.push('- 参考评估 = 6000ms 深搜; loss = 深搜评估 - 实际着法造成的评估');
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
  fs.writeFileSync(path.join(__dirname, 'diverge_report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });