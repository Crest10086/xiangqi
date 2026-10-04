/* new_engine/tier_rules.js — the FIVE-TIER candidate-selection rule (card t_a8096ea3).
 * TEST-ONLY for now; deliberately dependency-free (no DOM) so it can be copied into js/ as-is.
 * Shared by tier_driver.html / tier_games.html (browser) and test_tier_rules.js (node).
 *
 * Design contract (user 2026-10-04 21:40, recorded on t_9c93fb06): two INDEPENDENT dimensions —
 *   cap  = the tier's STABLE strength: the worst engine candidate it plays normally,
 *   p    = the probability of MAKING A MISTAKE instead of playing the stable choice.
 * movetime / Hash are deliberately NOT part of the ladder: bench/NEW_ENGINE_LEVELS_BASELINE.md §3
 * (S1T300 control: same parameters + slot 1 = master strength) and bench/FINAL_REPORT.md 基准三之二
 * (`go nodes` is not a strength knob) both proved search volume is not a strength knob.
 *
 * pick(cfg, pool, pos, seed); candidates = pool.slots in engine order, gap = top1.score - score:
 *   STABLE branch — play the accepted candidate (gap <= cap) with the LARGEST gap, i.e. as weak as
 *     the cap allows (hit='cap'); if nothing but slot 1 is accepted, play slot 1 (hit='above').
 *     Deterministic, consumes no randomness => p=0 is bit-for-bit the `cap` rule.
 *   MISTAKE branch (fires with probability p) — play a candidate strictly WORSE than the stable
 *     choice but still bounded: band = { cap < gap <= cap + mistakeBand }, uniform sample
 *     (hit='rand'). If the band is empty the mistake branch cannot produce a worse move, so it
 *     falls back to the stable choice (hit='bmiss') instead of playing a BETTER one.
 *     (This is the fix for t_f844043c's negative finding: sampling uniformly INSIDE the cap made
 *     the engine stronger than the cap rule — a mistake has to be worse than the stable choice.)
 *   => monotone in both knobs (bigger cap = weaker, bigger p = weaker) and no played move is ever
 *      judged worse than cap + mistakeBand by the pool. mistakeBand may be overridden per position
 *      class (openingMistakeBand / hardMistakeBand).
 *
 * Position class only selects which cap/band apply: openings have a ~2.5x steeper cap->loss slope
 * and 少子形 (HARD) positions have no candidate inside any sane cap, so both need their own
 * numbers (E:\hermes-mem\programmer\projects\xiangqi\weak-tier-*.md).
 *
 * cfg: {rule:'tier', cap, p, mistakeBand?, openingCap?, openingMistakeBand?,
 *       hardCap?, hardMistakeBand?}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TierRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HARD_GAP = 500;              // "every alternative is a blunder" — same threshold as alt_split.js
  var DEFAULT_MISTAKE_BAND = 200;  // a mistake is a real error, bounded well below a 少子形 cliff

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* pool.slots -> [{slot, score, move, gap}] in engine order; gap >= 0 */
  function candidates(pool) {
    var slots = (pool && pool.slots) || {};
    var keys = Object.keys(slots).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) return [];
    var top = slots[keys[0]].score;
    return keys.map(function (k) {
      var s = slots[k];
      return { slot: k, score: s.score, move: (s.pv && s.pv[0]) || null, gap: Math.max(0, top - s.score) };
    });
  }

  /* 'opening' | 'normal' | 'hard' — hard = the best alternative is already a blunder (少子形) */
  function classify(cfg, group, cands) {
    if (group === 'opening') return 'opening';
    var alts = cands.slice(1).filter(function (c) { return c.move; });
    if (!alts.length) return 'normal';
    var best = Math.min.apply(null, alts.map(function (c) { return c.gap; }));
    return best >= HARD_GAP ? 'hard' : 'normal';
  }

  function capFor(cfg, cls) {
    if (cls === 'opening' && cfg.openingCap !== undefined) return cfg.openingCap;
    if (cls === 'hard' && cfg.hardCap !== undefined) return cfg.hardCap;
    return cfg.cap;
  }
  function mistakeBandFor(cfg, cls) {
    var b = (cls === 'opening' && cfg.openingMistakeBand !== undefined) ? cfg.openingMistakeBand
          : (cls === 'hard' && cfg.hardMistakeBand !== undefined) ? cfg.hardMistakeBand
          : cfg.mistakeBand;
    return b === undefined ? DEFAULT_MISTAKE_BAND : b;
  }
  function mistakeCapFor(cfg, cls) { return capFor(cfg, cls) + mistakeBandFor(cfg, cls); }

  function stableChoice(cands, cap) {
    var accepted = cands.filter(function (c) { return c.gap <= cap; });
    if (!accepted.length) return { c: cands[0], hit: 'above', accepted: 1 };
    var best = accepted[0];
    for (var i = 1; i < accepted.length; i++) if (accepted[i].gap > best.gap) best = accepted[i]; // weakest the cap allows
    return { c: best, hit: best.gap > 0 ? 'cap' : 'above', accepted: accepted.length };
  }

  /* Does the mistake branch fire for this seed? Same first draw as pick(), so a driver may skip any
   * extra work when it does not fire without changing a single chosen move (cf. alt_driver). */
  function willRandom(cfg, seed) {
    if (!cfg || !(cfg.p > 0)) return false;
    return mulberry32(seed)() < cfg.p;
  }

  function pick(cfg, pool, pos, seed) {
    var cands = candidates(pool);
    if (!cands.length) return { skip: 'no slots' };
    if (!cands[0].move) return { skip: 'no move in slot 1' };

    var cls = classify(cfg, (pos && pos.group) || 'normal', cands);
    var cap = capFor(cfg, cls);
    var mcap = mistakeCapFor(cfg, cls);
    var st = stableChoice(cands, cap);
    var rnd = mulberry32(seed);
    var fire = (cfg.p || 0) > 0 && rnd() < cfg.p;

    var band = cands.filter(function (c) { return c.move && c.gap > cap && c.gap <= mcap; });
    var meta = 'cap=' + cap + ',mcap=' + mcap + ',p=' + (cfg.p || 0) + ',cls=' + cls +
      ',legal=' + ((pos && pos.legal && pos.legal.length) || 0) +
      ',accN=' + st.accepted + ',bandN=' + band.length +
      ',gaps=' + cands.map(function (c) { return c.slot + ':' + c.gap; }).join(',');

    if (fire) {
      if (band.length) {
        var chosen = band[Math.floor(rnd() * band.length) % band.length];
        return { move: chosen.move, slotUsed: chosen.slot, hit: 'rand', gap: chosen.gap,
                 class: cls, capUsed: cap, mcapUsed: mcap, accept: st.accepted, bandN: band.length,
                 wouldBe: st.c.slot, probs: meta + ',wouldBe=' + st.c.slot + ',agap=' + chosen.gap };
      }
      return { move: st.c.move, slotUsed: st.c.slot, hit: 'bmiss', gap: st.c.gap,
               class: cls, capUsed: cap, mcapUsed: mcap, accept: st.accepted, bandN: 0,
               probs: meta + ',band=0' };
    }
    return { move: st.c.move, slotUsed: st.c.slot, hit: st.hit, gap: st.c.gap,
             class: cls, capUsed: cap, mcapUsed: mcap, accept: st.accepted, bandN: band.length,
             probs: meta };
  }

  /* Offline helper for the calibration model: the expected pool degradation E[gap] this rule
   * produces on a recorded candidate list. tier_model.js turns that into a predicted loss with the
   * measured loss~gap conversion, so unseen (cap, band, p) points can be predicted from ONE
   * calibration round instead of a new experiment per point. */
  function expectedGap(cfg, cands, group) {
    var cls = classify(cfg, group, cands);
    var cap = capFor(cfg, cls);
    var mcap = mistakeCapFor(cfg, cls);
    var st = stableChoice(cands, cap);
    var band = cands.filter(function (c) { return c.move && c.gap > cap && c.gap <= mcap; });
    var p = cfg.p || 0;
    var eBand = band.length
      ? band.reduce(function (a, c) { return a + c.gap; }, 0) / band.length
      : st.c.gap;
    return (1 - p) * st.c.gap + p * eBand;
  }

  return { pick: pick, willRandom: willRandom, candidates: candidates, classify: classify,
           capFor: capFor, mistakeBandFor: mistakeBandFor, mistakeCapFor: mistakeCapFor,
           stableChoice: stableChoice, expectedGap: expectedGap,
           mulberry32: mulberry32, strHash: strHash, HARD_GAP: HARD_GAP,
           DEFAULT_MISTAKE_BAND: DEFAULT_MISTAKE_BAND };
});
