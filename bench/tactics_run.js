/* bench/tactics_run.js — 战术测验编排器: 5 档并行 + 汇总报告
 * 用法: node tactics_run.js [--parallel 5]
 * 输出: bench/tactics_report.md + bench/tactics_report.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const PARALLEL = arg('--parallel', 5);

// 与 run.js 完全相同的档位配置定义
const LEVELS = [
  { name: '入门', neu: { kind: 'builtin', depth: 2, qDepth: 0, maxNodes: 1500, randomness: 45, book: true }, old: { kind: 'builtin', depth: 2, qDepth: 0, maxNodes: 1500, randomness: 45, book: false } },
  { name: '业余', neu: { kind: 'pf', movetime: 200, book: true }, old: { kind: 'builtin', depth: 4, qDepth: 2, maxNodes: 25000, randomness: 0, book: false } },
  { name: '进阶', neu: { kind: 'pf', movetime: 600, book: true }, old: { kind: 'builtin', depth: 7, qDepth: 3, maxNodes: 400000, randomness: 0, book: false } },
  { name: '高手', neu: { kind: 'pf', movetime: 1800, book: true }, old: { kind: 'pf', movetime: 800, book: false } },
  { name: '大师', neu: { kind: 'pf', movetime: 6000, book: true }, old: { kind: 'pf', movetime: 2500, book: false } },
];

const testsFile = path.join(__dirname, 'tactics.json');
if (!fs.existsSync(testsFile)) { console.error('tactics.json 不存在, 先跑 tactics_gen.js'); process.exit(1); }
const tests = JSON.parse(fs.readFileSync(testsFile, 'utf8')).tests;
const tacticalN = tests.filter(t => t.isTactical).length;
console.log('tests=' + tests.length + ' tactical=' + tacticalN + ' parallel=' + PARALLEL);

const outDir = path.join(__dirname, 'tactics_out');
if (fs.existsSync(outDir)) for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
fs.mkdirSync(outDir, { recursive: true });

function runLevel(li) {
  return new Promise((resolve) => {
    const tf = path.join(outDir, 'L' + li + '.task.json');
    const rf = path.join(outDir, 'L' + li + '.result.json');
    fs.writeFileSync(tf, JSON.stringify({ level: li, levelName: LEVELS[li].name, neu: LEVELS[li].neu, old: LEVELS[li].old, testsFile }));
    const child = spawn(process.execPath, [path.join(__dirname, 'tactics_worker.js'), tf, rf], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write('  ' + d));
    child.stderr.on('data', (d) => { err += d; });
    const to = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
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
  for (let w = 0; w < Math.min(PARALLEL, LEVELS.length); w++) {
    workers.push((async () => {
      while (idx < LEVELS.length) { const my = idx++; results.push(await runLevel(my)); }
    })());
  }
  await Promise.all(workers);
  results.sort((a, b) => a.level - b.level);
  fs.writeFileSync(path.join(__dirname, 'tactics_report.json'), JSON.stringify(results, null, 1));

  const lines = [];
  lines.push('# 战术测验基准: 新版 vs 基线（同一固定测验集）');
  lines.push('');
  lines.push('- 测验集: ' + tests.length + ' 个固定中局局面（其中战术题 ' + tacticalN + ' 个：参考着法带来 >=150cp 物质得子或评估 >=+400）');
  lines.push('- 参考解: 皮卡鱼 8000ms 最佳着法; 命中判定: 落子后局面与参考着法落子后局面一致(等价着法视为命中)');
  lines.push('- 评分: 命中=1.0; 否则按走方物质损失分级 0.8/0.5/0.2/0; 随机种子固定; 出招流程与生产一致(先查开局库)');
  lines.push('');
  lines.push('| 档位 | 平均得分(新) | 平均得分(旧) | 最佳着法命中率(新) | 命中率(旧) | 战术题命中率(新) | 战术题命中率(旧) | 判定 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    if (r.error) { lines.push('| ' + r.levelName + ' | ERROR: ' + r.error + ' |'); continue; }
    const better = r.neu.score > r.old.score ? '提升' : (r.neu.score === r.old.score ? '持平' : '下降');
    lines.push('| ' + r.levelName +
      ' | ' + (r.neu.score * 100).toFixed(1) + '% | ' + (r.old.score * 100).toFixed(1) + '%' +
      ' | ' + (r.neu.hitRate * 100).toFixed(1) + '% | ' + (r.old.hitRate * 100).toFixed(1) + '%' +
      ' | ' + (r.neu.tacticalHitRate === null ? '-' : (r.neu.tacticalHitRate * 100).toFixed(1) + '%') +
      ' | ' + (r.old.tacticalHitRate === null ? '-' : (r.old.tacticalHitRate * 100).toFixed(1) + '%') +
      ' | ' + better + ' |');
  }
  lines.push('');
  lines.push('说明: 平均得分含"次优但不丢子"的部分分(0.8), 命中率与战术题命中率是更硬的强度指标。');
  const report = lines.join('\n');
  fs.writeFileSync(path.join(__dirname, 'tactics_report.md'), report);
  console.log('\n' + report);
})().catch((e) => { console.error('RUN_FAIL', e); process.exit(1); });