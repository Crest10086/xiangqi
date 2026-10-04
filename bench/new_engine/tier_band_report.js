/* new_engine/tier_band_report.js — mistakeBand: the structural ceiling on p's effect.
 * (card t_a8096ea3, review round 1 item 1)
 *
 * Run: node tier_band_report.js                        (default: tier_analysis_r1/r2 pools)
 *      node tier_band_report.js tier_analysis_r4.json   (also works on the r4 band-ladder pools)
 *
 * WHY THIS EXISTS. A decision file that says "业余 = cap 80, p 0.50" reads like "every second move
 * is a mistake". It is not. The mistake branch only weakens the engine when the band
 *     { cap < gap <= cap + mistakeBand }
 * contains a candidate STRICTLY WORSE than the stable choice. If the band is empty the branch falls
 * back to the stable move (hit=bmiss) and p costs nothing. Therefore
 *     realized effect rate = p * P(band non-empty)
 * and P(band non-empty) is a property of the candidate pools: a ceiling that p/band tuning can
 * approach but never exceed.
 *
 * This computes that ceiling from the pools that were ACTUALLY LOGGED during calibration (no engine
 * run needed — they are in the replay-verified analysis files), for the three band settings the
 * review asked for, in two cfg shapes:
 *   A = the cfg shape the tier decision actually uses (openingCap=cap, hardCap 0 / hardBand 700)
 *   B = plain cfg, no per-class overrides — the reading the reviewer's own offline calculation used,
 *       so their 82% / 76% / 65% numbers reproduce here and the two are comparable.
 * It then predicts the mean loss of each (cap, band, p) through the measured fit
 * (tier_fit_out.json), which is what a band recommendation has to be based on.
 *
 * The REALIZED effect rate (from the logs, calibration side and game side) is tier_effect_report.js.
 */
const fs = require('fs');
const path = require('path');
const T = require('./tier_rules.js');

const NE = __dirname;
const LOGDIR = path.join(NE, '..', 'new_engine_logs');
const F = JSON.parse(fs.readFileSync(path.join(NE, 'tier_fit_out.json'), 'utf8'));

function resolve(n) {
  for (const p of [n, path.join(LOGDIR, n), path.join(NE, n), path.join(NE, n + '.json')]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no such file: ' + n);
}

let files = process.argv.slice(2).filter((x) => !x.startsWith('--'));
if (!files.length) files = ['tier_analysis_r1.json', 'tier_analysis_r2.json'];

const candsOf = (gaps) => gaps.map((g, i) => ({ slot: i + 1, score: -g, move: 'mv' + (i + 1), gap: g }));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f1 = (x) => (x === null || x === undefined ? '  -  ' : (+x).toFixed(1));
const pc = (x) => (x === null ? '-' : (x * 100).toFixed(0) + '%');

const pools = [];   // {src, pos, group, gaps}
for (const f of files) {
  const A = JSON.parse(fs.readFileSync(resolve(f), 'utf8'));
  for (const pid of Object.keys(A.perPosition)) {
    const p = A.perPosition[pid];
    if (!p.poolGaps || !p.poolGaps.length) continue;
    pools.push({ src: f, pos: pid, group: p.group, gaps: p.poolGaps });
  }
}
if (!pools.length) { console.log('no pools found'); process.exit(2); }
console.log('pools loaded = ' + pools.length + ' from ' + files.join(', '));
console.log('pools are the fixed-budget MultiPV8/300ms/Hash64 pools logged by tier_driver; the band test uses');
console.log('the SAME judgement as tier_rules.pick: cap < gap <= cap+mistakeBand, the candidate must have a move.\n');

const BANDS = [{ name: 'cap+50', band: 50 }, { name: 'cap+200', band: 200 }, { name: 'no upper bound', band: 100000 }];
const SHAPES = {
  A: (cap, band, p) => ({ rule: 'tier', cap: cap, p: p, mistakeBand: band,
    openingCap: cap, openingMistakeBand: band, hardCap: 0, hardMistakeBand: 700 }),
  B: (cap, band, p) => ({ rule: 'tier', cap: cap, p: p, mistakeBand: band }),
};

function bandStats(cfg, ps) {
  let empty = 0, bandGaps = [], bandNs = [], eg = [];
  const byc = { opening: [0, 0], normal: [0, 0], hard: [0, 0] };
  for (const P of ps) {
    const cands = candsOf(P.gaps);
    const cls = T.classify(cfg, P.group, cands);
    const cap = T.capFor(cfg, cls), mcap = T.mistakeCapFor(cfg, cls);
    const band = cands.filter((x) => x.move && x.gap > cap && x.gap <= mcap);
    byc[cls][1]++;
    if (!band.length) { empty++; byc[cls][0]++; } else { bandGaps.push(mean(band.map((x) => x.gap))); bandNs.push(band.length); }
    eg.push(T.expectedGap(cfg, cands, P.group));
  }
  return { n: ps.length, empty, emptyRate: empty / ps.length, pNonEmpty: 1 - empty / ps.length,
    meanBandGap: mean(bandGaps), meanBandN: mean(bandNs), meanEGap: mean(eg), byc };
}

for (const shape of ['A', 'B']) {
  console.log('=== shape ' + shape + (shape === 'A'
    ? ' (the cfg the tier decision uses: openingCap=cap, hardCap0/hardBand700)'
    : " (plain cfg, no per-class overrides — the reviewer's reading) ") + ' ===');
  for (const cap of [80, 25]) {
    console.log('\ncap ' + cap + '  [pools=' + pools.length + ']');
    console.log(['band', 'bandEmpty', 'emptyRate', 'P(band non-empty) = ceiling of p', 'meanBandGap', 'meanBandN', 'openingEmpty', 'normalEmpty', 'hardEmpty'].join('\t'));
    for (const B of BANDS) {
      const s = bandStats(SHAPES[shape](cap, B.band, 0.5), pools);
      console.log([B.name, s.empty + '/' + s.n, pc(s.emptyRate), pc(s.pNonEmpty), f1(s.meanBandGap), f1(s.meanBandN),
        'op ' + s.byc.opening[0] + '/' + s.byc.opening[1], 'norm ' + s.byc.normal[0] + '/' + s.byc.normal[1],
        'hard ' + s.byc.hard[0] + '/' + s.byc.hard[1]].join('\t'));
    }
  }
  console.log('');
}

function predict(cfg) {
  const per = { opening: [], normal: [], hard: [] };
  for (const P of pools) {
    const cands = candsOf(P.gaps);
    const cls = T.classify(cfg, P.group, cands);
    const c = F.coefs[cls];
    if (!c || c.slope === null) continue;
    per[cls].push(c.intercept + c.slope * T.expectedGap(cfg, cands, P.group));
  }
  const all = [].concat(per.opening, per.normal, per.hard);
  return { all: mean(all), opening: mean(per.opening), normal: mean(per.normal), hard: mean(per.hard) };
}

console.log('=== predicted mean loss (cp given up vs the ANCHOR best move; fit = tier_fit_out.json) ===');
console.log('    predEffectRate = p * P(band non-empty) = share of moves that are actually worse than the stable choice');
console.log(['tier', 'shape', 'cap', 'p', 'band', 'predEffectRate', 'predAll', 'predOpening', 'predNormal', 'predHard'].join('\t'));
const CASES = [];
for (const shape of ['A', 'B']) {
  for (const B of BANDS) {
    CASES.push({ tier: '业余', shape: shape, cap: 80, p: 0.50, band: B.band, name: B.name });
    CASES.push({ tier: '高手', shape: shape, cap: 25, p: 0.10, band: B.band, name: B.name });
  }
  CASES.push({ tier: '进阶', shape: shape, cap: 80, p: 0.00, band: 200, name: 'p=0 (stable reference)' });
}
for (const c of CASES) {
  const cfg = SHAPES[c.shape](c.cap, c.band, c.p);
  const s = bandStats(cfg, pools);
  const q = predict(cfg);
  console.log([c.tier, c.shape, c.cap, c.p, c.name, c.p === 0 ? '0%' : pc(c.p * s.pNonEmpty),
    f1(q.all), f1(q.opening), f1(q.normal), f1(q.hard)].join('\t'));
}
console.log('\nNOTE the fit is only trusted for NORMAL/OPENING (rmse 24.6 / 39.5 cp). HARD has slope ~0');
console.log('(every alternative there is a blunder, so cap/p barely move it) — do not read predHard as a strength claim.');
