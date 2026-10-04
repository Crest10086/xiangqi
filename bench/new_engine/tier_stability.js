/* new_engine/tier_stability.js — round-to-round stability of the calibration (card t_a8096ea3).
 * Run: node tier_stability.js <analysisA.json> <analysisB.json>
 * The same cfg set was run in two independent rounds (different seedSalt). If a cfg's mean loss
 * moves more than the noise floor between rounds, no cap/p value derived from it is trustworthy.
 */
const fs = require('fs');
const A = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const B = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const IDS = Object.keys(A.perPosition).filter(p => B.perPosition[p]);
console.log('round A=' + A.logs + ' round B=' + B.logs + ' common positions=' + IDS.length);

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('\ncfg\tA mean\tB mean\tdelta\tA hitShare\tB hitShare\tper-position |delta| >20cp');
for (const cfg of Object.keys(A.perCfg)) {
  const da = [], db = [];
  for (const pid of IDS) {
    const va = (A.perPosition[pid].lossByCfg || {})[cfg];
    const vb = (B.perPosition[pid].lossByCfg || {})[cfg];
    if (va === undefined || vb === undefined || va === null || vb === null) continue;
    da.push(va); db.push(vb);
  }
  if (!da.length) continue;
  let big = 0;
  for (let i = 0; i < da.length; i++) if (Math.abs(da[i] - db[i]) > 20) big++;
  const ma = mean(da), mb = mean(db);
  console.log([cfg, ma.toFixed(1), mb.toFixed(1), (mb - ma).toFixed(1),
    A.perCfg[cfg].hitShare, B.perCfg[cfg] ? B.perCfg[cfg].hitShare : '-',
    big + '/' + da.length].join('\t'));
}

/* the noise floor: two configs that both always take the best candidate at their own budget */
console.log('\nnoise floor reference: CAP0 (best candidate at the tier budget) and ANCH (best candidate at 2000 ms)');
for (const cfg of ['CAP0', 'ANCH']) {
  const da = [], db = [];
  for (const pid of IDS) {
    const va = (A.perPosition[pid].lossByCfg || {})[cfg];
    const vb = (B.perPosition[pid].lossByCfg || {})[cfg];
    if (va === null || vb === null || va === undefined || vb === undefined) continue;
    da.push(va); db.push(vb);
  }
  if (da.length) console.log('  ' + cfg + ' A=' + mean(da).toFixed(1) + ' B=' + mean(db).toFixed(1) +
    ' per-position sd=' + Math.sqrt(mean(da.map(x => x * x)) - mean(da) ** 2).toFixed(1));
}
