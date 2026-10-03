/* bench/lowgrad.js — 低区间梯度测量: 候选低档参数 vs 基线内置引擎的质量对比
 * 目的: 判断"把低档改成皮卡鱼浅搜索"是否 (a) 仍比基线内置引擎更强 (b) 档间梯度真实存在
 * 输出: bench/lowgrad_report.md + lowgrad_report.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS = [
  { label: '基线业余 内置d4', kind: 'builtin', depth: 4, qDepth: 2, maxNodes: 25000, randomness: 0, book: false },
  { label: '候选 皮卡鱼50ms', kind: 'pf', movetime: 50, book: true },
  { label: '候选 皮卡鱼100ms', kind: 'pf', movetime: 100, book: true },
  { label: '基线进阶 内置d7', kind: 'builtin', depth: 7, qDepth: 3, maxNodes: 400000, randomness: 0, book: false },
  { label: '候选 皮卡鱼200ms', kind: 'pf', movetime: 200, book: true },
  { label: '当前进阶 皮卡鱼600ms', kind: 'pf', movetime: 600, book: true },
];
const testsFile = path.join(__dirname, 'quality_tests.json');
const total = JSON.parse(fs.readFileSync(testsFile, 'utf8')).tests.length;
const PARTS = 3;
const outDir = path.join(__dirname, 'lowgrad_out');
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
    const to2 = setTimeout(() => child.kill('SIGKILL'), 30 * 60 * 1000);
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
  fs.writeFileSync(path.join(__dirname, 'lowgrad_report.json'), JSON.stringify(rows, null, 1));
  const lines = [];
  lines.push('# 低区间梯度测量（同一 66 题, 同一参考评估3000ms, 固定种子）');
  lines.push('');
  lines.push('| 配置 | 质量得分 | 平均损失cp | 大失误数 |');
  lines.push('|---|---|---|---|');
  for (const r of rows) lines.push('| ' + r.label + ' | ' + (r.s / r.n * 100).toFixed(1) + '% | ' + (r.l / r.n).toFixed(0) + ' | ' + r.b + ' |');
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'lowgrad_report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });