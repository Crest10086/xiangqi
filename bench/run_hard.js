/* bench/run_hard.js — 用区分度题集测 高手/大师 档 (新 vs 基线)
 * 用法: node run_hard.js
 * 输出: bench/hard_report.md + bench/hard_report.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LEVELS = [
  { name: '高手', neu: { kind: 'pf', movetime: 1800, book: true }, old: { kind: 'pf', movetime: 800, book: false } },
  { name: '大师', neu: { kind: 'pf', movetime: 6000, book: true }, old: { kind: 'pf', movetime: 2500, book: false } },
];
const testsFile = path.join(__dirname, 'hard.json');
if (!fs.existsSync(testsFile)) { console.error('hard.json 不存在, 先跑 gen_hard.js'); process.exit(1); }
const tests = JSON.parse(fs.readFileSync(testsFile, 'utf8')).tests;
console.log('hard tests =', tests.length);

const outDir = path.join(__dirname, 'hard_out');
if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
fs.mkdirSync(outDir, { recursive: true });

function runLevel(li) {
  const L = LEVELS[li];
  return new Promise((resolve) => {
    const tf = path.join(outDir, 'H' + li + '.task.json');
    const rf = path.join(outDir, 'H' + li + '.result.json');
    fs.writeFileSync(tf, JSON.stringify({ level: li + 3, levelName: L.name, neu: L.neu, old: L.old, testsFile }));
    const child = spawn(process.execPath, [path.join(__dirname, 'tactics_worker.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write('  ' + d));
    child.stderr.on('data', (d) => { err += d; });
    const to = setTimeout(() => child.kill('SIGKILL'), 25 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(to);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
      if (!r) r = { levelName: L.name, error: 'exit=' + code + ' ' + err.slice(0, 300) };
      resolve(r);
    });
  });
}

(async () => {
  const results = await Promise.all([0, 1].map(runLevel));
  results.sort((a, b) => a.level - b.level);
  fs.writeFileSync(path.join(__dirname, 'hard_report.json'), JSON.stringify(results, null, 1));
  const lines = [];
  lines.push('# 区分度测验: 高手/大师 档（题集已剔除"200ms也能答对"的无区分度题）');
  lines.push('');
  lines.push('- 题集: ' + tests.length + ' 题（全部为 200ms 预筛答错的题; 参考解 3000ms; 开局分支多样: ' +
    [...new Set(tests.map(t => t.src.split(' ')[0]))].join('/') + '）');
  lines.push('');
  lines.push('| 档位 | 平均得分(新) | 平均得分(旧) | 命中率(新) | 命中率(旧) | 平均物质增益差 | 判定 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    if (r.error) { lines.push('| ' + r.levelName + ' | ERROR: ' + r.error + ' |'); continue; }
    const verdict = r.neu.hitRate > r.old.hitRate ? '提升' : (r.neu.hitRate === r.old.hitRate ? '持平' : '下降');
    lines.push('| ' + r.levelName +
      ' | ' + (r.neu.score * 100).toFixed(1) + '% | ' + (r.old.score * 100).toFixed(1) + '%' +
      ' | ' + (r.neu.hitRate * 100).toFixed(1) + '% | ' + (r.old.hitRate * 100).toFixed(1) + '%' +
      ' | ' + (r.neu.avgGain - r.old.avgGain).toFixed(0) + ' | ' + verdict + ' |');
  }
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'hard_report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });