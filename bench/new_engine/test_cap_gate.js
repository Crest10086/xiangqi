/* new_engine/test_cap_gate.js — unit tests for the CAP MONOTONICITY GATE (card t_0918db73).
 *
 * Why this gate exists: the whole tier design rests on one sentence from the calibration contract
 * (bench/TIER_DESIGN_FINAL.md, tier_decide.js header): cap / p / mistakeBand are the ONLY strength
 * knobs, and movetime/Hash are a fixed search budget per tier, NOT the ladder. The predictedLoss
 * gate in tier_decide.js checks that sentence through a fitted model, which needs
 * tier_fit_out.json + the calibration logs. A plain clone of this repo has the decision file and
 * none of that, so a hand-edit of tier_tiers.json (swap two caps, give one rung a bigger movetime)
 * could reach js/tier_config.js unchecked. This gate reads the PARAMETERS ONLY.
 *
 * What must fail (measured rungs are 大师 cap 0 | 高手 25 | 进阶 80/p0 | 业余 80/p0.5, all at
 * MultiPV8/300ms/Hash64; 大师 is MultiPV1/2000ms/Hash256):
 *   - a cap ladder that is not 大师 0 < 高手 < 进阶 <= 业余
 *   - a reachable-worst-move ladder (cap + mistakeBand) that is not ordered the same way
 *   - two rungs that are the SAME rule (same cap/p/band) — the ladder silently collapses to four
 *     levels where two of them play identically
 *   - an engine tier whose search budget differs from the other engine tiers (movetime would then
 *     be doing the ladder's job, which bench/FINAL_REPORT.md 基准三之二 measured to be false)
 *   - hardCap > cap (少子形 must never be looser than the normal branch; hardCap 0 is the measured
 *     safe value, bench/NEW_ENGINE_TIER_CALIBRATION.md)
 *   - cap/p/mistakeBand that are not numbers, p outside [0,1), a mistakeBand <= 0
 *   - 大师 given a cap or MultiPV > 1 (it is the ceiling, not a rung)
 *
 * Run: node bench/new_engine/test_cap_gate.js
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const GEN = require(path.join(__dirname, 'gen_tier_config.js'));

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log(' FAIL  ' + name); }
}

t('gen_tier_config.js exports capLadderGate (and requiring it does not rewrite js/tier_config.js)',
  typeof GEN.capLadderGate === 'function');

// ---- the gate on the REAL decision file, exactly as the generator would build it ----
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, 'tier_tiers.json'), 'utf8'));
const levels = {};
for (const [idx, name] of Object.entries(GEN.LEVEL_TIER)) {
  levels[idx] = Object.assign({ name: name }, SRC[name]);
}
const real = GEN.capLadderGate(levels, SRC);
console.log('    real decision file gate: ' + JSON.stringify(real));
t('the decided ladder passes the gate', real.ok === true && real.reasons.length === 0);
t('the gate reports the ladder it checked (cap + reachable worst move)',
  typeof real.ladder === 'string' && /0/.test(real.ladder) && /25/.test(real.ladder) && /80/.test(real.ladder));

// ---- synthetic ladders that must be REJECTED ----
const base = () => JSON.parse(JSON.stringify(levels));
function gate(mutate, srcOverride) {
  const l = base();
  mutate(l);
  return GEN.capLadderGate(l, srcOverride || SRC);
}

{
  const r = gate((l) => { l[2].cap = 20; l[3].cap = 25; }); // 进阶(20) below 高手(25)
  t('rejects a cap ladder where 进阶 < 高手 (20 < 25)', r.ok === false && /cap/i.test(r.reasons.join(' ')));
}
{
  const r = gate((l) => { l[3].cap = 80; }); // 高手 == 进阶 cap
  t('rejects 高手 cap == 进阶 cap (two rungs would be the same stable strength)', r.ok === false);
}
{
  const r = gate((l) => { l[4].cap = 0; l[3].cap = 25; l[2].cap = 80; l[1].cap = 80; l[1].p = 0; });
  t('rejects 业余 == 进阶 as a rule (same cap AND same p => the ladder has a duplicate rung)', r.ok === false);
}
{
  const r = gate((l) => { l[2].mistakeBand = 0; });
  t('rejects mistakeBand 0 (a mistake could not exist; the p dimension would be dead)', r.ok === false);
}
{
  const r = gate((l) => { l[3].mistakeBand = 1000; }); // reachable 高手 1025 > 进阶 280
  t('rejects a reachable worst move (cap+band) that outranks the rung above it', r.ok === false);
}
{
  const r = gate((l) => { l[1].movetime = 1500; });
  t('rejects an engine tier with a different movetime (movetime would become the ladder)', r.ok === false);
}
{
  const r = gate((l) => { l[1].hash = 256; });
  t('rejects an engine tier with a different Hash (same reason)', r.ok === false);
}
{
  const r = gate((l) => { l[1].multipv = 1; });
  t('rejects an engine tier with MultiPV 1 (no candidate pool => cap/p cannot work)', r.ok === false);
}
{
  const r = gate((l) => { l[1].hardCap = 120; }); // hardCap > cap 80
  t('rejects hardCap > cap (少子形 looser than the normal branch)', r.ok === false);
}
{
  const r = gate((l) => { l[4].cap = 300; });
  t('rejects 大师 being given a cap (it is the ceiling, not a rung)', r.ok === false);
}
{
  const r = gate((l) => { l[4].multipv = 8; });
  t('rejects 大师 with MultiPV > 1', r.ok === false);
}
{
  const r = gate((l) => { l[3].p = 1.5; });
  t('rejects p outside [0,1)', r.ok === false);
}
{
  const r = gate((l) => { l[3].cap = '80'; });
  t('rejects a cap that is not a number (a hand-edited JSON string)', r.ok === false);
}
{
  const r = gate((l) => { delete l[2].cap; });
  t('rejects a missing cap on an engine tier', r.ok === false);
}
{
  const r = gate((l) => { l[3].mistakeBand = -200; });
  t('rejects a negative mistakeBand (cap+band would be below cap)', r.ok === false);
}

// ---- the budget must also agree with the decision file's own fixedSearchBudget ----
{
  const bad = JSON.parse(JSON.stringify(SRC));
  bad.fixedSearchBudget = { movetime: 500, multipv: 8, hash: 64, threads: 4 };
  const r = GEN.capLadderGate(levels, bad);
  t('rejects tiers whose parameters disagree with the decision file fixedSearchBudget', r.ok === false);
}

// ---- the gate must be independent of the fitted model: no predictedLoss needed ----
{
  const noModel = JSON.parse(JSON.stringify(SRC));
  delete noModel.predictedLoss;
  const r = GEN.capLadderGate(levels, noModel);
  t('the gate does NOT need predictedLoss/tier_fit_out.json (works in a clone with only the JSON)', r.ok === true);
}

// ---- the generator really refuses to write when the gate fails ----
{
  const GEN_SRC = fs.readFileSync(path.join(__dirname, 'gen_tier_config.js'), 'utf8');
  t('gen_tier_config.js calls the gate before writing js/tier_config.js',
    /capLadderGate\(/.test(GEN_SRC) &&
    /capLadderGate\([\s\S]{0,400}process\.exit\(1\)/.test(GEN_SRC));
  t('gen_tier_config.js only writes when run directly (requiring it in a test has no side effect)',
    /require\.main\s*===\s*module/.test(GEN_SRC));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
