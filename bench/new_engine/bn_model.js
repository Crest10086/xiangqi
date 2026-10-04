/* new_engine/bn_model.js — TEST-ONLY for card t_f844043c.
 * Builds the "bounded version" of the cap/p conversion formula (acceptance criterion 3) and checks
 * it against the measured BN_* means.
 *
 * The unbounded model from t_3fff5a44 was:
 *     mean(NORMAL) = (1-p)·(20.5 + 0.205·cap) + p·225
 * The bounded rule replaces the p·225 term: when the random branch fires it plays a move whose OWN
 * degradation is <= cap, so its cost is a measured BND(cap) instead of the unbounded 225 cp, and it
 * only applies where the judge actually found such a move (positions where the accept-set is empty
 * degenerate to the cap choice). Hence:
 *     mean_BN(class, cap, p) = capBranch(class, cap) + p·(1-q)·(BND(class, cap) - capBranch(class, cap))
 * where capBranch = measured mean of the cap branch (hit=cap/above/bmiss), BND = measured mean of the
 * bounded-random branch (hit=brand), q = share of draws whose accept-set was empty.
 *
 * Usage: ANALYSIS=bn_analysis.json node bn_model.js
 */
const fs = require('fs');
const path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', process.env.ANALYSIS || 'bn_analysis.json'), 'utf8'));
const posDefs = JSON.parse(fs.readFileSync(path.join(__dirname, 'level_positions.json'), 'utf8'));
const groupOf = {}; for (const p of posDefs) groupOf[p.id] = p.group;
const HARD = new Set();
for (const p of posDefs) {
  for (const r of A.rounds) {
    const d = A.all.AM0 && A.all.AM0.perRound[r] && A.all.AM0.perRound[r].detail.find(x => x.pid === p.id);
    if (d && +d.gap >= 500) HARD.add(p.id);
  }
}
const cls = (pid) => groupOf[pid] === 'opening' ? 'OPENING' : (HARD.has(pid) ? 'HARD' : 'NORMAL');
const ROUNDS = A.rounds;
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const f = (x) => x === null ? 'n/a' : (Math.round(x * 10) / 10);

const CFGS = Object.keys(A.all);
console.log('HARD midgame: ' + JSON.stringify([...HARD]));

/* ---- 1) branch decomposition per config per class ---- */
const branch = {};   // cfg -> class -> {cap:[], brand:[], accept:[]}
for (const cfg of CFGS) {
  if (!/^(CAP_|AC_|BN_)/.test(cfg)) continue;
  branch[cfg] = { HARD: { cap: [], brand: [], accept: [] }, NORMAL: { cap: [], brand: [], accept: [] }, OPENING: { cap: [], brand: [], accept: [] } };
  for (const r of ROUNDS) {
    for (const d of A.all[cfg].perRound[r].detail) {
      const c = cls(d.pid);
      const ag = String(d.probs || '').match(/,accept=(\d+)/);
      if (ag) branch[cfg][c].accept.push(+ag[1]);
      if (d.hit === 'brand') branch[cfg][c].brand.push(d.loss);
      else branch[cfg][c].cap.push(d.loss);
    }
  }
}
console.log('\n=== branch means (cap branch vs bounded/unbounded random branch), cp ===');
console.log('cfg      class    nCap  capMean   nBrand brandMean  acceptMean accept=0share  overallMean');
for (const cfg of CFGS) {
  if (!branch[cfg]) continue;
  for (const c of ['HARD', 'NORMAL', 'OPENING']) {
    const b = branch[cfg][c];
    if (!b.cap.length && !b.brand.length) continue;
    const all = b.cap.concat(b.brand);
    const zeroAcc = b.accept.length ? (b.accept.filter(x => x === 0).length / b.accept.length) : null;
    console.log(cfg.padEnd(8) + c.padEnd(8) + String(b.cap.length).padStart(5) + ' ' + String(f(mean(b.cap))).padStart(8) +
      ' ' + String(b.brand.length).padStart(6) + ' ' + String(f(mean(b.brand))).padStart(9) +
      ' ' + String(b.accept.length ? f(mean(b.accept)) : 'n/a').padStart(11) + ' ' +
      String(zeroAcc === null ? 'n/a' : f(zeroAcc * 100) + '%').padStart(13) + ' ' + String(f(mean(all))).padStart(12));
  }
}

/* ---- 2) the bounded conversion formula, and its error against the measured means ---- */
const capLine = {};   // class -> {intercept, slope} from the two measured CAP_* points
for (const c of ['HARD', 'NORMAL', 'OPENING']) {
  const p60 = mean(branch.CAP_AD[c].cap), p200 = mean(branch.CAP_AM[c].cap);
  if (p60 === null || p200 === null) continue;
  const slope = (p200 - p60) / (200 - 60);
  capLine[c] = { intercept: p60 - slope * 60, slope: slope, p60: p60, p200: p200 };
}
console.log('\n=== cap-branch line fitted from THIS run (capBranch = intercept + slope*cap) ===');
for (const c of Object.keys(capLine)) {
  const L = capLine[c];
  console.log(c.padEnd(8) + ' capBranch(cap) = ' + f(L.intercept) + ' + ' + f(L.slope) + '*cap' +
    '   (cap60=' + f(L.p60) + ', cap200=' + f(L.p200) + ')');
}

console.log('\n=== bounded model check: predicted vs measured ===');
console.log('cfg      cap   p     class    q(empty)  BND       predicted  measured  error');
const taskCfgs = {};
try {
  for (const tf of ['task_bn_r1.json', 'task_bn_r2.json', 'task_bn_r3.json']) {
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, tf), 'utf8'));
    for (const c of t.configs) taskCfgs[c.id] = c;
  }
} catch (e) { /* fall back to the ruleDiag values recorded in the log */ }
for (const cfg of CFGS) {
  if (!/^BN_/.test(cfg)) continue;
  const rd = A.ruleDiag[cfg] || {};
  const cap = rd.cap, p = rd.p;
  for (const c of ['HARD', 'NORMAL', 'OPENING']) {
    const b = branch[cfg][c];
    if (!b.brand.length && !b.cap.length) continue;
    const L = capLine[c];
    const zeroAcc = b.accept.length ? (b.accept.filter(x => x === 0).length / b.accept.length) : 0;
    const capM = mean(b.cap);
    const bndM = mean(b.brand);
    const measured = mean(b.cap.concat(b.brand));
    // predicted: use the FITTED cap line when available (that is the testable formula), else the
    // measured cap branch of the same config.
    const capPred = L ? (L.intercept + L.slope * cap) : capM;
    const pred = capPred + p * (1 - zeroAcc) * ((bndM === null ? capPred : bndM) - capPred);
    console.log(cfg.padEnd(8) + String(cap).padStart(5) + ' ' + String(p).padStart(5) + ' ' + c.padEnd(8) +
      ' ' + String(f(zeroAcc)).padStart(9) + ' ' + String(f(bndM)).padStart(8) +
      ' ' + String(f(pred)).padStart(10) + ' ' + String(f(measured)).padStart(9) +
      ' ' + String(f(pred - measured)).padStart(7));
  }
}

/* ---- 3) what the bounded model buys: unbounded 225 cp term vs the measured bounded term ---- */
console.log('\n=== the p-term, bounded vs unbounded (the whole point of the card) ===');
for (const cfg of CFGS) {
  if (!/^BN_/.test(cfg)) continue;
  const rd = A.ruleDiag[cfg] || {};
  for (const c of ['HARD', 'NORMAL', 'OPENING']) {
    const b = branch[cfg][c];
    if (!b.brand.length) continue;
    const bnd = mean(b.brand);
    const capM = mean(b.cap);
    const bl = b.brand.filter(x => x > 300).length / b.brand.length;
    console.log(cfg.padEnd(8) + c.padEnd(8) + ' bounded branch mean=' + String(f(bnd)).padStart(7) +
      ' blunderRate(>300cp)=' + String((bl * 100).toFixed(0) + '%').padStart(5) +
      '   vs the unbounded rand branch measured on t_3fff5a44: mean=225-249, blunderRate=35%' +
      '   | cap branch mean=' + String(f(capM)).padStart(7));
  }
}
