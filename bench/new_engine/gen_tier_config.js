/* new_engine/gen_tier_config.js — turn the decided parameters into the production config file.
 *
 * Card t_9c93fb06 (接入线上): the wiring must follow bench/new_engine/tier_tiers.json, and the
 * values must not be hand-copied into js/ (that is how two sources drift apart). This script reads
 * the machine-readable decision file and writes js/tier_config.js, which js/pikafish_bridge.js reads.
 *
 *   node bench/new_engine/gen_tier_config.js          -> writes js/tier_config.js
 *
 * Guards:
 *  - refuses to write unless the tier names match engine.js LEVELS[1..4] (a rename would silently
 *    bind the wrong parameters to a UI level);
 *  - refuses to write unless the monotonicity order 大师 < 高手 < 进阶 < 业余 from the decision file
 *    still holds (same gate tier_decide.js uses);
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

const raw = fs.readFileSync(SRC, 'utf8');
const src = JSON.parse(raw);
const sha = crypto.createHash('sha256').update(raw).digest('hex');

const names = XQ.LEVELS.map((L) => L.name);
const out = { source: 'bench/new_engine/tier_tiers.json', sha256: sha, generated: new Date().toISOString(), levels: {} };
for (const idx of Object.keys(LEVEL_TIER)) {
  const tierName = LEVEL_TIER[idx];
  if (names[+idx] !== tierName) {
    console.error('ABORT: engine.js LEVELS[' + idx + '] is "' + names[idx] + '" but the decision file tier is "' + tierName + '"');
    process.exit(1);
  }
  const t = src[tierName];
  if (!t) { console.error('ABORT: ' + tierName + ' missing in ' + SRC); process.exit(1); }
  const cfg = {};
  for (const f of FIELDS) if (t[f] !== undefined) cfg[f] = t[f];
  for (const need of ['multipv', 'movetime', 'hash']) {
    if (cfg[need] === undefined) { console.error('ABORT: ' + tierName + ' has no ' + need); process.exit(1); }
  }
  if (cfg.kind !== 'master') {
    for (const need of ['cap', 'p', 'mistakeBand']) {
      if (cfg[need] === undefined) { console.error('ABORT: ' + tierName + ' has no ' + need); process.exit(1); }
    }
  }
  out.levels[idx] = Object.assign({ name: tierName }, cfg);
}

// monotonicity gate (same order tier_decide.js enforces): predicted average loss must increase
const pred = src.predictedLoss || {};
const order = ['大师', '高手', '进阶', '业余'].map((n) => (pred[n] && pred[n].all));
if (order.some((v) => typeof v !== 'number')) { console.error('ABORT: predictedLoss incomplete'); process.exit(1); }
for (let i = 1; i < order.length; i++) {
  if (!(order[i - 1] < order[i])) {
    console.error('ABORT: monotonicity gate FAILED ' + order.join(' < '));
    process.exit(1);
  }
}

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
