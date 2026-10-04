/* new_engine/alt_verify.js — TEST-ONLY checks for card t_9f14af96.
 * 1) Realized-vs-designed random-move rate for the noise rule: recompute pick() offline over the
 *    exact seeds the driver used and compare with the logged hit counts (is p honoured?).
 * 2) Blunder rate per config: fraction of played moves with loss > 300 cp (loses a piece) —
 *    "does the weak tier actually blunder like an amateur" is a gameplay question, not a mean question.
 * 3) Realized degradation (gap) vs the configured cap/temperature: is the knob a ceiling or a target?
 */
const fs = require('fs');
const path = require('path');
const R = require('./alt_rules.js');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', process.env.ANALYSIS || 'alt_analysis.json'), 'utf8'));
const LOGS = (process.env.LOGS || 'ac_r1.log,ac_r2.log,ac_r3.log').split(',');
const TASKF = process.env.TASKF || 'task_ac_r1.json';
const task = JSON.parse(fs.readFileSync(path.join(__dirname, TASKF), 'utf8'));
const SEED0 = task.seedSalt;

/* ---- 1) noise rate: replay the exact driver seeds offline ---- */
const cfgs = {};
for (const c of task.configs) cfgs[c.id] = c;
const posById = {};
for (const p of task.positions) posById[p.id] = p;

const rows = [];
for (const f of LOGS) {
  for (const l of fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', f), 'utf8').split(/\r?\n/)) {
    if (!l.startsWith('L|') || l.indexOf('|SEL|') < 0) continue;
    const parts = l.split('|');
    const fields = {};
    for (const kv of parts.slice(5)) { const i = kv.indexOf('='); if (i > 0) fields[kv.slice(0, i)] = kv.slice(i + 1); }
    rows.push({ round: +parts[1], pos: parts[2], cfg: parts[3], fields });
  }
}
console.log('=== 1) randomized rules: designed p vs realized rate (offline replay of the exact seeds) ===');
for (const cfg of task.configs) {
  const cfgId = cfg.id;
  if (cfg.rule !== 'noise' && cfg.rule !== 'capnoise' && cfg.rule !== 'boundednoise') continue;
  let n = 0, randLogged = 0, randReplay = 0, mismatch = 0;
  let brandCount = 0, probesRun = 0, fullMismatch = 0; const capViol = [], acceptSizes = [], probeNodes = [], probeDepth = [];
  for (const r of rows) {
    if (r.cfg !== cfgId) continue;
    n++;
    if (r.fields.hit === 'rand') randLogged++;
    // rebuild the pool from the logged slot scores + the logged seed and replay the rule
    const pool = { slots: {}, bestmove: r.fields.move };
    for (const s of String(r.fields.slots).split(',')) {
      const [k, v] = s.split(':');
      pool.slots[+k] = { score: +v, pv: ['placeholder'] };
    }
    if (cfg.rule === 'boundednoise') {
      // Full offline replay: the main pool's moves (pmoves) and, when a judge probe ran, the judge
      // pool's moves (qmoves) are both logged, so pick() can be re-run here with the same seed and
      // must reproduce the logged move and hit exactly.
      const poolMv = { slots: {}, bestmove: r.fields.move };
      for (const kv of String(r.fields.slots).split(',')) { const [k, v] = kv.split(':'); poolMv.slots[+k] = { score: +v, pv: ['-'] }; }
      for (const kv of String(r.fields.pmoves || '').split(',')) {
        if (!kv || kv.indexOf(':') < 0) continue;
        const [k, mv] = kv.split(':');
        if (poolMv.slots[+k]) poolMv.slots[+k].pv = [mv];
      }
      let probeMv = null;
      if (String(r.fields.qmoves || '') !== '-' && String(r.fields.qmoves || '').length > 1) {
        probeMv = { slots: {}, bestmove: null };
        const sc = {}; for (const kv of String(r.fields.pslots || '').split(',')) { const [k, v] = kv.split(':'); if (Number.isFinite(+v)) sc[+k] = +v; }
        for (const kv of String(r.fields.qmoves).split(',')) {
          if (!kv || kv.indexOf(':') < 0) continue;
          const [k, mv] = kv.split(':');
          probeMv.slots[+k] = { score: sc[+k] === undefined ? 0 : sc[+k], pv: [mv] };
        }
      }
      const sel2 = R.pick(cfg, poolMv, posById[r.pos], +r.fields.seed, probeMv);
      if (sel2.move !== r.fields.move || sel2.hit !== r.fields.hit) fullMismatch++;
      const fired = R.willRandom(cfg, +r.fields.seed);
      const loggedFired = r.fields.hit === 'brand' || r.fields.hit === 'bmiss';
      if (fired !== loggedFired) mismatch++;
      if (fired) randReplay++;
      if (r.fields.hit === 'brand') {
        brandCount++;
        // agap lives inside probs (the rule's own meta string)
        const agm = String(r.fields.probs || '').match(/,agap=(-?\d+)/);
        const ag = agm ? +agm[1] : NaN;
        if (!Number.isFinite(ag) || ag > cfg.cap) capViol.push([r.pos, ag]);
        const an = String(r.fields.probs || '').match(/,accept=(\d+)/);
        if (an) acceptSizes.push(+an[1]);
        const pn = +r.fields.pnodes;
        if (Number.isFinite(pn)) probeNodes.push(pn);
        const pd = +r.fields.pdepth;
        if (Number.isFinite(pd)) probeDepth.push(pd);
        if (String(r.fields.pslots || '') !== '-') probesRun++;
      }
      continue;
    }
    const sel = R.pick(cfg, pool, posById[r.pos], +r.fields.seed);
    if ((sel.hit === 'rand') !== (r.fields.hit === 'rand')) mismatch++;
    if (sel.hit === 'rand') randReplay++;
  }
  console.log(cfgId + ' (' + cfg.rule + ') designed p=' + cfg.p + ' logged rand=' + randLogged + '/' + n + ' (' + (randLogged / n).toFixed(3) + ')' +
    ' offline-replay rand=' + randReplay + '/' + n + ' (' + (randReplay / n).toFixed(3) + ')' +
    ' hit-flag mismatches=' + mismatch);
  if (cfg.rule === 'boundednoise') {
    console.log('   full offline replay (same seed + logged pools/judge): move+hit mismatches=' + fullMismatch);
    const am = acceptSizes.length ? (acceptSizes.reduce((a, b) => a + b, 0) / acceptSizes.length).toFixed(2) : 'n/a';
    console.log('   bounded branch: brand=' + brandCount + ' judgedGap>cap=' + capViol.length + ' ' + JSON.stringify(capViol) +
      ' acceptSet mean=' + am + ' min=' + (acceptSizes.length ? Math.min(...acceptSizes) : 'n/a') + ' max=' + (acceptSizes.length ? Math.max(...acceptSizes) : 'n/a'));
    console.log('   judge cost: probe searches run=' + probesRun + ' nodes/step mean=' +
      (probeNodes.length ? Math.round(probeNodes.reduce((a, b) => a + b, 0) / probeNodes.length) : 'n/a') +
      ' max=' + (probeNodes.length ? Math.max(...probeNodes) : 'n/a') +
      ' depth max=' + (probeDepth.length ? Math.max(...probeDepth) : 'n/a') + ' (gapmode=' + (cfg.gapmode || 'probe') + ')');
  }
}
// unbiased sampling check: same rule, 100k synthetic draws at the same seeds pattern
{
  const cfg = { rule: 'noise', p: 0.25, base: 4 };
  const pos = { legal: Array.from({ length: 40 }, (_, i) => 'l' + i + 'x') };
  const pool = { slots: { 1: { score: 0, pv: ['a'] }, 4: { score: -10, pv: ['d'] } }, bestmove: 'a' };
  let hits = 0, N = 100000;
  for (let i = 0; i < N; i++) if (R.pick(cfg, pool, pos, R.strHash(i + '|x|NOI_AM') ^ SEED0).hit === 'rand') hits++;
  console.log('synthetic 100k draws at the same seed construction: rate=' + (hits / N).toFixed(4) + ' (designed 0.25)');
}

/* ---- 2) blunder rate + error-size profile per config ---- */
console.log('\n=== 2) played-move quality profile (loss buckets, all positions/rounds) ===');
const CFGS = Object.keys(A.all).sort((a, b) => (a === 'ANCH' ? 1 : 0) - (b === 'ANCH' ? 1 : 0) || a.localeCompare(b));
console.log('cfg      | n  | loss<=10 | 11-50 | 51-150 | 151-300 | >300(blunder) | meanLoss');
for (const cfg of CFGS) {
  const buckets = { ok: 0, s: 0, m: 0, b: 0, blunder: 0 };
  let n = 0, sum = 0;
  for (const r of A.rounds) {
    for (const d of A.all[cfg].perRound[r].detail) {
      n++; sum += d.loss;
      if (d.loss <= 10) buckets.ok++;
      else if (d.loss <= 50) buckets.s++;
      else if (d.loss <= 150) buckets.m++;
      else if (d.loss <= 300) buckets.b++;
      else buckets.blunder++;
    }
  }
  if (!n) continue;
  const pct = (x) => (100 * x / n).toFixed(0) + '%';
  console.log(cfg.padEnd(8) + '| ' + String(n).padStart(3) + ' | ' + pct(buckets.ok).padStart(9) + ' | ' + pct(buckets.s).padStart(6) +
    ' | ' + pct(buckets.m).padStart(7) + ' | ' + pct(buckets.b).padStart(8) + ' | ' + pct(buckets.blunder).padStart(13) +
    ' | ' + (sum / n).toFixed(1));
}

/* ---- 3) knob calibration: configured cap/T vs realized degradation ---- */
console.log('\n=== 3) knob calibration ===');
for (const cfg of task.configs) {
  const id = cfg.id;
  if (!A.cost[id] || !A.cost[id].gapStat) continue;
  const g = A.cost[id].gapStat;
  if (cfg.rule === 'cap') {
    console.log(id + ' configured cap=' + cfg.cap + ' -> realized gap mean=' + g.mean + ' median=' + g.median + ' max=' + g.max +
      ' (ceiling, not target; realized ~' + (100 * g.mean / cfg.cap).toFixed(0) + '% of cap)');
  } else if (cfg.rule === 'capnoise') {
    const rd = A.ruleDiag[id] || {};
    const engineN = (rd.capBranchShare || 0) * (g.n || 0);
    console.log(id + ' cap=' + cfg.cap + ' p=' + cfg.p + ' -> realized randShare=' + rd.randShare +
      ' gap(engine branch only) mean=' + g.mean + ' median=' + g.median + ' max=' + g.max +
      ' [gapStat n=' + g.n + ' = engine branch only, cap ceiling honoured: violations=' + JSON.stringify(rd.capViolations || []) + ']' +
      ' capDegenerate(->slot1)=' + rd.capDegenerateShare);
  } else if (cfg.rule === 'boundednoise') {
    const rd = A.ruleDiag[id] || {};
    const gs = rd.judgedGapStat || {};
    console.log(id + ' cap=' + cfg.cap + ' p=' + cfg.p + ' gapmode=' + (cfg.gapmode || 'probe') +
      ' -> realized brandShare=' + rd.brandShare + ' bmissShare=' + rd.bmissShare +
      ' acceptSet mean=' + rd.acceptSetMean + ' min=' + rd.acceptSetMin +
      ' judged gap of played random moves mean=' + gs.mean + ' max=' + gs.max +
      ' cap violations=' + JSON.stringify(rd.capViolations || []) +
      ' judge probes run=' + (rd.judge || {}).probesRun + ' nodes/probe=' + (rd.judge || {}).pnodesMean);
  } else if (cfg.rule === 'temp') {
    console.log(id + ' configured T=' + cfg.T + ' -> analytic E[gap]=' + (A.ruleDiag[id] || {}).meanExpectedGap +
      ' realized gap mean=' + g.mean + ' median=' + g.median + ' max=' + g.max +
      ' P(slot1)=' + (A.ruleDiag[id] || {}).meanProbSlot1);
  }
}

/* ---- 4) search cost of MultiPV=8 vs the baseline tiers ---- */
console.log('\n=== 4) search cost (nodes per move) ===');
for (const cfg of CFGS) {
  const c = A.cost[cfg];
  console.log(cfg.padEnd(8) + ' multipv=' + (cfgs[cfg] ? cfgs[cfg].multipv : '-') + ' movetime=' + (cfgs[cfg] ? cfgs[cfg].movetime : '-') +
    ' nodesMean=' + c.nodesMean + ' depth=' + c.depthMin + '-' + c.depthMax);
}
