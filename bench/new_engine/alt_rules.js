/* new_engine/alt_rules.js — TEST-ONLY candidate-selection rules for cards t_9f14af96 / t_3fff5a44.
 * Shared by alt_driver.html (browser, <script src>) and test_alt_rules.js (node).
 *
 * A "pool" is { slots: { 1: {score, pv:[uci...]}, 2: ... }, bestmove } as produced by the driver's
 * parse() of UCI info output. pick(cfg, pool, pos, seed) returns
 *   { move, slotUsed, hit, probs }   on success
 *   { skip: reason }                 when no candidate is usable
 *
 * Rules (cfg.rule):
 *   slot  : take cfg.slot (fallback: last available slot)
 *   cap   : take the WORST slot whose gap(top1 - slot) <= cfg.cap; if every alternative exceeds the
 *           cap, take slot 1 (hit='above') -> degradation is capped, never worse than cap
 *   temp  : softmax, p_i ∝ exp((score_i - top1)/cfg.T), sampled with a seeded PRNG
 *   noise : with prob cfg.p play a uniform-random legal move from pos.legal, else take slot cfg.base
 *   capnoise: A+C composition (card t_3fff5a44). First apply `cap` (worst candidate with
 *           gap <= cfg.cap, else slot 1, hit='above'); then with prob cfg.p OVERRIDE that choice
 *           with a uniform-random legal move from pos.legal (hit='rand'). The cap branch consumes no
 *           randomness, so p=0 is bit-for-bit the `cap` rule. probs carries cap/p/legal/gaps/wouldBe.
 *   boundednoise: card t_f844043c. Same cap branch as `cap`, but the prob-p random branch is
 *           BOUNDED: it may only play a legal move whose own degradation is <= cfg.cap, sampled
 *           uniformly among the moves that pass the filter (hit='brand'). If no legal move passes,
 *           it falls back to the cap choice (hit='bmiss'). So the ceiling that `cap` enforces on
 *           the engine branch now also covers the random branch.
 *           How a legal move's degradation is measured is cfg.gapmode:
 *             'probe' (default) - score from a wide shallow probe search passed in as probePool
 *                                 (degradation = probeTop1 - probeScore(move))
 *             'pool'           - score from the main candidate pool only; moves that are not in
 *                                 the pool have unknown degradation and are conservatively rejected
 *           Zero extra search for gapmode='pool'; 'probe' costs one extra search per move (the
 *           driver logs its nodes/depth as pnodes/pdepth). p=0 is bit-for-bit the `cap` rule.
 *   anchor: play the ANCHOR search's own bestmove (metric noise-floor control)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AltRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function strHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function softmaxWeights(slots, T) {
    const top = slots[0].score;
    const w = slots.map(s => Math.exp((s.score - top) / T));
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    return { w: w.map(x => x / tot), tot: tot };
  }

  /* shared cap branch: worst candidate whose degradation <= cap, else slot 1 (hit='above').
   * Consumes no randomness, so any rule built on it is bit-for-bit `cap` when p=0. */
  function capChoice(keys, pool, top1, cap) {
    const gaps = keys.map(k => ({ k: k, gap: top1.score - pool.slots[k].score }));
    const allowed = gaps.filter(g => g.gap <= cap);
    const k = allowed.length ? allowed[allowed.length - 1].k : 1;   // worst within the cap
    return { k: k, hit: allowed.length > 1 ? 'cap' : 'above', gaps: gaps };
  }

  /* Which legal moves are "acceptable" for the bounded random branch (degradation <= cap).
   * Returns { accept: [{move,gap}], judged: n_judged, mode } — moves the judge never scored are
   * conservatively treated as unacceptable (never played).
   *   gapmode 'pool'   : judge = the main candidate pool only (zero extra search)
   *   gapmode 'probe'  : judge = the shallow wide probe pool only
   *   gapmode 'hybrid' : pool verdict wins for pool candidates; every other legal move is judged
   *                      by the probe (the definition the card suggests). */
  function boundedAcceptSet(cfg, keys, pool, legal, probePool) {
    const mode = cfg.gapmode || 'probe';
    const fromPool = () => {
      const c = capChoice(keys, pool, pool.slots[1], cfg.cap);
      const acc = [];
      for (const g of c.gaps) {
        if (g.gap > cfg.cap) continue;
        const mv = pool.slots[g.k].pv[0];
        if (mv && legal.indexOf(mv) >= 0) acc.push({ move: mv, gap: g.gap, src: 'pool' });
      }
      return { accept: acc, judged: c.gaps.length };
    };
    const fromProbe = () => {
      if (!probePool || !probePool.slots || !Object.keys(probePool.slots).length || !probePool.slots[1])
        return { accept: null, judged: 0, skip: 'boundednoise gapmode=' + mode + ' needs a probe pool' };
      const pk = Object.keys(probePool.slots).map(Number).sort((a, b) => a - b);
      const ptop = probePool.slots[1].score;
      const acc = [];
      for (const kk of pk) {
        const mv = probePool.slots[kk].pv[0];
        if (!mv) continue;
        const gap = ptop - probePool.slots[kk].score;
        if (gap > cfg.cap) continue;
        if (legal.indexOf(mv) < 0) continue;              // not a legal move -> cannot be played
        acc.push({ move: mv, gap: gap, src: 'probe' });
      }
      return { accept: acc, judged: pk.length };
    };
    if (mode === 'pool') { const r = fromPool(); return { accept: r.accept, judged: r.judged, mode: mode }; }
    if (mode === 'probe') { const r = fromProbe(); if (r.skip) return r; return { accept: r.accept, judged: r.judged, mode: mode }; }
    // hybrid
    const p1 = fromPool();
    const p2 = fromProbe();
    if (p2.skip) return p2;
    const seen = new Set(p1.accept.map(a => a.move));
    const accept = p1.accept.slice();
    for (const a of p2.accept) if (!seen.has(a.move)) accept.push(a);
    return { accept: accept, judged: p1.judged + p2.judged, mode: mode };
  }

  /* Does the prob-p branch fire for this seed? Same first draw as pick(), so the driver can run
   * the probe search ONLY when it is actually needed without changing any chosen move. */
  function willRandom(cfg, seed) {
    if (!cfg || !(cfg.p > 0)) return false;
    return mulberry32(seed)() < cfg.p;
  }

  function pick(cfg, pool, pos, seed, probePool) {
    const rnd = mulberry32(seed);
    const keys = Object.keys(pool.slots).map(Number).sort((a, b) => a - b);

    if (cfg.rule === 'anchor') {
      const bm = (pool.slots[1] && pool.slots[1].pv[0]) || pool.bestmove;
      if (!bm) return { skip: 'no anchor bestmove' };
      return { move: bm, slotUsed: 1, hit: 'anchor', probs: '' };
    }
    if (!keys.length) return { skip: 'no slots' };
    const top1 = pool.slots[1];
    if (!top1) return { skip: 'no slot 1' };

    if (cfg.rule === 'slot') {
      const want = cfg.slot;
      const k = keys.indexOf(want) >= 0 ? want : keys[keys.length - 1];
      const s = pool.slots[k];
      if (!s || !s.pv.length) return { skip: 'no slot ' + k };
      return { move: s.pv[0], slotUsed: k, hit: 'slot', probs: '' };
    }

    if (cfg.rule === 'cap') {
      const gaps = keys.map(k => ({ k: k, gap: top1.score - pool.slots[k].score }));
      const allowed = gaps.filter(g => g.gap <= cfg.cap);
      const k = allowed.length ? allowed[allowed.length - 1].k : 1;   // worst within the cap
      const hit = allowed.length > 1 ? 'cap' : 'above';
      const s = pool.slots[k];
      if (!s || !s.pv.length) return { skip: 'cap slot empty ' + k };
      return { move: s.pv[0], slotUsed: k, hit: hit, probs: gaps.map(g => g.k + ':' + g.gap).join(',') };
    }

    if (cfg.rule === 'temp') {
      const slots = keys.map(k => ({ k: k, score: pool.slots[k].score }));
      const sm = softmaxWeights(slots, cfg.T);
      let r = rnd(), k = slots[slots.length - 1].k;
      for (let i = 0; i < slots.length; i++) { r -= sm.w[i]; if (r <= 0) { k = slots[i].k; break; } }
      const probs = 'T=' + cfg.T + ',' + slots.map((s, i) => s.k + ':' + sm.w[i].toFixed(3)).join(',');
      const s = pool.slots[k];
      if (!s || !s.pv.length) return { skip: 'temp slot empty ' + k };
      return { move: s.pv[0], slotUsed: k, hit: 'temp', probs: probs, weights: sm.w.map((x, i) => slots[i].k + ':' + x.toFixed(4)) };
    }

    if (cfg.rule === 'capnoise') {
      // A+C composition: first pick the worst candidate whose degradation is <= cap (rule A),
      // then with probability p override it with a uniform-random legal move (rule C).
      // The cap decision consumes no randomness, so p=0 is bit-for-bit the cap rule.
      const legal = (pos && pos.legal) || [];
      if (!legal.length) return { skip: 'capnoise needs a legal list' };
      const gaps = keys.map(k => ({ k: k, gap: top1.score - pool.slots[k].score }));
      const allowed = gaps.filter(g => g.gap <= cfg.cap);
      const k = allowed.length ? allowed[allowed.length - 1].k : 1;   // worst within the cap
      const hitCap = allowed.length > 1 ? 'cap' : 'above';
      const meta = 'cap=' + cfg.cap + ',p=' + cfg.p + ',legal=' + legal.length + ',' +
        gaps.map(g => g.k + ':' + g.gap).join(',');
      if ((cfg.p || 0) > 0 && rnd() < cfg.p) {
        const mv = legal[Math.floor(rnd() * legal.length)];
        let kk = -1;
        for (const q of keys) { if (pool.slots[q].pv[0] === mv) { kk = q; break; } }
        return { move: mv, slotUsed: kk, hit: 'rand', probs: meta + ',wouldBe=' + k };
      }
      const s = pool.slots[k];
      if (!s || !s.pv.length) return { skip: 'capnoise slot empty ' + k };
      return { move: s.pv[0], slotUsed: k, hit: hitCap, probs: meta };
    }

    if (cfg.rule === 'boundednoise') {
      // card t_f844043c: same cap branch as `cap`, but the prob-p random branch may only play a
      // legal move whose OWN degradation is <= cap (judged by the probe pool, or by the main pool).
      const legal = (pos && pos.legal) || [];
      if (!legal.length) return { skip: 'boundednoise needs a legal list' };
      const c = capChoice(keys, pool, top1, cfg.cap);
      // The judge is only needed when the random branch actually fires; the driver runs the probe
      // search under exactly the same condition (AltRules.willRandom), so a non-firing draw must
      // not fail because no probe was provided.
      const fire = (cfg.p || 0) > 0 && rnd() < cfg.p;
      let acc = null;
      // pool-judged needs no search at all, so its accept-set is always computable and always logged
      if (fire || probePool || (cfg.gapmode || 'probe') === 'pool') {
        acc = boundedAcceptSet(cfg, keys, pool, legal, probePool);
        if (acc.skip) { if (fire) return { skip: acc.skip }; acc = null; }
      }
      const accN = acc && acc.accept ? acc.accept.length : 'na';
      const meta = 'cap=' + cfg.cap + ',p=' + (cfg.p || 0) + ',gapmode=' + (cfg.gapmode || 'probe') +
        ',legal=' + legal.length + ',pjn=' + accN + ',pjudged=' + (acc ? acc.judged : 'na') + ',' +
        c.gaps.map(g => g.k + ':' + g.gap).join(',');
      if (fire) {
        if (acc.accept.length) {
          const pickd = acc.accept[Math.floor(rnd() * acc.accept.length)];
          let kk = -1;
          for (const q of keys) { if (pool.slots[q].pv[0] === pickd.move) { kk = q; break; } }
          return { move: pickd.move, slotUsed: kk, hit: 'brand', judgedGap: pickd.gap,
                   probs: meta + ',wouldBe=' + c.k + ',accept=' + acc.accept.length + ',agap=' + pickd.gap };
        }
        // no legal move passes the filter -> fall back to the cap choice (never an unbounded move)
        const s = pool.slots[c.k];
        if (!s || !s.pv.length) return { skip: 'boundednoise fallback slot empty ' + c.k };
        return { move: s.pv[0], slotUsed: c.k, hit: 'bmiss', probs: meta + ',accept=0' };
      }
      const s = pool.slots[c.k];
      if (!s || !s.pv.length) return { skip: 'boundednoise slot empty ' + c.k };
      return { move: s.pv[0], slotUsed: c.k, hit: c.hit, probs: meta + ',accept=' + accN };
    }

    if (cfg.rule === 'noise') {
      const legal = (pos && pos.legal) || [];
      if (!legal.length) return { skip: 'no legal list' };
      if (rnd() < cfg.p) {
        const mv = legal[Math.floor(rnd() * legal.length)];
        let k = -1;
        for (const kk of keys) { if (pool.slots[kk].pv[0] === mv) { k = kk; break; } }
        return { move: mv, slotUsed: k, hit: 'rand', probs: 'p=' + cfg.p + ',legal=' + legal.length };
      }
      const want = cfg.base || 1;
      const k = keys.indexOf(want) >= 0 ? want : keys[keys.length - 1];
      const s = pool.slots[k];
      if (!s || !s.pv.length) return { skip: 'noise base slot empty ' + k };
      return { move: s.pv[0], slotUsed: k, hit: 'engine', probs: 'p=' + cfg.p + ',legal=' + legal.length };
    }

    return { skip: 'unknown rule ' + cfg.rule };
  }

  return { pick: pick, willRandom: willRandom, boundedAcceptSet: boundedAcceptSet,
           mulberry32: mulberry32, strHash: strHash, softmaxWeights: softmaxWeights };
});
