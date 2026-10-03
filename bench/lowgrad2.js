/* bench/lowgrad2.js — 测引擎原生强度旋钮 Skill Level / UCI_Elo 能否拉开档位
 * 所有配置同一 movetime(500ms)、同一题集、同一参考评估 -> 只变强度选项
 * 输出: bench/lowgrad2_report.md + .json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS = [
  { label: '满强度 500ms', kind: 'pf', movetime: 500, book: false },
  { label: 'Skill Level 0', kind: 'pf', movetime: 500, book: false, uciOptions: [{ name: 'Skill Level', value: 0 }] },
  { label: 'Skill Level 5', kind: 'pf', movetime: 500, book: false, uciOptions: [{ name: 'Skill Level', value: 5 }] },
  { label: 'Skill Level 10', kind: 'pf', movetime: 500, book: false, uciOptions: [{ name: 'Skill Level', value: 10 }] },
  { label: 'UCI_Elo 1400', kind: 'pf', movetime: 500, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1400 }] },
  { label: 'UCI_Elo 1800', kind: 'pf', movetime: 500, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1800 }] },
  { label: 'UCI_Elo 2400', kind: 'pf', movetime: 500, book: false, uciOptions: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 2400 }] },
];
const testsFile = path.join(__dirname, 'quality_tests.json');
const total = JSON.parse(fs.readFileSync(testsFile, 'utf8')).tests.length;
const PARTS = 3;
const outDir = path.join(__dirname, 'lowgrad2_out');
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
  fs.writeFileSync(path.join(__dirname, 'lowgrad2_report.json'), JSON.stringify(rows, null, 1));
  const lines = [];
  lines.push('# 引擎原生强度旋钮测试（同一 500ms、同一 66 题、同一参考评估）');
  lines.push('');
  lines.push('| 配置 | 质量得分 | 平均损失cp | 大失误数 |');
  lines.push('|---|---|---|---|');
  for (const r of rows) lines.push('| ' + r.label + ' | ' + (r.s / r.n * 100).toFixed(1) + '% | ' + (r.l / r.n).toFixed(0) + ' | ' + r.b + ' |');
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'lowgrad2_report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });