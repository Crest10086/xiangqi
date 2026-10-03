/* bench/nodes_bench.js — 用"思考量"(节点数)做强度旋钮的可行性验证
 * 同一 66 题、同一参考评估(3000ms)、固定种子；只变 go nodes 上限（movetime 仅作兜底）
 * 目的: 节点数是否比思考时间更能稳定拉开档位、且跨设备可复现
 * 输出: bench/nodes_report.md + .json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIGS = [
  { label: '2k 节点', kind: 'pf', movetime: 20000, book: false, nodes: 2000 },
  { label: '8k 节点', kind: 'pf', movetime: 20000, book: false, nodes: 8000 },
  { label: '30k 节点', kind: 'pf', movetime: 20000, book: false, nodes: 30000 },
  { label: '120k 节点', kind: 'pf', movetime: 20000, book: false, nodes: 120000 },
  { label: '500k 节点', kind: 'pf', movetime: 20000, book: false, nodes: 500000 },
  { label: '不限(5000ms兜底)', kind: 'pf', movetime: 5000, book: false },
];
const testsFile = path.join(__dirname, 'quality_tests.json');
const total = JSON.parse(fs.readFileSync(testsFile, 'utf8')).tests.length;
const PARTS = 3;
const outDir = path.join(__dirname, 'nodes_out');
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
    const to2 = setTimeout(() => child.kill('SIGKILL'), 40 * 60 * 1000);
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
  fs.writeFileSync(path.join(__dirname, 'nodes_report.json'), JSON.stringify(rows, null, 1));
  const lines = [];
  lines.push('# 思考量(节点数)作为强度旋钮的可行性（同一 66 题、参考评估 3000ms、固定种子）');
  lines.push('');
  lines.push('| 配置 | 质量得分 | 平均损失cp | 大失误数 |');
  lines.push('|---|---|---|---|');
  for (const r of rows) lines.push('| ' + r.label + ' | ' + (r.s / r.n * 100).toFixed(1) + '% | ' + (r.l / r.n).toFixed(0) + ' | ' + r.b + ' |');
  const rep = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'nodes_report.md'), rep);
  console.log('\n' + rep);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });
