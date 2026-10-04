/* new_engine/tier_effect_report.js — the "生效率" (realized mistake rate) of the p dimension.
 * (card t_a8096ea3, review round 1 item 1: the review found that the decision file never stated
 *  how often p actually produces a worse move, and asked for one number on the calibration side and
 *  one on the game side.)
 *
 * Run: node tier_effect_report.js                 # both sides, defaults below
 *      node tier_effect_report.js --calib tier_analysis_r1.json tier_analysis_r2.json
 *      node tier_effect_report.js --games games_r1.log games_r2.log
 *
 * Definitions (stated once, used everywhere in the reports):
 *   fired      = the RNG said "make a mistake" (draw < p)
 *   bandN>0    = the band {cap < gap <= cap+mistakeBand} actually contains a candidate strictly
 *                worse than the stable choice
 *   effective  = a strictly worse move was actually played  (hit=rand)
 *   effectiveness rate = effective / moves  =  p * P(band non-empty)  — NOT p.
 * A move with hit=bmiss means the mistake branch fired but had nowhere to go, so it played the
 * stable move: p cost nothing there.
 */
const fs = require('fs');
const path = require('path');
const T = require('./tier_rules.js');

const NE = __dirname;
const LOGDIR = path.join(NE, '..', 'new_engine_logs');

function resolve(n) {
  for (const p of [n, path.join(LOGDIR, n), path.join(NE, n), path.join(NE, n + '.json')]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no such file: ' + n);
}
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');

/* ---------------- calibration side: from the replayed analysis (mismatches=0) ---------------- */
function calib(files) {
  console.log('=== A. calibration side (tier_driver logs, replay-verified) ===');
  console.log(['analysis', 'cfg', 'cap', 'p', 'band', 'moves', 'fired', 'bmiss', 'effective(rand)', 'firedShare', 'effectRate=effective/moves', 'effectRateOfFired'].join('\t'));
  const agg = {};
  for (const f of files) {
    const A = JSON.parse(fs.readFileSync(resolve(f), 'utf8'));
    for (const id of Object.keys(A.perCfg)) {
      const c = A.perCfg[id];
      if (!c.cfg || c.cfg.rule !== 'tier') continue;
      // perCfg.hitShare stores SHARES ("rand:0.12"), so convert back to counts with n
      const h = {};
      for (const seg of String(c.hitShare).split(',')) { const i = seg.indexOf(':'); h[seg.slice(0, i)] = +seg.slice(i + 1); }
      const rand = (h.rand || 0) * c.n, bmiss = (h.bmiss || 0) * c.n, fired = rand + bmiss;
      console.log([f, id, c.cfg.cap, c.cfg.p, c.cfg.mistakeBand === undefined ? '-' : c.cfg.mistakeBand,
        c.n, fired.toFixed(1), bmiss.toFixed(1), rand.toFixed(1),
        pct(fired, c.n), pct(rand, c.n), pct(rand, fired)].join('\t'));
      const key = id + '|cap' + c.cfg.cap + '|p' + c.cfg.p + '|band' + (c.cfg.mistakeBand === undefined ? '-' : c.cfg.mistakeBand);
      const a = agg[key] = agg[key] || { n: 0, rand: 0, bmiss: 0, cfg: c.cfg };
      a.n += c.n; a.rand += rand; a.bmiss += bmiss;
    }
  }
  console.log('\naggregated across the given analyses (same cfg id):');
  console.log(['cfg', 'cfgN', 'effective', 'bmiss', 'effectRate', 'effectRateOfFired'].join('\t'));
  for (const k of Object.keys(agg)) {
    const a = agg[k];
    console.log([k, a.n, a.rand.toFixed(2), a.bmiss.toFixed(2), pct(a.rand, a.n), pct(a.rand, a.rand + a.bmiss)].join('\t'));
  }
}

/* ---------------- game side: from the 互弈 logs (GM lines carry probs=..bandN=..) ---------------- */
function games(files) {
  const st = {};
  for (const f of files) {
    for (const line of fs.readFileSync(resolve(f), 'utf8').split(/\r?\n/)) {
      if (!line.startsWith('GM|')) continue;
      const parts = line.split('|');
      const kv = Object.fromEntries(parts.slice(4).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
      const cfg = kv.cfg; if (!cfg) continue;
      const s = st[cfg] = st[cfg] || { n: 0, rand: 0, bmiss: 0, cap: 0, above: 0, bandPos: 0, bandSum: 0, fired: 0, p: null, capUsed: null, bandUsed: null };
      s.n++;
      const hit = kv.hit;
      if (hit === 'rand') s.rand++;
      if (hit === 'bmiss') s.bmiss++;
      if (hit === 'cap') s.cap++;
      if (hit === 'above') s.above++;
      const m = /bandN=(\d+)/.exec(line);
      if (m) { s.bandPos += (+m[1] > 0 ? 1 : 0); s.bandSum += +m[1]; }
      const pm = /(?:^|,)p=([0-9.]+)/.exec(String(kv.probs || '')); if (pm) s.p = +pm[1];
      const cm = /^cap=(\d+)/.exec(String(kv.probs || '')); if (cm) s.capUsed = +cm[1];
      const bm = /mcap=(\d+)/.exec(String(kv.probs || '')); if (bm) s.bandUsed = bm[1];
    }
  }
  console.log('\n=== B. game side (五档互弈 logs; bandN from the logged probs) ===');
  console.log(['cfg', 'moves', 'capUsed', 'mcapUsed', 'p', 'bandN>0 moves', 'mean bandN', 'effective(rand)', 'bmiss(fired, band empty)', 'effectRate=effective/moves', 'effectRateOfFired'].join('\t'));
  for (const k of Object.keys(st)) {
    const s = st[k];
    const fired = s.rand + s.bmiss;
    console.log([k, s.n, s.capUsed, s.bandUsed, s.p, s.bandPos, (s.bandSum / Math.max(1, s.n)).toFixed(2),
      s.rand, s.bmiss, pct(s.rand, s.n), pct(s.rand, fired)].join('\t'));
  }
}

const args = process.argv.slice(2);
const mode = args[0];
if (mode === '--calib') calib(args.slice(1).length ? args.slice(1) : ['tier_analysis_r1.json', 'tier_analysis_r2.json']);
else if (mode === '--games') games(args.slice(1).length ? args.slice(1) : ['games_r1.log', 'games_r2.log']);
else {
  const cal = (mode ? [mode].concat(args.slice(1)) : ['tier_analysis_r1.json', 'tier_analysis_r2.json']).filter((x) => !x.startsWith('--'));
  calib(cal.length ? cal : ['tier_analysis_r1.json', 'tier_analysis_r2.json']);
  games(['games_r1.log', 'games_r2.log']);
}
