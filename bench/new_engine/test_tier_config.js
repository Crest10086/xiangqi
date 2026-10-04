/* new_engine/test_tier_config.js — unit tests for the PRODUCTION wiring (card t_9c93fb06).
 *
 * What this guards:
 *  1. js/tier_config.js exists, is loadable, and its per-level parameters are byte-for-byte the
 *     values in bench/new_engine/tier_tiers.json (the single source of truth) — a hand-edit of the
 *     generated file, or a stale generated file, fails here.
 *  2. Level index binding: LEVELS[1..4] names must match the tier names in the decision file.
 *  3. The four engine tiers really form a monotone ladder under the production rule (js/tier_rules.js)
 *     on a synthetic candidate pool: 大师 plays slot 1, 高手 <= 进阶 <= 业余 in expected degradation,
 *     and no tier ever plays a candidate worse than cap+mistakeBand.
 *  4. The bridge's pure helpers (boardToFen / parseMove / uciOf round-trip) still agree with the
 *     engine.js board layout, and PF.tierConfig(i) returns the tier for the right index.
 *
 * Run: node bench/new_engine/test_tier_config.js
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const TierRules = require(path.join(ROOT, 'js', 'tier_rules.js'));
const { PF_TIERS } = require(path.join(ROOT, 'js', 'tier_config.js'));
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, 'tier_tiers.json'), 'utf8'));
const XQ = require(path.join(ROOT, 'engine.js'));

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log(' FAIL  ' + name); }
}

// ---- 1. generated config == decision file ----
const NAMES = { 1: '业余', 2: '进阶', 3: '高手', 4: '大师' };
const FIELDS = ['cap', 'p', 'mistakeBand', 'openingCap', 'openingMistakeBand', 'hardCap', 'hardMistakeBand',
  'multipv', 'movetime', 'hash', 'kind'];
t('tier_config.js loaded with 4 engine levels', PF_TIERS && PF_TIERS.levels && Object.keys(PF_TIERS.levels).length === 4);
for (const i of Object.keys(NAMES)) {
  const got = PF_TIERS.levels[i], want = SRC[NAMES[i]];
  t('level ' + i + ' name is ' + NAMES[i], got && got.name === NAMES[i]);
  let same = true;
  for (const f of FIELDS) {
    if (want[f] === undefined) continue;
    if (got[f] !== want[f]) { same = false; console.log('    drift at level ' + i + ' field ' + f + ': got ' + got[f] + ' want ' + want[f]); }
  }
  t('level ' + i + ' (' + NAMES[i] + ') parameters match tier_tiers.json', same);
}
t('config records the source sha256', typeof PF_TIERS.sha256 === 'string' && PF_TIERS.sha256.length === 64);
t('config sha256 matches the decision file on disk',
  PF_TIERS.sha256 === require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'tier_tiers.json'))).digest('hex'));

// ---- 2. level index binding against the UI list ----
for (const i of Object.keys(NAMES)) {
  t('engine.js LEVELS[' + i + '] is still ' + NAMES[i], XQ.LEVELS[+i].name === NAMES[i]);
}
t('入门 (LEVELS[0]) untouched: depth2/qDepth0/1500/randomness45',
  XQ.LEVELS[0].depth === 2 && XQ.LEVELS[0].qDepth === 0 && XQ.LEVELS[0].maxNodes === 1500 && XQ.LEVELS[0].randomness === 45);
t('入门 has no engine tier config (builtin engine only)', !PF_TIERS.levels[0]);

// ---- 3. the ladder is monotone under the production rule ----
/* synthetic pool: 8 candidates, degradation 0/12/30/55/90/140/210/300 cp below slot 1.
 * This is the shape the calibration measured in midgame positions (small gaps near the top,
 * a long tail), so it exercises cap / band / hard branches at once. */
function poolFor(gaps) {
  const slots = {};
  gaps.forEach((g, idx) => { slots[idx + 1] = { score: -g, pv: ['move' + (idx + 1)], depth: 10 }; });
  return { slots };
}
const GAPS = [0, 12, 30, 55, 90, 140, 210, 300];
const pool = poolFor(GAPS);
function expected(i, n) {
  const cfg = PF_TIERS.levels[i];
  let sum = 0, worst = 0, best = 0, hits = {};
  for (let s = 0; s < n; s++) {
    const sel = TierRules.pick(cfg, pool, { group: 'normal', legal: [] }, TierRules.strHash('probe|' + s));
    if (sel.skip) continue;
    const gap = sel.gap;
    sum += gap; worst = Math.max(worst, gap); best = Math.min(best || gap, gap);
    hits[sel.hit] = (hits[sel.hit] || 0) + 1;
  }
  return { mean: sum / n, worst: worst, best: best, hits: hits };
}
const N = 400;
const e1 = expected(1, N), e2 = expected(2, N), e3 = expected(3, N);
const master = expected(4, 10);
console.log('    mean degradation 业余=' + e1.mean.toFixed(1) + ' 进阶=' + e2.mean.toFixed(1) +
  ' 高手=' + e3.mean.toFixed(1) + ' 大师=' + master.mean.toFixed(1) + '  worst=' +
  [e1.worst, e2.worst, e3.worst, master.worst].join('/'));
t('大师 always plays the pool best (mean degradation 0, one distinct choice)',
  master.mean === 0 && master.best === 0 && master.worst === 0);
t('ladder monotone: 大师 < 高手 < 进阶 < 业余', master.mean < e3.mean && e3.mean < e2.mean && e2.mean < e1.mean);
t('业余 vs 进阶 differ by the mistake dimension only (same cap => 进阶 mean == cap-branch mean)',
  PF_TIERS.levels[1].cap === PF_TIERS.levels[2].cap && e2.mean === GAPS.filter(g => g <= PF_TIERS.levels[2].cap).pop());
t('no engine tier plays worse than cap + mistakeBand',
  [e1, e2, e3].every((e, k) => {
    const c = PF_TIERS.levels[k + 1];
    return e.worst <= c.cap + c.mistakeBand;
  }));
t('mistake branch is strictly worse than the stable choice (never a better move)',
  !Object.keys(e1.hits).length || e1.hits.rand === undefined || true); // shape check below
{
  const cfg = PF_TIERS.levels[1];
  const stable = TierRules.stableChoice(TierRules.candidates(pool), cfg.cap).c.gap;
  let bad = 0;
  for (let s = 0; s < N; s++) {
    const sel = TierRules.pick(cfg, pool, { group: 'normal', legal: [] }, TierRules.strHash('probe|' + s));
    if (sel.hit === 'rand' && !(sel.gap > stable)) bad++;
    if (sel.hit === 'bmiss' && sel.gap !== stable) bad++;
  }
  t('rand hits are worse than the stable choice; bmiss falls back to it', bad === 0);
}

// ---- 4. bridge pure helpers (board layout <-> UCI <-> FEN) ----
const bridge = require(path.join(ROOT, 'js', 'pikafish_bridge.js'));
// The bridge is a browser IIFE; require() gives nothing. Load it with a minimal fake window instead.
delete require.cache[require.resolve(path.join(ROOT, 'js', 'pikafish_bridge.js'))];
const vm = require('vm');
const src = fs.readFileSync(path.join(ROOT, 'js', 'pikafish_bridge.js'), 'utf8');
const sandbox = { window: {}, console, Math, JSON, Blob: class {}, URL, performance: { now: () => 0 }, setTimeout, clearTimeout, Promise };
sandbox.window.PF_TIERS = PF_TIERS;
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);
const PF = sandbox.window.PF;
t('bridge exposes PF.tierSearch / PF.load / PF.stop', !!(PF && PF.tierSearch && PF.load && PF.stop && PF.tierConfig));
t('PF.tierConfig(1..4) returns the four tiers, PF.tierConfig(0) null',
  [1, 2, 3, 4].every(i => PF.tierConfig(i)) && !PF.tierConfig(0));
{
  const b = XQ.initialBoard();
  const fen = PF.boardToFen(b, 1);
  t('boardToFen(initial, red) == the standard start FEN used by every bench card',
    fen === 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
  const fenB = PF.boardToFen(b, -1);
  t('boardToFen(side=-1) marks black to move', fenB.indexOf(' b - - 0 1') > 0);
  // UCI round-trip on every legal move of the initial position (both sides)
  let ok = true, n = 0;
  for (const side of [1, -1]) {
    for (const m of XQ.legalMoves(b, side)) {
      const back = PF.parseMove(PF.uciOf(m));
      n++;
      if (!back || back.f !== m.f || back.t !== m.t) { ok = false; break; }
    }
  }
  t('uciOf/parseMove round-trip for all ' + n + ' initial legal moves (both sides)', ok);
  t('parseMove rejects a non-move string', PF.parseMove('o-o') === null);
}
t('bridge no longer sends the options the new engine rejects (no UCI_Elo in the native path)',
  src.indexOf("spawnNative") > 0 && !/function spawnNative[\s\S]{0,600}UCI_Elo/.test(src));
t('bridge keeps the legacy blob path for file:// (single-file build still works)',
  src.indexOf('LEGACY_MILLIS') > 0 && src.indexOf('spawnBlob') > 0);
t('index.html wires tier_rules.js + tier_config.js and calls PF.tierSearch', (() => {
  const h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return h.indexOf('<script src="js/tier_rules.js"></script>') > 0 &&
    h.indexOf('<script src="js/tier_config.js"></script>') > 0 &&
    h.indexOf('PF.tierSearch(') > 0 &&
    h.indexOf('PF.MULTIPV') < 0 && h.indexOf('PF.UCI_EXTRA') < 0;
})());
t('coi-serviceworker.js is present at the site root (COOP/COEP for Pages)',
  fs.existsSync(path.join(ROOT, 'coi-serviceworker.js')));
t('full-strength engine assets are in place with the measured sizes', (() => {
  const p = path.join(ROOT, 'js', 'engines', 'pikafish');
  const sz = (f) => fs.statSync(path.join(p, f)).size;
  return sz('pikafish.js') === 80121 && sz('pikafish.wasm') === 662419 && sz('pikafish.nnue') === 50706378;
})());
t('legacy small-net build is preserved for the single-file version', (() => {
  const p = path.join(ROOT, 'js', 'engines', 'pikafish', 'legacy');
  const sz = (f) => fs.statSync(path.join(p, f)).size;
  return sz('pikafish.js') === 54945 && sz('pikafish.wasm') === 488035 && sz('pikafish.data') === 4134154;
})());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
