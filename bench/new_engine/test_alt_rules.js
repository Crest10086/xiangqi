/* new_engine/test_alt_rules.js — TEST-ONLY unit tests for alt_rules.js (card t_9f14af96).
 * Run: node test_alt_rules.js
 * Why: the three selection schemes are the whole point of this card; a bug in the selection code
 * would silently become a "measurement result". Test the rules offline before spending engine time.
 */
const R = require('./alt_rules.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function pool(scores) {
  const s = {};
  scores.forEach((sc, i) => { s[i + 1] = { score: sc, pv: ['m' + (i + 1) + 'x'] }; });
  return { slots: s, bestmove: 'm1x' };
}

/* ---------- rule: slot (baseline reproduction) ---------- */
{
  const p = pool([100, 90, 80, 70, 60]);
  const a = R.pick({ rule: 'slot', slot: 4 }, p, {}, 1);
  ok('slot: takes the requested slot', a.slotUsed === 4 && a.move === 'm4x', JSON.stringify(a));
  const b = R.pick({ rule: 'slot', slot: 9 }, p, {}, 1);   // requested slot missing
  ok('slot: falls back to last available when the pool is narrower', b.slotUsed === 5, JSON.stringify(b));
}

/* ---------- rule: cap (候选 gap 阈值) ---------- */
{
  const p = pool([100, 95, 70, 20, -500]);   // gaps 0,5,30,80,600
  const a = R.pick({ rule: 'cap', cap: 60 }, p, {}, 1);
  ok('cap: picks the WORST candidate within the cap (gap 30), not the 80/600 ones',
    a.slotUsed === 3 && a.hit === 'cap', JSON.stringify(a));
  const b = R.pick({ rule: 'cap', cap: 200 }, p, {}, 1);
  ok('cap: larger cap reaches the next degradation (slot 4, gap 80)', b.slotUsed === 4, JSON.stringify(b));
  const q = pool([100, -500, -590]);         // every alternative catastrophic
  const c = R.pick({ rule: 'cap', cap: 60 }, q, {}, 1);
  ok('cap: when all alternatives exceed the cap it does NOT degrade (slot 1, hit=above)',
    c.slotUsed === 1 && c.hit === 'above', JSON.stringify(c));
  const r = pool([100, 99, 98]);             // pool uniformly good
  const d = R.pick({ rule: 'cap', cap: 60 }, r, {}, 1);
  ok('cap: flat pool picks the worst available but the degradation is tiny (gap 2)',
    d.slotUsed === 3 && 100 - 98 <= 60, JSON.stringify(d));
  // cap is deterministic (no randomness) -> same result every seed
  const e1 = R.pick({ rule: 'cap', cap: 60 }, p, {}, 111);
  const e2 = R.pick({ rule: 'cap', cap: 60 }, p, {}, 99999);
  ok('cap: deterministic across seeds', e1.move === e2.move && e1.slotUsed === e2.slotUsed);
}

/* ---------- rule: temp (池内加权随机 / softmax) ---------- */
{
  const p = pool([100, 90, 0]);
  const sm = R.softmaxWeights([{ score: 100 }, { score: 90 }, { score: 0 }], 40);
  const expect = [1, Math.exp(-10 / 40), Math.exp(-100 / 40)];
  const tot = expect.reduce((a, b) => a + b, 0);
  const want = expect.map(x => x / tot);
  const close = sm.w.every((x, i) => Math.abs(x - want[i]) < 1e-9);
  ok('temp: softmax weights match the closed form', close, JSON.stringify(sm.w) + ' vs ' + JSON.stringify(want.map(x => +x.toFixed(4))));
  ok('temp: weights sum to 1', Math.abs(sm.w.reduce((a, b) => a + b, 0) - 1) < 1e-9);

  // realized sampling frequency over many seeds must match the weights
  const N = 20000, cnt = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < N; i++) {
    const s = R.pick({ rule: 'temp', T: 40 }, p, {}, R.strHash('seed' + i));
    cnt[s.slotUsed]++;
  }
  const f = [cnt[1] / N, cnt[2] / N, cnt[3] / N];
  const tol = 0.02;
  ok('temp: empirical draw frequencies match the weights (n=20000)',
    f.every((x, i) => Math.abs(x - want[i]) < tol), 'got ' + JSON.stringify(f.map(x => x.toFixed(3))) + ' want ' + JSON.stringify(want.map(x => x.toFixed(3))));

  // determinism per seed
  const a1 = R.pick({ rule: 'temp', T: 40 }, p, {}, 424242);
  const a2 = R.pick({ rule: 'temp', T: 40 }, p, {}, 424242);
  ok('temp: reproducible for a given seed', a1.slotUsed === a2.slotUsed && a1.move === a2.move);

  // higher temperature must put less mass on slot 1 (monotone in T)
  let mass = [];
  for (const T of [10, 40, 150]) {
    let c1 = 0; const NN = 8000;
    for (let i = 0; i < NN; i++) { if (R.pick({ rule: 'temp', T: T }, p, {}, R.strHash('m' + i)).slotUsed === 1) c1++; }
    mass.push(c1 / NN);
  }
  ok('temp: T is a real strength knob (slot-1 mass strictly decreases with T)',
    mass[0] > mass[1] && mass[1] > mass[2], JSON.stringify(mass.map(x => x.toFixed(3))));

  // expected degradation E[gap] grows with T
  const gaps = [0, 10, 100];
  const eg = [10, 40, 150].map(T => { const s2 = R.softmaxWeights([{ score: 100 }, { score: 90 }, { score: 0 }], T).w; return gaps.reduce((a, g, i) => a + s2[i] * g, 0); });
  ok('temp: expected gap increases with T', eg[0] < eg[1] && eg[1] < eg[2], JSON.stringify(eg.map(x => x.toFixed(1))));
}

/* ---------- rule: noise (叠加降质) ---------- */
{
  const p = pool([100, 90, 80, 70]);
  const legal = [];
  for (let i = 0; i < 40; i++) legal.push('l' + i + 'x');
  const pos = { legal: legal };
  const N = 20000, cnt = { rand: 0, engine: 0 };
  let offList = 0;
  for (let i = 0; i < N; i++) {
    const s = R.pick({ rule: 'noise', p: 0.25, base: 4 }, p, pos, R.strHash('n' + i));
    cnt[s.hit]++;
    if (s.hit === 'rand' && legal.indexOf(s.move) < 0) offList++;
  }
  const share = cnt.rand / N;
  ok('noise: realized random-hit rate matches p (0.25, n=20000)', Math.abs(share - 0.25) < 0.01, 'got ' + share.toFixed(4));
  ok('noise: random moves always come from the legal list', offList === 0, 'off-list=' + offList);
  ok('noise: engine branch keeps the configured base slot', R.pick({ rule: 'noise', p: 0, base: 4 }, p, pos, 7).slotUsed === 4);
}

/* ---------- rule: capnoise (A+C 叠加: 先按 cap 选可接受候选, 再以概率 p 改走随机合法着法) ---------- */
{
  const p = pool([100, 95, 70, 20, -500]);   // gaps 0,5,30,80,600
  const legal = [];
  for (let i = 0; i < 40; i++) legal.push('l' + i + 'x');
  const pos = { legal: legal };

  // p=0 must be byte-for-byte the cap rule (composition preserves A)
  const a0 = R.pick({ rule: 'capnoise', cap: 60, p: 0 }, p, pos, 1);
  const aRef = R.pick({ rule: 'cap', cap: 60 }, p, pos, 1);
  ok('capnoise: p=0 is exactly the cap rule (slot 3, gap 30)',
    a0.slotUsed === 3 && a0.hit === 'cap' && a0.move === aRef.move, JSON.stringify(a0));

  // engine branch keeps the cap-selected slot, never slot 1 by default
  let engineSlots = {}, capViol = 0, n = 20000, randHits = 0, offList = 0;
  for (let i = 0; i < n; i++) {
    const s = R.pick({ rule: 'capnoise', cap: 60, p: 0.25 }, p, pos, R.strHash('cn' + i));
    if (s.hit === 'rand') {
      randHits++;
      if (legal.indexOf(s.move) < 0) offList++;
    } else {
      engineSlots[s.slotUsed] = (engineSlots[s.slotUsed] || 0) + 1;
      if (100 - p.slots[s.slotUsed].score > 60) capViol++;
    }
  }
  ok('capnoise: realized random-hit rate matches p (0.25, n=20000)',
    Math.abs(randHits / n - 0.25) < 0.01, 'got ' + (randHits / n).toFixed(4));
  ok('capnoise: random moves always come from the legal list', offList === 0, 'off-list=' + offList);
  ok('capnoise: engine branch obeys the cap ceiling (0 samples above cap)', capViol === 0, 'viol=' + capViol);
  ok('capnoise: engine branch uses the cap-selected slot, not slot 1',
    engineSlots[3] > n * 0.5 && !engineSlots[1], JSON.stringify(engineSlots));

  // p is monotone in realized error rate
  let shares = [];
  for (const pp of [0.10, 0.25, 0.40]) {
    let c = 0; const NN = 20000;
    for (let i = 0; i < NN; i++) if (R.pick({ rule: 'capnoise', cap: 200, p: pp }, p, pos, R.strHash('m' + i)).hit === 'rand') c++;
    shares.push(c / NN);
  }
  ok('capnoise: p is a real knob (realized error rate increases with p)',
    shares[0] < shares[1] && shares[1] < shares[2], JSON.stringify(shares.map(x => x.toFixed(3))));

  // p=0.10 (the AC_AD setting) still plays the cap candidate most of the time
  let capShare = 0; const NN2 = 20000;
  for (let i = 0; i < NN2; i++) { const s = R.pick({ rule: 'capnoise', cap: 60, p: 0.10 }, p, pos, R.strHash('q' + i)); if (s.hit === 'cap') capShare++; }
  ok('capnoise: p=0.10 keeps the cap candidate in ~90% of draws',
    Math.abs(capShare / NN2 - 0.90) < 0.02, 'got ' + (capShare / NN2).toFixed(4));

  // all alternatives above the cap -> engine branch degenerates to slot 1 with hit=above (same as A)
  const q = pool([100, -500, -590]);
  let above = 0;
  for (const pp of [0, 0.25]) {
    for (let i = 0; i < 2000; i++) {
      const s = R.pick({ rule: 'capnoise', cap: 60, p: pp }, q, pos, R.strHash('z' + i));
      if (pp === 0 && s.hit === 'above' && s.slotUsed === 1) above++;
    }
  }
  ok('capnoise: with every candidate above the cap the engine branch degenerates to slot 1 (hit=above)',
    above === 2000, 'above=' + above);

  // determinism per seed
  const d1 = R.pick({ rule: 'capnoise', cap: 200, p: 0.25 }, p, pos, 424242);
  const d2 = R.pick({ rule: 'capnoise', cap: 200, p: 0.25 }, p, pos, 424242);
  ok('capnoise: reproducible for a given seed', d1.hit === d2.hit && d1.move === d2.move && d1.slotUsed === d2.slotUsed);

  // missing legal list must not crash the rule silently -> skip
  const noLegal = R.pick({ rule: 'capnoise', cap: 60, p: 0.25 }, p, {}, 1);
  ok('capnoise: refuses to run without a legal-move list (skip, no silent fallback)',
    !!noLegal.skip, JSON.stringify(noLegal));
}

/* ---------- rule: boundednoise (随机分支也受 cap 约束) — card t_f844043c ---------- */
{
  const poolM = (entries) => {
    const s = {};
    entries.forEach(([sc, mv], i) => { s[i + 1] = { score: sc, mate: null, pv: [mv] }; });
    return { slots: s, bestmove: entries[0][1] };
  };
  // main pool: gaps 0,5,30,80,600 ; cap 60 => acceptable pool moves are m1x/m2x/m3x
  const P = poolM([[100, 'm1x'], [95, 'm2x'], [70, 'm3x'], [20, 'm4x'], [-500, 'm5x']]);
  const legal = ['m1x', 'm2x', 'm3x', 'm4x', 'm5x'];
  for (let i = 0; i < 35; i++) legal.push('l' + i + 'x');
  const pos = { legal };

  // (1) p=0 must be bit-for-bit the cap rule (the cap branch consumes no randomness)
  const b0 = R.pick({ rule: 'boundednoise', cap: 60, p: 0, gapmode: 'pool' }, P, pos, 7);
  const cref = R.pick({ rule: 'cap', cap: 60 }, P, pos, 7);
  ok('boundednoise: p=0 is exactly the cap rule (slot 3)',
    b0.slotUsed === 3 && b0.hit === 'cap' && b0.move === cref.move, JSON.stringify(b0));

  // (2) gapmode='pool': the random branch may only pick a pool move whose gap <= cap
  {
    const cfg = { rule: 'boundednoise', cap: 60, p: 0.40, gapmode: 'pool' };
    const N = 20000; let brand = 0, overCap = 0, offPool = 0, seen = {};
    for (let i = 0; i < N; i++) {
      const s = R.pick(cfg, P, pos, R.strHash('bn' + i));
      if (s.hit === 'brand') {
        brand++;
        seen[s.move] = (seen[s.move] || 0) + 1;
        const idx = ['m1x', 'm2x', 'm3x', 'm4x', 'm5x'].indexOf(s.move);
        if (idx < 0) { offPool++; continue; }                 // unjudged move must never be played
        if (100 - P.slots[idx + 1].score > 60) overCap++;    // judged degradation must respect cap
      }
    }
    ok('boundednoise(pool): realized random-hit rate matches p (0.40, n=20000)',
      Math.abs(brand / N - 0.40) < 0.01, 'got ' + (brand / N).toFixed(4));
    ok('boundednoise(pool): 0 samples above the cap (the ceiling now covers the random branch)',
      overCap === 0 && offPool === 0, 'overCap=' + overCap + ' unjudged=' + offPool);
    ok('boundednoise(pool): sampling universe is the acceptable pool candidates (m1x/m2x/m3x only)',
      Object.keys(seen).sort().join(',') === 'm1x,m2x,m3x', JSON.stringify(seen));
  }

  // (3) gapmode='probe': judged with a separate shallow probe pool; unprobed legal moves are rejected
  {
    // probe pool: 12 scored moves; gaps relative to its own top1
    const PP = poolM([
      [100, 'm1x'], [90, 'm2x'], [70, 'm3x'], [50, 'l0x'], [45, 'l1x'], [40, 'l2x'],
      [39, 'l3x'], [10, 'l4x'], [-20, 'l5x'], [-500, 'm4x'], [-600, 'm5x'], [-900, 'l6x'],
    ]);
    // cap 60 => acceptable: m1x(0) m2x(10) m3x(30) l0x(50) l1x(55) l2x(60) l3x(61>X) l4x(90) ...
    const wantAccept = ['m1x', 'm2x', 'm3x', 'l0x', 'l1x', 'l2x'];
    const cfg = { rule: 'boundednoise', cap: 60, p: 0.40, gapmode: 'probe' };
    const N = 40000; let brand = 0, bad = 0, seen = {};
    for (let i = 0; i < N; i++) {
      const s = R.pick(cfg, P, pos, R.strHash('bp' + i), PP);
      if (s.hit !== 'brand') continue;
      brand++;
      seen[s.move] = (seen[s.move] || 0) + 0 + 1;
      const e = PP.slots[Object.keys(PP.slots).find(k => PP.slots[k].pv[0] === s.move)];
      if (!e) { bad += 100; continue; }                      // unprobed legal move played -> wrong
      if (100 - e.score > 60) bad++;
      if (wantAccept.indexOf(s.move) < 0) bad += 1000;
    }
    ok('boundednoise(probe): every random move is inside the judge-acceptable set (0 violations)',
      bad === 0, 'violations=' + bad);
    ok('boundednoise(probe): accept set = probe-scored legal moves with gap<=cap (6 of 40, uniform)',
      Object.keys(seen).sort().join(',') === wantAccept.slice().sort().join(','), JSON.stringify(seen));
    ok('boundednoise(probe): legal moves the probe never scored are never played',
      Object.keys(seen).filter(m => m[0] === 'l' && wantAccept.indexOf(m) < 0).length === 0,
      JSON.stringify(Object.keys(seen)));
    ok('boundednoise(probe): realized random-hit rate matches p (n=40000)',
      Math.abs(brand / N - 0.40) < 0.01, 'got ' + (brand / N).toFixed(4));

    // probe judge must be reported as used in the log meta (so cost can be audited)
    const one = R.pick(cfg, P, pos, 5, PP);
    ok('boundednoise(probe): meta carries cap/p/legal/judge-accept-count',
      /cap=60/.test(one.probs) && /p=0.4/.test(one.probs) && /legal=40/.test(one.probs) && /pjn=6/.test(one.probs),
      one.probs);
  }

  // (4) HARD degeneration: when nothing but the top1 passes the filter the random branch degenerates
  {
    const PHard = poolM([[100, 'm1x'], [-500, 'm2x'], [-590, 'm3x']]);
    const PP = poolM([[100, 'm1x'], [-500, 'm2x'], [-590, 'm3x'], [-700, 'l0x']]);
    let degenerate = 0, miss = 0; const N = 4000;
    for (let i = 0; i < N; i++) {
      const s = R.pick({ rule: 'boundednoise', cap: 60, p: 1, gapmode: 'probe' }, PHard, { legal: ['m1x', 'm2x', 'm3x', 'l0x'] }, R.strHash('h' + i), PP);
      if (s.hit === 'brand' && s.move === 'm1x') degenerate++;   // random branch forced back to the safe move
      if (s.hit === 'bmiss') miss++;                              // must not happen: top1 is always acceptable
    }
    ok('boundednoise: in a cliff position the random branch degenerates to the safe top1 (no blunder, no bmiss)',
      degenerate === N && miss === 0, 'degenerate=' + degenerate + ' bmiss=' + miss);
  }

  // (5) bmiss fallback: judge top1 not in the legal list and every other candidate over the cap
  {
    const PP = poolM([[100, 'zz9z'], [-500, 'm2x'], [-590, 'm3x']]);
    const s = R.pick({ rule: 'boundednoise', cap: 60, p: 1, gapmode: 'probe' }, P, pos, 3, PP);
    ok('boundednoise: when no legal move passes the filter it falls back to the cap choice (hit=bmiss)',
      s.hit === 'bmiss' && s.slotUsed === 3 && s.move === 'm3x', JSON.stringify(s));
  }

  // (6) p is a real knob, monotone in realized error rate
  {
    const shares = [];
    for (const pp of [0.10, 0.25, 0.40]) {
      let c = 0; const N = 20000;
      for (let i = 0; i < N; i++) if (R.pick({ rule: 'boundednoise', cap: 200, p: pp, gapmode: 'pool' }, P, pos, R.strHash('k' + i)).hit === 'brand') c++;
      shares.push(c / N);
    }
    ok('boundednoise: p is monotone in realized random-hit rate',
      shares[0] < shares[1] && shares[1] < shares[2], JSON.stringify(shares.map(x => x.toFixed(3))));
  }

  // (7) determinism per seed
  {
    const cfg = { rule: 'boundednoise', cap: 200, p: 0.40, gapmode: 'pool' };
    const a = R.pick(cfg, P, pos, 424242), b = R.pick(cfg, P, pos, 424242);
    ok('boundednoise: reproducible for a given seed', a.hit === b.hit && a.move === b.move && a.slotUsed === b.slotUsed);
  }

  // (8) the decisive contrast with capnoise: same pool, same legal list, same p
  {
    const N = 20000;
    const POOLMV = ['m1x', 'm2x', 'm3x'];   // the only candidates whose degradation is <= 60
    const overUnb = (() => {
      let o = 0;
      for (let i = 0; i < N; i++) {
        const s = R.pick({ rule: 'capnoise', cap: 60, p: 0.40 }, P, pos, R.strHash('c' + i));
        if (s.hit === 'rand' && POOLMV.indexOf(s.move) < 0) o++;   // off-pool or gap>cap => unbounded
      }
      return o;
    })();
    let overB = 0, brandB = 0;
    for (let i = 0; i < N; i++) {
      const s = R.pick({ rule: 'boundednoise', cap: 60, p: 0.40, gapmode: 'pool' }, P, pos, R.strHash('c' + i));
      if (s.hit === 'brand') { brandB++; if (POOLMV.indexOf(s.move) < 0) overB++; }
    }
    ok('boundednoise vs capnoise: the unbounded branch plays moves outside the cap, the bounded one never does',
      overUnb > 0 && overB === 0 && brandB > 0, 'unbounded=' + overUnb + ' boundedOver=' + overB);
  }

  // (9) missing inputs must skip, never silently fall back
  {
    const noLegal = R.pick({ rule: 'boundednoise', cap: 60, p: 0.25, gapmode: 'pool' }, P, {}, 1);
    ok('boundednoise: refuses to run without a legal-move list', !!noLegal.skip, JSON.stringify(noLegal));
    const noProbe = R.pick({ rule: 'boundednoise', cap: 60, p: 1, gapmode: 'probe' }, P, pos, 1, null);
    ok('boundednoise: a firing probe-mode draw without a probe pool skips (no silent unbounded fallback)',
      !!noProbe.skip, JSON.stringify(noProbe));
  }

  // (9b) driver contract: a draw where the random branch does NOT fire must not need a judge
  {
    const PP2 = poolM([[100, 'm1x'], [95, 'm2x'], [70, 'm3x'], [20, 'm4x'], [-500, 'm5x']]);
    let noJudgeOk = 0, nonFiring = 0, firing = 0, firingSkipped = 0, mismatch = 0;
    for (let i = 0; i < 2000; i++) {
      const seed = R.strHash('nj' + i);
      const fires = R.willRandom({ rule: 'boundednoise', cap: 60, p: 0.25 }, seed);
      const noJudge = R.pick({ rule: 'boundednoise', cap: 60, p: 0.25, gapmode: 'probe' }, P, pos, seed);  // no judge passed
      const withJudge = R.pick({ rule: 'boundednoise', cap: 60, p: 0.25, gapmode: 'probe' }, P, pos, seed, PP2);
      const isRand = !withJudge.skip && withJudge.hit === 'brand';
      if (isRand !== fires) mismatch++;                       // willRandom must agree with pick()
      if (!fires) { nonFiring++; if (!noJudge.skip && (noJudge.hit === 'cap' || noJudge.hit === 'above')) noJudgeOk++; }
      else { firing++; if (noJudge.skip) firingSkipped++; }  // firing without a judge must skip
    }
    ok('boundednoise: willRandom agrees with pick(), and a non-firing draw needs no judge',
      mismatch === 0 && noJudgeOk === nonFiring && firingSkipped === firing && nonFiring > 0 && firing > 0,
      'mismatch=' + mismatch + ' engineBranchWithoutJudge=' + noJudgeOk + '/' + nonFiring + ' firingSkipped=' + firingSkipped + '/' + firing);
    const strict = R.pick({ rule: 'boundednoise', cap: 60, p: 1, gapmode: 'probe' }, P, pos, 9);
    ok('boundednoise: a firing draw WITHOUT a judge skips instead of falling back to an unbounded move',
      !!strict.skip, JSON.stringify(strict));
  }

  // (10) bounded branch is bounded in expectation too: E[judged gap] <= cap for any accept set
  {
    const PP = poolM([[100, 'm1x'], [95, 'm2x'], [70, 'm3x'], [20, 'm4x']]);
    let eg = 0, N = 20000, n = 0;
    for (let i = 0; i < N; i++) {
      const s = R.pick({ rule: 'boundednoise', cap: 60, p: 1, gapmode: 'probe' }, P, pos, R.strHash('e' + i), PP);
      if (s.hit !== 'brand') continue;
      const slot = Object.keys(PP.slots).find(k => PP.slots[k].pv[0] === s.move);
      eg += 100 - PP.slots[slot].score; n++;
    }
    const mean = eg / n;
    ok('boundednoise: E[judged degradation] <= cap and every draw is <= cap',
      mean <= 60 && n === N, 'E[gap]=' + mean.toFixed(1) + ' n=' + n);
  }
}

/* ---------- rule: anchor (noise-floor control) ---------- */
{
  const p = { slots: { 1: { score: 55, pv: ['b2e2'] } }, bestmove: 'b2e2' };
  const a = R.pick({ rule: 'anchor' }, p, {}, 1);
  ok('anchor: replays the anchor own bestmove', a.move === 'b2e2' && a.slotUsed === 1, JSON.stringify(a));
}

/* ---------- PRNG sanity ---------- */
{
  const r = R.mulberry32(123);
  const vals = []; for (let i = 0; i < 5000; i++) vals.push(r());
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  ok('prng: uniform in [0,1) with sane mean', vals.every(v => v >= 0 && v < 1) && Math.abs(mean - 0.5) < 0.02, 'mean=' + mean.toFixed(4));
  const r2 = R.mulberry32(123); const r3 = R.mulberry32(123);
  ok('prng: same seed same stream', r2() === r3());
  ok('strHash: stable', R.strHash('1|OP00|TMP_AM') === R.strHash('1|OP00|TMP_AM'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
