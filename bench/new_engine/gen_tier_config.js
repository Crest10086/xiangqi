/* new_engine/gen_tier_config.js — turn the decided parameters into the production config file.
 *
 * Card t_9c93fb06 (接入线上): the wiring must follow bench/new_engine/tier_tiers.json, and the
 * values must not be hand-copied into js/ (that is how two sources drift apart). This script reads
 * the machine-readable decision file and writes js/tier_config.js, which js/pikafish_bridge.js reads.
 *
 *   node bench/new_engine/gen_tier_config.js          -> writes js/tier_config.js
 *   require('./gen_tier_config.js')                   -> { LEVEL_TIER, capLadderGate, buildLevels }
 *                                                       with NO side effect (test_cap_gate.js needs that)
 *
 * Guards:
 *  - refuses to write unless the tier names match engine.js LEVELS[1..4] (a rename would silently
 *    bind the wrong parameters to a UI level);
 *  - refuses to write unless the predicted-loss order 大师 < 高手 < 进阶 < 业余 holds (the gate
 *    tier_decide.js uses — it needs the fitted model, i.e. tier_tiers.json.predictedLoss);
 *  - refuses to write unless the CAP LADDER itself is monotone (card t_0918db73, capLadderGate
 *    below). That one reads the parameters only — no fit file, no calibration logs — so it also
 *    catches a hand-edit of tier_tiers.json in a plain clone, which is exactly the case the
 *    predicted-loss gate cannot cover;
 *  - records the sha256 of tier_tiers.json in the generated file so a stale config is visible.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, 'tier_tiers.json');
const OUT = path.join(__dirname, '..', '..', 'js', 'tier_config.js');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

// UI level index (engine.js LEVELS order) -> tier name in the decision file
const LEVEL_TIER = { 1: '业余', 2: '进阶', 3: '高手', 4: '大师' };
// what the bridge actually needs from each tier entry
const FIELDS = ['cap', 'p', 'mistakeBand', 'openingCap', 'openingMistakeBand', 'hardCap', 'hardMistakeBand',
  'multipv', 'movetime', 'hash', 'kind', 'id'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ---------------------------------------------------------------------------
 * capLadderGate — the cap monotonicity assertion (card t_0918db73).
 *
 * The tier design rests on one sentence of the contract (bench/TIER_DESIGN_FINAL.md and the header
 * of tier_decide.js): cap / p / mistakeBand are the ONLY strength knobs, and movetime/Hash are one
 * fixed search budget shared by the engine tiers, NOT the ladder. tier_decide.js enforces that
 * through a fitted loss model (predictedLoss), which needs tier_fit_out.json and the calibration
 * logs. A clone of this repo has the decision file and none of that, so the parameters themselves
 * have to carry the assertion. This function needs nothing but the parameters.
 *
 * Ladder order (UI index): 大师(4) < 高手(3) < 进阶(2) <= 业余(1).
 *   1. every knob that exists is a finite number; cap >= 0, 0 <= p < 1, mistakeBand > 0;
 *   2. 大师 is the ceiling: no cap, MultiPV 1 (it plays the pool best, it is not a rung);
 *   3. the three engine tiers share ONE budget: identical multipv (> 1, else there is no candidate
 *      pool for cap/p to work on), movetime and hash, and they match the decision file's
 *      fixedSearchBudget when it is present. A tier whose movetime differs has moved a search
 *      budget into the ladder — bench/FINAL_REPORT.md 基准三之二 measured that search volume is not
 *      a strength knob;
 *   4. cap ladder monotone: cap(高手) < cap(进阶) <= cap(业余) (大师 is 0 by definition);
 *   5. the REACHABLE worst move (cap + mistakeBand, normal branch) is ordered the same way — a
 *      bigger band on a stronger rung would let it play a move worse than the rung below it;
 *   6. no two rungs may be the SAME rule (same cap/p/band/overrides): the ladder would silently
 *      lose a level while the UI still shows five;
 *   7. where two adjacent rungs share a cap (the contract's 业余/进阶 pair) they must differ by p,
 *      in the right direction: the weaker one has the strictly larger p;
 *   8. hardCap <= cap: 少子形 (HARD) may never be looser than the normal branch (hardCap 0 is the
 *      measured safe value, bench/NEW_ENGINE_TIER_CALIBRATION.md).
 * openingCap / openingMistakeBand are per-class overrides with their own measured values, so they
 * are type-checked but deliberately NOT part of the ordering claim.
 * --------------------------------------------------------------------------- */
function capLadderGate(levels, src) {
  const reasons = [];
  const names = LEVEL_TIER;
  const ENGINE = [1, 2, 3];
  const SEQ = [4, 3, 2, 1];
  const bad = (s) => reasons.push(s);
  const label = (i) => names[i] + '(level ' + i + ')';

  // ---- 1. shape and value ranges ----
  for (const i of SEQ) {
    const c = levels && levels[i];
    if (!c) { bad('level ' + i + ' (' + names[i] + ') missing'); continue; }
    for (const f of ['multipv', 'movetime', 'hash']) {
      if (!isNum(c[f])) bad(label(i) + ': ' + f + ' is ' + JSON.stringify(c[f]) + ' (must be a number)');
    }
    if (c.kind === 'master') {
      if (c.cap !== undefined) bad(label(i) + ': 大师 must not have a cap (it is the ceiling, not a rung)');
      if (c.p !== undefined) bad(label(i) + ': 大师 must not have p');
      if (c.multipv !== 1) bad(label(i) + ': 大师 must be MultiPV 1 (got ' + JSON.stringify(c.multipv) + ')');
      continue;
    }
    if (!isNum(c.cap) || c.cap < 0) bad(label(i) + ': cap must be a number >= 0 (got ' + JSON.stringify(c.cap) + ')');
    if (!isNum(c.p) || c.p < 0 || c.p >= 1) bad(label(i) + ': p must be in [0,1) (got ' + JSON.stringify(c.p) + ')');
    if (!isNum(c.mistakeBand) || c.mistakeBand <= 0) bad(label(i) + ': mistakeBand must be > 0 (got ' + JSON.stringify(c.mistakeBand) + ')');
    if (c.multipv !== undefined && c.multipv <= 1) bad(label(i) + ': engine tier needs MultiPV > 1 (no candidate pool otherwise)');
    for (const f of ['openingCap', 'hardCap']) {
      if (c[f] !== undefined && (!isNum(c[f]) || c[f] < 0)) bad(label(i) + ': ' + f + ' must be a number >= 0');
    }
    for (const f of ['openingMistakeBand', 'hardMistakeBand']) {
      if (c[f] !== undefined && (!isNum(c[f]) || c[f] <= 0)) bad(label(i) + ': ' + f + ' must be > 0');
    }
    // ---- 8. 少子形 is never looser than the normal branch ----
    if (isNum(c.hardCap) && isNum(c.cap) && c.hardCap > c.cap) {
      bad(label(i) + ': hardCap ' + c.hardCap + ' > cap ' + c.cap + ' (少子形 must not be looser than the normal branch)');
    }
  }
  if (reasons.length) return { ok: false, reasons: reasons, ladder: 'incomplete' };

  // ---- 2/3. ONE shared search budget for the engine tiers ----
  const sig = (i) => levels[i].multipv + '/' + levels[i].movetime + 'ms/Hash' + levels[i].hash;
  const sigs = ENGINE.map(sig);
  if (new Set(sigs).size !== 1) {
    bad('the three engine tiers must share ONE search budget, got ' + ENGINE.map((i, k) => names[i] + ' ' + sigs[k]).join(' vs '));
  }
  const B = src && src.fixedSearchBudget;
  if (B) {
    const pairs = [['multipv', B.multipv], ['movetime', B.movetime], ['hash', B.hash]];
    for (const [f, want] of pairs) {
      if (!isNum(want)) continue;
      for (const i of ENGINE) {
        if (levels[i][f] !== want) bad(label(i) + ': ' + f + ' ' + levels[i][f] + ' != fixedSearchBudget ' + want);
      }
    }
  }

  // ---- 4. cap ladder ----
  const cap = (i) => (levels[i].kind === 'master' ? 0 : levels[i].cap);
  for (let k = 1; k < SEQ.length; k++) {
    const a = SEQ[k - 1], b = SEQ[k];
    // 业余 may share 进阶's cap (the contract's "same stable strength, plus mistakes"); every
    // other adjacent pair must be strictly ordered.
    const strict = b !== 1;
    const okOrder = strict ? cap(a) < cap(b) : cap(a) <= cap(b);
    if (!okOrder) {
      bad('cap ladder not monotone: cap(' + names[a] + ')=' + cap(a) + ' must be ' + (strict ? '<' : '<=') +
        ' cap(' + names[b] + ')=' + cap(b));
    }
  }

  // ---- 5. reachable worst move (normal branch) ----
  const reach = (i) => (levels[i].kind === 'master' ? 0 : levels[i].cap + levels[i].mistakeBand);
  for (let k = 1; k < SEQ.length; k++) {
    const a = SEQ[k - 1], b = SEQ[k];
    if (!(reach(a) <= reach(b))) {
      bad('reachable worst move not monotone: ' + names[a] + ' ' + reach(a) + 'cp must be <= ' + names[b] + ' ' +
        reach(b) + 'cp (cap+band would let the stronger tier play a worse move than the tier below it)');
    }
  }

  // ---- 6. no two rungs may be the same rule ----
  const ruleOf = (i) => JSON.stringify([cap(i), levels[i].p, levels[i].mistakeBand,
    levels[i].openingCap, levels[i].openingMistakeBand, levels[i].hardCap, levels[i].hardMistakeBand]);
  for (let x = 0; x < ENGINE.length; x++) {
    for (let y = x + 1; y < ENGINE.length; y++) {
      if (ruleOf(ENGINE[x]) === ruleOf(ENGINE[y])) {
        bad(names[ENGINE[x]] + ' and ' + names[ENGINE[y]] + ' are the SAME rule — the ladder would have a duplicate rung');
      }
    }
  }

  // ---- 7. adjacent rungs with the same cap differ by p, in the right direction ----
  for (let k = 1; k < SEQ.length; k++) {
    const a = SEQ[k - 1], b = SEQ[k];
    if (levels[a].kind === 'master' || levels[b].kind === 'master') continue;
    if (cap(a) === cap(b) && !(levels[a].p < levels[b].p)) {
      bad(names[a] + ' and ' + names[b] + ' share cap ' + cap(a) + ', so the weaker one (' + names[b] +
        ') must have a strictly larger p (' + levels[a].p + ' vs ' + levels[b].p + ')');
    }
  }

  const ladder = 'cap ' + SEQ.map(cap).join(' < ') +
    '  reachable ' + SEQ.map(reach).join(' <= ') +
    '  p ' + SEQ.map((i) => (levels[i].kind === 'master' ? '-' : levels[i].p)).join('/') +
    '  budget ' + ENGINE.map(sig).join(' == ');
  return { ok: reasons.length === 0, reasons: reasons, ladder: ladder };
}

/* Build the per-level config the bridge consumes (same field selection the writer uses). */
function buildLevels(src) {
  const names = XQ.LEVELS.map((L) => L.name);
  const levels = {};
  const problems = [];
  for (const idx of Object.keys(LEVEL_TIER)) {
    const tierName = LEVEL_TIER[idx];
    if (names[+idx] !== tierName) {
      problems.push('engine.js LEVELS[' + idx + '] is "' + names[idx] + '" but the decision file tier is "' + tierName + '"');
      continue;
    }
    const t = src[tierName];
    if (!t) { problems.push(tierName + ' missing in ' + SRC); continue; }
    const cfg = {};
    for (const f of FIELDS) if (t[f] !== undefined) cfg[f] = t[f];
    for (const need of ['multipv', 'movetime', 'hash']) {
      if (cfg[need] === undefined) problems.push(tierName + ' has no ' + need);
    }
    if (cfg.kind !== 'master') {
      for (const need of ['cap', 'p', 'mistakeBand']) {
        if (cfg[need] === undefined) problems.push(tierName + ' has no ' + need);
      }
    }
    levels[idx] = Object.assign({ name: tierName }, cfg);
  }
  return { levels: levels, problems: problems };
}

function main() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const src = JSON.parse(raw);
  const sha = crypto.createHash('sha256').update(raw).digest('hex');

  const built = buildLevels(src);
  for (const p of built.problems) { console.error('ABORT: ' + p); process.exit(1); }

  // predicted-loss gate (same order tier_decide.js enforces) — needs the fitted model
  const pred = src.predictedLoss || {};
  const order = ['大师', '高手', '进阶', '业余'].map((n) => (pred[n] && pred[n].all));
  if (order.some((v) => typeof v !== 'number')) { console.error('ABORT: predictedLoss incomplete'); process.exit(1); }
  for (let i = 1; i < order.length; i++) {
    if (!(order[i - 1] < order[i])) {
      console.error('ABORT: monotonicity gate FAILED ' + order.join(' < '));
      process.exit(1);
    }
  }

  // cap monotonicity gate (parameters only) — card t_0918db73
  const gate = capLadderGate(built.levels, src);
  if (!gate.ok) {
    console.error('ABORT: cap monotonicity gate FAILED');
    for (const r of gate.reasons) console.error('  - ' + r);
    process.exit(1);
  }
  console.log('cap gate PASS  ' + gate.ladder);

  const out = { source: 'bench/new_engine/tier_tiers.json', sha256: sha, generated: new Date().toISOString(), levels: built.levels };
  const body =
    '/* tier_config.js — GENERATED FILE, do not hand-edit.\n' +
    ' * source: bench/new_engine/tier_tiers.json (sha256 ' + sha.slice(0, 16) + '…)\n' +
    ' * regenerate: node bench/new_engine/gen_tier_config.js\n' +
    ' * contract (bench/TIER_DESIGN_FINAL.md): cap / p / mistakeBand are the only strength knobs;\n' +
    ' * movetime+Hash are a fixed budget per tier, not the ladder. 大师 is the ceiling (MultiPV 1).\n' +
    ' */\n' +
    '(function (root) {\n' +
    "  'use strict';\n" +
    '  root.PF_TIERS = ' + JSON.stringify(out, null, 1) + ';\n' +
    "})(typeof window !== 'undefined' ? window : this);\n";

  fs.writeFileSync(OUT, body);
  console.log('wrote ' + OUT);
  for (const idx of Object.keys(out.levels)) {
    const c = out.levels[idx];
    console.log('  level ' + idx + ' ' + c.name + ': ' + (c.kind === 'master'
      ? 'MultiPV' + c.multipv + ' movetime' + c.movetime + ' Hash' + c.hash
      : 'cap' + c.cap + ' p' + c.p + ' band' + c.mistakeBand + ' @ MultiPV' + c.multipv + '/' + c.movetime + 'ms/Hash' + c.hash));
  }
}

module.exports = { capLadderGate: capLadderGate, buildLevels: buildLevels, LEVEL_TIER: LEVEL_TIER, SRC: SRC, OUT: OUT };

if (require.main === module) main();
