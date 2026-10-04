/* instability_by_cfg.js — TEST-ONLY for card t_ef6e93b8 */
const fs = require('fs');
const path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', 'levels_analysis.json'), 'utf8'));
const per = {};
for (const k of Object.keys(A.variance)) {
  const arr = A.variance[k];
  const cfg = k.split('|')[1];
  const moves = new Set(arr.map(a => a.move));
  per[cfg] = per[cfg] || { total: 0, unstable: 0 };
  per[cfg].total++;
  if (moves.size > 1) per[cfg].unstable++;
}
console.log('cross-round move instability (3 rounds):');
for (const c of Object.keys(per)) console.log(c, JSON.stringify(per[c]));

// per-round mean loss table for the report
for (const g of ['opening', 'midgame']) {
  console.log('--- mean loss ' + g + ' ---');
  for (const cfg of ['AM', 'AD', 'EX', 'GM', 'S1T300']) {
    const e = A.perGroup[g][cfg];
    console.log(cfg, 'overall', JSON.stringify(e.overall), 'rounds', [1, 2, 3].map(r => e.perRound[r] ? e.perRound[r].stat.mean : 'NA').join(','));
  }
}
