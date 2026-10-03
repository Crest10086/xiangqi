/* bench/run_hard2.js — 定制题集上的最终区分测验
 * 高手档: hard800.json (800ms答错的题) 上测 1800ms(新) vs 800ms(基线)
 * 大师档: hard2500.json (2500ms答错的题) 上测 6000ms(新) vs 2500ms(基线)
 * 输出: bench/hard2_report.md + .json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const JOBS = [
  { level: 3, name: '高手', testsFile: 'hard800.json', neu: { kind: 'pf', movetime: 1800, book: true }, old: { kind: 'pf', movetime: 800, book: false } },
  { level: 4, name: '大师', testsFile: 'hard2500.json', neu: { kind: 'pf', movetime: 6000, book: true }, old: { kind: 'pf', movetime: 2500, book: false } },
];
for (const j of JOBS) {
  const p = path.join(__dirname, j.testsFile);
  if (!fs.existsSync(p)) { console.error('缺 ' + j.testsFile); process.exit(1); }
  j.nTests = JSON.parse(fs.readFileSync(p, 'utf8')).tests.length;
}
console.log('jobs:', JOBS.map(j => j.name + '(' + j.nTests + '题)').join(', '));

const outDir = path.join(__dirname, 'hard2_out');
if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
fs.mkdirSync(outDir, { recursive: true });

function runJob(j) {
  return new Promise((resolve) => {
    const tf = path.join(outDir, 'J' + j.level + '.task.json');
    const rf = path.join(outDir, 'J' + j.level + '.result.json');
    fs.writeFileSync(tf, JSON.stringify({ level: j.level, levelName: j.name, neu: j.neu, old: j.old, testsFile: path.join(__dirname, j.testsFile) }));
    const child = spawn(process.execPath, [path.join(__dirname, 'tactics_worker.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write('  ' + d));
    child.stderr.on('data', (d) => { err += d; });
    const to = setTimeout(() => child.kill('SIGKILL'), 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(to);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
      if (!r) r = { levelName: j.name, error: 'exit=' + code + ' ' + err.slice(0, 300) };
      resolve(r);
    });
  });
}

(async () => {
  const results = await Promise.all(JOBS.map(runJob));
  fs.writeFileSync(path.join(__dirname, 'hard2_report.json'), JSON.stringify(results, null, 1));
  const lines = [];
  lines.push('# 最终区分测验（定制题集：基线引擎答错过的题）');
  lines.push('');
  lines.push('- 高手档题集 = 800ms 预筛答错的 ' + JOBS[0].nTests + ' 题; 大师档题集 = 2500ms 预筛答错的 ' + JOBS[1].nTests + ' 题');
  lines.push('- 局面来源: 随机/混合走法产生的混乱中局; 参考解 3000ms; 固定种子; 出招流程与生产一致');
  lines.push('');
  lines.push('| 档位 | 命中率(新) | 命中率(基线) | 平均得分(新) | 平均得分(基线) | 平均物质增益差 | 判定 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    if (r.error) { lines.push('| ' + r.levelName + ' | ERROR: ' + r.error + ' |'); continue; }
    const verdict = r.neu.hitRate > r.old.hitRate ? '提升' : (r.neu.hitRate === r.old.hitRate ? '持平' : '下降');
    lines.push('| ' + r.levelName +
      ' | ' + (r.neu.hitRate * 100).toFixed(1) + '% | ' + (r.old.hitRate * 100).toFixed(1) + '%' +
      ' | ' + (r.neu.score * 100).toFixed(1) + '% | ' + (r.old.score * 100).toFixed(1) + '%' +
      ' | ' + (r.neu.avgGain - r.old.avgGain).toFixed(0) + ' | ' + verdict + ' |');
  }
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'hard2_report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });