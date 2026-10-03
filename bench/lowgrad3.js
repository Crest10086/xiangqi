/* bench/lowgrad3.js — 在真实生产思考时间下调 UCI_Elo 间距，找能让业余/进阶真正拉开的组合
 * 组A = 业余档(50ms) 组B = 进阶档(150ms)；同一 66 题、同一参考评估(3000ms)、固定种子
 * 输出: bench/lowgrad3_report.md + .json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ELO = (v) => [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: v }];
const CONFIGS = [
  { label: '业余档50ms Elo1200', kind: 'pf', movetime: 50, book: false, uciOptions: ELO(1200) },
  { label: '业余档50ms Elo1400', kind: 'pf', movetime: 50, book: false, uciOptions: ELO(1400) },
  { label: '业余档50ms Elo1600', kind: 'pf', movetime: 50, book: false, uciOptions: ELO(1600) },
  { label: '进阶档150ms Elo1600', kind: 'pf', movetime: 150, book: false, uciOptions: ELO(1600) },
  { label: '进阶档150ms Elo1800', kind: 'pf', movetime: 150, book: false, uciOptions: ELO(1800) },
  { label: '进阶档150ms Elo2000', kind: 'pf', movetime: 150, book: false, uciOptions: ELO(2000) },
  { label: '进阶档150ms Elo2200', kind: 'pf', movetime: 150, book: false, uciOptions: ELO(2200) },
];
const testsFile = path.join(__dirname, 'quality_tests.json');
const total = JSON.parse(fs.readFileSync(testsFile, 'utf8')).tests.length;
const PARTS = 3;
const outDir = path.join(__dirname, 'lowgrad3_out');
if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
fs.mkdirSync(outDir, { recursive: true });

function runPart(i) {
  return new Promise((resolve) => {
    const from = Math.floor(i * total / PARTS), to = Math.floor((i + 1) * total / PARTS);
    const tf = path.join(outDir, 'P' + i + '.task.json'), rf = path.join(outDir, 'P' + i + '.result.json');
    fs.writeFileSync(tf, JSON.stringify({ testsFile, testsSlice: [from, to], configs: CONFIGS }));
    const child = spawn(process.execPath, [path.join(__dirname, 'lowgrad_worker.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => process.stdout.write('  [' + i + '] ' + d));
    let err = ''; child.stderr.on('data', (d) => { err += d; });
    const to2 = setTimeout(() => child.kill('SIGKILL'), 35 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(to2);
      let r = null; try { r = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
      resolve(r || { error: 'part' + i + ' exit=' + code + ' ' + err.slice(0, 200) });
    });
  });
}

(async () => {
  const parts = await Promise.all(Array.from({ length: PARTS }, (_, i) => runPart(i)));
  const agg = {};
  for (const p of parts) {
    if (!Array.isArray(p)) { console.error('PART FAIL', p); continue; }
    for (const c of p) {
      const a = agg[c.label] = agg[c.label] || { label: c.label, n: 0, s: 0, l: 0, b: 0 };
      a.n += c.n; a.s += c.score * c.n; a.l += c.avgLoss * c.n; a.b += c.bigMistakes;
    }
  }
  const rows = CONFIGS.map(c => agg[c.label]).filter(Boolean);
  fs.writeFileSync(path.join(__dirname, 'lowgrad3_report.json'), JSON.stringify(rows, null, 1));
  const lines = [];
  lines.push('# 业余/进阶两档的 Elo 间距调参（各自真实思考时间，同一 66 题、参考评估 3000ms）');
  lines.push('');
  lines.push('| 配置 | 质量得分 | 平均损失cp | 大失误数 |');
  lines.push('|---|---|---|---|');
  for (const r of rows) lines.push('| ' + r.label + ' | ' + (r.s / r.n * 100).toFixed(1) + '% | ' + (r.l / r.n).toFixed(0) + ' | ' + r.b + ' |');
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'lowgrad3_report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });