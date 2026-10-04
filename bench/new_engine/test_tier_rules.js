/* new_engine/test_tier_rules.js — unit tests for tier_rules.js (card t_a8096ea3).
 * Run: node test_tier_rules.js
 * The rule under test is the five-tier selection rule: a stable branch bounded by `cap` plus a
 * mistake branch that fires with probability `p` and plays a candidate STRICTLY WORSE than the
 * stable choice, bounded by cap+mistakeBand. Written before the experiment (TDD): the experiment
 * only measures the numbers, the behaviour below is fixed here.
 */
const T = require('./tier_rules.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')); }
}
const S = (score, mv) => ({ score: score, mate: null, pv: [mv] });
const pool = (slots) => ({ slots: slots, bestmove: slots[1] && slots[1].pv[0] });

/* NORMAL: a real intermediate candidate gradient exists */
const NORMAL = pool({
  1: S(100, 'a1a2'), 2: S(95, 'b1b2'), 3: S(80, 'c1c2'), 4: S(60, 'd1d2'),
  5: S(30, 'e1e2'), 6: S(-20, 'f1f2'), 7: S(-90, 'g1g2'), 8: S(-200, 'h1h2'),
});
/* HARD (少子形): slot 1 is fine, EVERY alternative is a blunder (>=500 cp cliff) */
const HARD = pool({ 1: S(50, 'a1a2'), 2: S(-520, 'b1b2'), 3: S(-560, 'c1c2'), 4: S(-590, 'd1d2') });
/* OPENING: candidates nearly equal (gaps 0..4) */
const OPEN = pool({ 1: S(30, 'a1a2'), 2: S(29, 'b1b2'), 3: S(28, 'c1c2'), 4: S(27, 'd1d2'), 5: S(26, 'e1e2') });
const LEGAL = ['a1a2', 'b1b2', 'c1c2', 'd1d2', 'e1e2', 'f1f2', 'g1g2', 'h1h2', 'i1i2'];

const base = { rule: 'tier', cap: 40, p: 0.30, mistakeBand: 200 };
const seedOf = (i) => (T.strHash('t' + i) ^ 97000) >>> 0;
const run = (cfg, pl, group, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(T.pick(cfg, pl, { group: group, legal: LEGAL }, seedOf(i)));
  return out;
};

/* ---------- 1. p=0 is bit-for-bit the cap rule ---------- */
{
  const c0 = Object.assign({}, base, { p: 0 });
  let bad = null;
  for (let i = 0; i < 40; i++) {
    const r = T.pick(c0, NORMAL, { group: 'midgame', legal: LEGAL }, seedOf(i));
    // cap=40 -> accepted = gaps 0,5,20,40 (slots 1..4); the rule takes the WORST accepted = slot 4
    if (r.move !== 'd1d2' || r.slotUsed !== 4 || r.hit !== 'cap') { bad = r; break; }
  }
  ok('p=0 is the cap choice (worst candidate with gap <= cap) for every seed', !bad, JSON.stringify(bad));
  const rHard = T.pick(Object.assign({}, base, { p: 0, mistakeBand: 0 }), HARD, { group: 'midgame', legal: LEGAL }, 7);
  ok('cap rule with nothing acceptable plays slot 1 (hit=above)', rHard.move === 'a1a2' && rHard.hit === 'above', JSON.stringify(rHard));
}

/* ---------- 2. ceilings: cap branch <= cap, nothing ever exceeds cap + band ---------- */
{
  const rs = run(base, NORMAL, 'midgame', 300);
  const capOver = rs.filter(r => r.hit === 'cap' && r.gap > base.cap).length;
  const anyOver = rs.filter(r => r.gap > base.cap + base.mistakeBand).length;
  ok('cap branch never exceeds cap', capOver === 0, 'over=' + capOver);
  ok('no played move exceeds cap + mistakeBand', anyOver === 0, 'over=' + anyOver + ' max=' + Math.max.apply(null, rs.map(r => r.gap)));
}

/* ---------- 3. the mistake branch fires at about p and is strictly worse than the stable choice ---------- */
{
  const rs = run(base, NORMAL, 'midgame', 400);
  const rand = rs.filter(r => r.hit === 'rand');
  ok('mistake branch fires at about p', Math.abs(rand.length / 400 - base.p) < 0.06, 'share=' + (rand.length / 400).toFixed(3));
  const notWorse = rand.filter(r => r.gap <= base.cap).length;
  ok('every mistake is strictly worse than the cap-bounded stable choice', notWorse === 0, 'bad=' + notWorse);
  const inBand = rand.filter(r => r.gap > base.cap && r.gap <= base.cap + base.mistakeBand).length;
  ok('every mistake stays inside the mistake band', inBand === rand.length, 'in=' + inBand + '/' + rand.length);
}

/* ---------- 4. empty band => the mistake branch falls back to the stable choice, never to a BETTER move ---------- */
{
  const c = Object.assign({}, base, { mistakeBand: 0, p: 1 });
  const rs = run(c, NORMAL, 'midgame', 20);
  ok('band empty + p=1 -> bmiss = the stable choice (no upgrade to a better move)',
     rs.every(r => r.hit === 'bmiss' && r.move === 'd1d2'), JSON.stringify(rs[0]));
  const rh = run(Object.assign({}, base, { p: 1 }), HARD, 'midgame', 20);
  ok('HARD position with a band that does not reach the cliff -> stable choice (no forced 570cp blunder)',
     rh.every(r => r.hit === 'bmiss' && r.move === 'a1a2'), JSON.stringify(rh[0]));
}

/* ---------- 5. position class detection ---------- */
{
  ok('classify: HARD when the best alternative is >= HARD_GAP worse', T.classify(base, 'midgame', T.candidates(HARD)) === 'hard');
  ok('classify: NORMAL when an intermediate gradient exists', T.classify(base, 'midgame', T.candidates(NORMAL)) === 'normal');
  ok('classify: opening group is reported as opening', T.classify(base, 'opening', T.candidates(OPEN)) === 'opening');
  ok('classify: a single-candidate pool is not HARD', T.classify(base, 'midgame', T.candidates(pool({ 1: S(5, 'a1a2') }))) === 'normal');
}

/* ---------- 6. per-class cap / band overrides ---------- */
{
  const c1 = Object.assign({}, base, { openingCap: 2, p: 0 });
  const r1 = T.pick(c1, OPEN, { group: 'opening', legal: LEGAL }, 3);
  ok('openingCap overrides cap (worst accepted = slot 3, gap 2)', r1.move === 'c1c2' && r1.slotUsed === 3, JSON.stringify(r1));
  const c2 = Object.assign({}, base, { openingCap: 4, p: 0 });
  const r2 = T.pick(c2, OPEN, { group: 'opening', legal: LEGAL }, 3);
  ok('openingCap=4 takes the worst opening candidate (slot 5, gap 4)', r2.move === 'e1e2' && r2.slotUsed === 5, JSON.stringify(r2));
  const c3 = Object.assign({}, base, { hardCap: 0, hardMistakeBand: 700, p: 1 });
  const r3 = T.pick(c3, HARD, { group: 'midgame', legal: LEGAL }, 4);
  ok('hardCap=0 + hardMistakeBand=700 + p=1 -> a 少子形 becomes a real blunder (a piece is dropped)',
     r3.hit === 'rand' && r3.gap >= 570, JSON.stringify(r3));
  const c4 = Object.assign({}, base, { hardCap: 0, hardMistakeBand: 700, p: 0 });
  const r4 = T.pick(c4, HARD, { group: 'midgame', legal: LEGAL }, 4);
  ok('the same HARD config with p=0 never drops the piece (mistakes are the p dimension only)',
     r4.hit === 'above' && r4.move === 'a1a2', JSON.stringify(r4));
}

/* ---------- 7. monotonicity in BOTH knobs ---------- */
{
  const meanGap = (cfg) => {
    const rs = run(cfg, NORMAL, 'midgame', 300);
    return rs.reduce((a, r) => a + r.gap, 0) / rs.length;
  };
  const caps = [0, 30, 60, 120].map(c => meanGap(Object.assign({}, base, { cap: c })));
  const ps = [0, 0.2, 0.5, 0.8].map(p => meanGap(Object.assign({}, base, { p: p })));
  let monoC = true, monoP = true;
  for (let i = 1; i < caps.length; i++) if (!(caps[i] > caps[i - 1])) monoC = false;
  for (let i = 1; i < ps.length; i++) if (!(ps[i] > ps[i - 1])) monoP = false;
  ok('cap is monotone in expected degradation', monoC, JSON.stringify(caps));
  ok('p is monotone in expected degradation', monoP, JSON.stringify(ps));
  const rates = [0, 0.2, 0.5, 0.8].map(p => run(Object.assign({}, base, { p: p }), NORMAL, 'midgame', 200).filter(r => r.hit === 'rand').length / 200);
  let monoR = true;
  for (let i = 1; i < rates.length; i++) if (!(rates[i] > rates[i - 1])) monoR = false;
  ok('p is monotone in the realized mistake rate', monoR, JSON.stringify(rates));
}

/* ---------- 8. willRandom agrees with pick (a driver may skip work when the branch cannot fire) ---------- */
{
  let bad = 0;
  for (let i = 0; i < 300; i++) {
    const s = seedOf(i);
    const w = T.willRandom(base, s);
    const r = T.pick(base, NORMAL, { group: 'midgame', legal: LEGAL }, s);
    if (w !== (r.hit === 'rand')) bad++;
  }
  ok('willRandom === (pick takes the mistake branch) when a band exists', bad === 0, 'bad=' + bad);
  ok('willRandom is false when p=0', !T.willRandom(Object.assign({}, base, { p: 0 }), 123));
}

/* ---------- 9. expectedGap helper (the offline calibration model) matches the realized mean ---------- */
{
  const cands = T.candidates(NORMAL);
  const cfg = Object.assign({}, base, { p: 0.5 });
  const predicted = T.expectedGap(cfg, cands, 'midgame');
  const rs = run(cfg, NORMAL, 'midgame', 2000);
  const realized = rs.reduce((a, r) => a + r.gap, 0) / rs.length;
  ok('expectedGap predicts the realized mean degradation (pool gaps are deterministic)',
     Math.abs(predicted - realized) < 3, 'pred=' + predicted.toFixed(1) + ' real=' + realized.toFixed(1));
}

/* ---------- 10. reproducibility ---------- */
{
  const a = T.pick(base, NORMAL, { group: 'midgame', legal: LEGAL }, 12345);
  const b = T.pick(base, NORMAL, { group: 'midgame', legal: LEGAL }, 12345);
  ok('same seed -> same move', a.move === b.move && a.hit === b.hit);
  const seen = new Set(run(base, NORMAL, 'midgame', 40).map(r => r.move));
  ok('different seeds -> different choices (not deterministic)', seen.size > 1, 'distinct=' + seen.size);
}

/* ---------- 11. malformed input must skip, never invent a move ---------- */
{
  ok('empty pool skips', T.pick(base, { slots: {} }, { group: 'midgame', legal: LEGAL }, 1).skip !== undefined);
  ok('missing legal list still works for the cap branch',
     T.pick(Object.assign({}, base, { p: 0 }), NORMAL, { group: 'midgame' }, 1).move === 'd1d2');
  const r = T.pick(Object.assign({}, base, { p: 1 }), pool({ 1: S(10, 'a1a2') }), { group: 'midgame', legal: LEGAL }, 1);
  ok('single-candidate pool with p=1 -> the only move (band empty, nothing invented)', r.hit === 'bmiss' && r.move === 'a1a2', JSON.stringify(r));
  const noPv = T.pick(base, pool({ 1: { score: 3, mate: null, pv: [] } }), { group: 'midgame', legal: LEGAL }, 1);
  ok('a slot without a pv line skips', noPv.skip !== undefined, JSON.stringify(noPv));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
