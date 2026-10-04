/* new_engine/tier_fit.js — turn the calibration logs into the five tier parameter sets
 * (card t_a8096ea3). Offline only: it reads tier_analysis.json (produced by tier_verify.js) and
 * writes tier_tiers.json + a printed decision table. No engine search, so it is cheap to re-run
 * with different targets.
 *
 * Model (deliberately simple, and every number in it is measured):
 *   For a recorded position we know its candidate gap list (the fixed-budget pool the harness
 *   logged). tier_rules.expectedGap(cfg, gaps) gives the pool degradation E[gap] that ANY cfg
 *   would produce there — including cfgs we never ran. The measured loss of the cfgs we DID run is
 *   then regressed against their predicted E[gap], which gives the conversion "E[gap] cp -> real
 *   loss cp" for this position set. Predicted loss for an unseen cfg = that conversion applied to
 *   its expectedGap. This is why one calibration round is enough to place cap/p points we did not
 *   run; the printed residuals show how well the model actually fits.
 *
 * Position classes are handled separately (openings have a much steeper loss-per-cp slope and 少子形
 * positions have no candidate inside any sane cap), and the per-class numbers are what the tier
 * cfgs carry (cap / openingCap / hardCap).
 */
const fs = require('fs');
const path = require('path');
const T = require('./tier_rules.js');

const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', 'tier_analysis.json'), 'utf8'));
const POS = A.perPosition;
const POS_IDS = Object.keys(POS);
const BAND = T.DEFAULT_MISTAKE_BAND;
const CFG_ORDER = A.cfgOrder || Object.keys(A.perCfg);   // tier_verify.js writes cfgOrder; older analyses did not

const candsOf = (gaps) => gaps.map((g, i) => ({ slot: i + 1, score: -g, move: 'mv' + (i + 1), gap: g }));

/* collect measured (cfg, position) points with their predicted E[gap] */
function points() {
  const out = [];
  for (const pid of POS_IDS) {
    const p = POS[pid];
    if (!p.poolGaps || !p.poolGaps.length) continue;
    const cands = candsOf(p.poolGaps);
    for (const cfgId of CFG_ORDER) {
      const cfg = A.perCfg[cfgId] && A.perCfg[cfgId].cfg;
      if (!cfg || cfg.rule !== 'tier') continue;
      if (cfg.movetime !== 300 || cfg.hash !== 64 || cfg.multipv !== 8) continue;   // only the fixed tier budget is comparable
      const loss = (p.lossByCfg || p.loss || {})[cfgId !== undefined ? cfgId : -1];
      if (loss === null || loss === undefined) continue;
      out.push({
        pid: pid, group: p.group, cfgId: cfgId, cfg: cfg, loss: loss,
        pred: T.expectedGap(cfg, cands, p.group),
        cls: T.classify(cfg, p.group, cands),
      });
    }
  }
  return out;
}

/* least squares on (pred -> loss) per class; also reports residuals */
function fit(pts) {
  const res = {};
  for (const cls of ['opening', 'normal', 'hard']) {
    const s = pts.filter(x => x.cls === cls);
    if (s.length < 3) { res[cls] = { n: s.length, slope: null, intercept: null }; continue; }
    const n = s.length;
    const sx = s.reduce((a, x) => a + x.pred, 0), sy = s.reduce((a, x) => a + x.loss, 0);
    const sxx = s.reduce((a, x) => a + x.pred * x.pred, 0), sxy = s.reduce((a, x) => a + x.pred * x.loss, 0);
    const den = n * sxx - sx * sx;
    const slope = den ? (n * sxy - sx * sy) / den : 0;
    const intercept = (sy - slope * sx) / n;
    const resid = s.map(x => x.loss - (intercept + slope * x.pred));
    const rmse = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / n);
    const sdLoss = Math.sqrt(s.reduce((a, x) => a + (x.loss - sy / n) ** 2, 0) / n);
    res[cls] = { n: n, slope: +slope.toFixed(4), intercept: +intercept.toFixed(1), rmse: +rmse.toFixed(1), sdLoss: +sdLoss.toFixed(1), meanLoss: +(sy / n).toFixed(1), meanPred: +(sx / n).toFixed(1) };
  }
  return res;
}

/* predict the mean loss of an arbitrary cfg over the recorded position set */
function predict(cfg, coefs) {
  let sum = 0, n = 0;
  const perClass = { opening: [], normal: [], hard: [] };
  for (const pid of POS_IDS) {
    const p = POS[pid];
    if (!p.poolGaps || !p.poolGaps.length) continue;
    const cands = candsOf(p.poolGaps);
    const cls = T.classify(cfg, p.group, cands);
    const c = coefs[cls];
    if (c.slope === null) continue;
    const e = T.expectedGap(cfg, cands, p.group);
    const loss = c.intercept + c.slope * e;
    perClass[cls].push(loss);
    sum += loss; n++;
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { meanLoss: mean([].concat(perClass.opening, perClass.normal, perClass.hard)),
           opening: mean(perClass.opening), normal: mean(perClass.normal), hard: mean(perClass.hard) };
}

const pts = points();
const coefs = fit(pts);
console.log('measured points=' + pts.length + ' positions=' + POS_IDS.length);
console.log('\nfit per class (loss = intercept + slope * predicted E[gap]):');
for (const cls of ['opening', 'normal', 'hard']) {
  const c = coefs[cls];
  console.log('  ' + cls.padEnd(8) + ' n=' + c.n + ' slope=' + c.slope + ' intercept=' + c.intercept +
    ' rmse=' + c.rmse + ' sdLoss=' + c.sdLoss + ' (model explains ' + (c.sdLoss ? (1 - c.rmse / c.sdLoss).toFixed(2) : '-') + ' of the spread)');
}

/* candidate tier points, all at the SAME movetime/Hash (contract) */
function tierCfg(name, cap, p, extra) {
  return Object.assign({ id: name, rule: 'tier', cap: cap, p: p, mistakeBand: BAND,
    openingCap: cap, hardCap: 0, multipv: 8, movetime: 300, hash: 64 }, extra || {});
}
const probes = [];
for (const cap of [0, 25, 50, 80, 120, 160, 220]) probes.push(tierCfg('cap' + cap, cap, 0));
for (const p of [0.1, 0.2, 0.3, 0.5]) probes.push(tierCfg('cap80_p' + p, 80, p));
for (const band of [100, 300, 600]) probes.push(tierCfg('cap80_p30_band' + band, 80, 0.3, { mistakeBand: band }));
for (const band of [100, 300, 600]) probes.push(tierCfg('cap50_p30_band' + band, 50, 0.3, { mistakeBand: band }));

console.log('\npredicted mean loss (cp given up vs the ANCHOR best move; higher = weaker):');
console.log(['probe', 'cap', 'p', 'band', 'all', 'opening', 'normal', 'hard'].join('\t'));
const preds = {};
for (const cfg of probes) {
  const q = predict(cfg, coefs);
  preds[cfg.id] = q;
  console.log([cfg.id, cfg.cap, cfg.p, cfg.mistakeBand,
    q.meanLoss === null ? '-' : q.meanLoss.toFixed(1),
    q.opening === null ? '-' : q.opening.toFixed(1),
    q.normal === null ? '-' : q.normal.toFixed(1),
    q.hard === null ? '-' : q.hard.toFixed(1)].join('\t'));
}

/* measured residuals of the cfgs we actually ran, as a sanity check on the model */
console.log('\nmeasured vs predicted for the ran cfgs (mean over positions):');
console.log(['cfg', 'measured', 'predicted', 'delta'].join('\t'));
for (const cfgId of CFG_ORDER) {
  const cfg = A.perCfg[cfgId] && A.perCfg[cfgId].cfg;
  if (!cfg || cfg.rule !== 'tier') continue;
  const m = A.perCfg[cfgId].costMean;
  const q = predict(cfg, coefs);
  console.log([cfgId, m === null ? '-' : m.toFixed(1), q.meanLoss === null ? '-' : q.meanLoss.toFixed(1),
    (m !== null && q.meanLoss !== null) ? (m - q.meanLoss).toFixed(1) : '-'].join('\t'));
}

const outPath = path.join(__dirname, 'tier_fit_out.json');
fs.writeFileSync(outPath, JSON.stringify({ coefs: coefs, predictions: preds, nPoints: pts.length }, null, 1));
console.log('\nwrote ' + outPath);
