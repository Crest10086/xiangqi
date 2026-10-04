/* new_engine/alt_split.js — TEST-ONLY for card t_9f14af96.
 * Splits the midgame group into the two position classes the baseline card identified
 *   - "HARD"  = positions where the baseline AM0 pool had a >=500 cp cliff (少子形: every
 *               alternative is a blunder)  -> the FLAT-producing class
 *   - "NORMAL"= the rest (real intermediate candidate gradient exists)
 * and reports per-class means/medians per config, plus the CAP rule's hit distribution per class.
 * Rationale: the aggregate mean is dominated by 6 catastrophic-cliff positions; whether a scheme
 * separates tiers in NORMAL positions is the question that decides the wiring recommendation.
 */
const fs = require('fs');
const path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', process.env.ANALYSIS || 'alt_analysis.json'), 'utf8'));
const posDefs = JSON.parse(fs.readFileSync(path.join(__dirname, 'level_positions.json'), 'utf8'));

const CFGS = Object.keys(A.all).sort((a, b) => (a === 'ANCH' ? 1 : 0) - (b === 'ANCH' ? 1 : 0) || a.localeCompare(b));
const ROUNDS = A.rounds;

// classify positions: AM0 realized gap >= 500 in any round -> HARD
const hard = new Set();
for (const p of posDefs) {
  for (const r of ROUNDS) {
    const det = A.all.AM0.perRound[r] && A.all.AM0.perRound[r].detail.find(x => x.pid === p.id);
    if (det && +det.gap >= 500) hard.add(p.id);
  }
}
const mid = posDefs.filter(x => x.group === 'midgame').map(x => x.id);
const hardMid = mid.filter(x => hard.has(x));
const normMid = mid.filter(x => !hard.has(x));
const opening = posDefs.filter(x => x.group === 'opening').map(x => x.id);

console.log('HARD midgame (baseline AM0 gap>=500): ' + JSON.stringify(hardMid));
console.log('NORMAL midgame: ' + JSON.stringify(normMid));
console.log('opening: ' + JSON.stringify(opening));

function lossMean(cfg, ids) {
  const vals = [];
  for (const r of ROUNDS) for (const d of A.all[cfg].perRound[r].detail) if (ids.includes(d.pid)) vals.push(d.loss);
  if (!vals.length) return null;
  const s = vals.slice().sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { n: vals.length, mean: +mean.toFixed(1), median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}

const classes = { HARD: hardMid, NORMAL: normMid, OPENING: opening };
console.log('\ncfg      | HARD mean/med        | NORMAL mean/med      | OPENING mean/med');
for (const cfg of CFGS) {
  const row = [cfg.padEnd(8)];
  for (const k of ['HARD', 'NORMAL', 'OPENING']) {
    const s = lossMean(cfg, classes[k]);
    row.push(s ? ('mean=' + String(s.mean).padStart(6) + ' med=' + String(s.median).padStart(5)).padEnd(21) : 'n/a'.padEnd(21));
  }
  console.log(row.join('| '));
}

// paired delta per class with significance
console.log('\npaired deltas per class (positive = first is weaker)');
const PAIRS = [['AM0', 'AD0'], ['CAP_AD', 'AD0'], ['CAP_AM', 'CAP_AD'], ['CAP_AM', 'AD0'], ['TMP_AD', 'AD0'], ['TMP_AM', 'TMP_AD'], ['TMP_AM', 'AD0'], ['NOI_AD', 'AD0'], ['NOI_AM', 'AM0'], ['NOI_AM', 'NOI_AD'], ['CAP_AD', 'EX0'], ['CAP_AM', 'EX0'], ['AD0', 'EX0'],
               ['AC_AD', 'CAP_AD'], ['AC_AM', 'CAP_AM'], ['AC_AM', 'AC_AD'], ['AC_AD', 'AD0'], ['AC_AM', 'AD0'], ['AC_AM', 'AM0'], ['AC_AM', 'EX0'], ['AC_AD', 'EX0'],
               ['AC_P15', 'AC_AD'], ['AC_P20', 'AC_P15'], ['AC_AM', 'AC_P20'], ['AC_X1', 'AC_AD'], ['AC_X1', 'AC_AM'],
               ['BN_AD', 'CAP_AD'], ['BN_AM', 'CAP_AM'], ['BN_AD', 'AC_AD'], ['BN_AM', 'AC_AM'], ['BN_AM', 'BN_P2'],
               ['BN_AM', 'AM0'], ['BN_AD', 'AD0'], ['BN_AM', 'EX0'], ['BN_AM', 'NOI_AM'], ['BN_AM', 'BN_AD'],
               ['BN_AD', 'EX0'], ['BN_AD', 'AM0'], ['BN_P2', 'CAP_AM'], ['BN_P2', 'AM0'], ['BN_P2', 'EX0'], ['BN_P2', 'AD0']].filter(p => CFGS.includes(p[0]) && CFGS.includes(p[1]));
for (const [a, b] of PAIRS) {
  const out = [ (a + ' - ' + b).padEnd(18) ];
  for (const k of ['HARD', 'NORMAL', 'OPENING']) {
    const d = [];
    for (const r of ROUNDS) {
      const da = A.all[a].perRound[r].detail.filter(x => classes[k].includes(x.pid));
      for (const x of da) {
        const y = A.all[b].perRound[r].detail.find(z => z.pid === x.pid);
        if (y) d.push(x.loss - y.loss);
      }
    }
    if (!d.length) { out.push('n/a'.padEnd(30)); continue; }
    const m = d.reduce((x, y) => x + y, 0) / d.length;
    const sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(d.length - 1, 1));
    const se = sd / Math.sqrt(d.length);
    out.push(('d=' + String(+m.toFixed(1)).padStart(7) + ' t=' + (se > 0 ? +(m / se).toFixed(2) : 'NA') + ' n=' + d.length).padEnd(30));
  }
  console.log(out.join('| '));
}

// CAP-family rule behaviour per class (cap alone, and cap+noise)
console.log('\ncap-family rule realized gap by class (cap branch only; for BN_* the bounded-random branch is reported separately below)');
const CAPCFGS = CFGS.filter(c => /^CAP_|^AC_|^BN_/.test(c));
for (const cfg of CAPCFGS) {
  for (const k of ['HARD', 'NORMAL', 'OPENING']) {
    const gaps = [];
    const hits = {};
    for (const r of ROUNDS) for (const d of A.all[cfg].perRound[r].detail) {
      if (!classes[k].includes(d.pid)) continue;
      hits[d.hit] = (hits[d.hit] || 0) + 1;
      if (d.hit !== 'rand' && d.hit !== 'brand') gaps.push(+d.gap);   // cap branch only; rand/brand have no pool gap
    }
    if (!gaps.length) continue;
    const s = gaps.slice().sort((a, b) => a - b);
    console.log(cfg.padEnd(8) + k.padEnd(8) + ' n=' + gaps.length + ' gapMean=' + (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) +
      ' gapMed=' + s[Math.floor(s.length / 2)] + ' hits=' + JSON.stringify(hits));
  }
}

// bounded branch behaviour for BN_*: what the judge accepted and how large the played degradation was
{
  const BN = CFGS.filter(c => /^BN_/.test(c));
  if (!BN.length) process.exit(0);
  console.log('\nbounded branch by class (BN_*)');
  console.log('cfg      class    n  acceptMean acceptMin judgedGapMean judgedGapMax >cap  hits');
  for (const cfg of BN) {
    for (const k of ['HARD', 'NORMAL', 'OPENING']) {
      const brand = [];
      const accept = [];
      const hits = {};
      for (const r of ROUNDS) for (const d of A.all[cfg].perRound[r].detail) {
        if (!classes[k].includes(d.pid)) continue;
        hits[d.hit] = (hits[d.hit] || 0) + 1;
        const m = String(d.probs || '').match(/,accept=(\d+)/);
        if (m) accept.push(+m[1]);
        if (d.hit === 'brand') { const gm = String(d.probs || '').match(/,agap=(-?\d+)/); brand.push(gm ? +gm[1] : NaN); }
      }
      if (!accept.length) continue;
      const cap = (A.ruleDiag[cfg] || {}).cap;
      const over = brand.filter(g => cap !== undefined && g > cap).length;
      const mean = brand.length ? (brand.reduce((a, b) => a + b, 0) / brand.length).toFixed(1) : 'n/a';
      console.log(cfg.padEnd(8) + k.padEnd(8) + String(brand.length).padStart(3) + ' ' +
        String((accept.reduce((a, b) => a + b, 0) / accept.length).toFixed(2)).padStart(11) + ' ' +
        String(Math.min(...accept)).padStart(10) + ' ' + String(mean).padStart(15) + ' ' +
        String(brand.length ? Math.max(...brand) : 'n/a').padStart(14) + ' ' + String(over).padStart(5) + ' ' + JSON.stringify(hits));
    }
  }
}
