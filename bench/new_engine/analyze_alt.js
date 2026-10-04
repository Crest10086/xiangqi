/* new_engine/analyze_alt.js — TEST-ONLY analyzer for card t_9f14af96.
 * Usage: node analyze_alt.js alt_smoke.log alt_r1.log alt_r2.log ...
 *
 * Metric identical to the baseline card t_ef6e93b8:
 *   loss(pos,cfg,round) = anchor_score + ref_score_after_chosen_move   (lower = stronger)
 *
 * Adds, relative to analyze_levels.js:
 *   - per-config stats incl. per-round means (so randomized schemes can be judged on mean stability)
 *   - noise floor from the ANCH control (same move as the anchor itself -> loss should be ~0)
 *   - pairwise strength deltas (a - b in cp) with a noise-aware verdict
 *   - per-position separability classification with the baseline's 20 cp threshold
 *   - rule diagnostics: cap 'hit' distribution, softmax weight mass, noise hit rate, slotUsed histogram
 *   - cross-round move instability + per-position loss std per config
 *   - search cost (depth/nodes) per config, i.e. the price of MultiPV=8
 * Writes new_engine_logs/alt_analysis.json and prints human-readable tables.
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
const rows = [];

for (const f of files) {
  const txt = fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', f), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    if (!line.startsWith('L|')) continue;
    const parts = line.split('|');
    const round = +parts[1], pos = parts[2], cfgOrAnchor = parts[3];
    let cfg, type, fieldStart;
    if (cfgOrAnchor === 'ANCHOR') { cfg = 'ANCHOR'; type = 'ANCHOR'; fieldStart = 4; }
    else { cfg = cfgOrAnchor; type = parts[4]; fieldStart = 5; }
    const fields = {};
    for (const kv of parts.slice(fieldStart)) { const i = kv.indexOf('='); if (i > 0) fields[kv.slice(0, i)] = kv.slice(i + 1); }
    rows.push({ round, pos, cfg, type, fields, file: f });
  }
}

const taskFile = files.length ? null : null;
const posDefs = JSON.parse(fs.readFileSync(path.join(__dirname, 'level_positions.json'), 'utf8'));
const groupOf = {};
for (const p of posDefs) groupOf[p.id] = p.group;

/* configs are taken from the logs themselves (sorted: controls first, then experiments),
 * so the same analyzer works for the previous card's task_alt logs and this card's task_ac / task_calib logs. */
const OUT_CFGS = [...new Set(rows.filter(r => r.cfg !== 'ANCHOR').map(r => r.cfg))]
  .sort((a, b) => (a === 'ANCH' ? 1 : 0) - (b === 'ANCH' ? 1 : 0) || a.localeCompare(b));
console.log('configs found in logs: ' + JSON.stringify(OUT_CFGS));

const rounds = [...new Set(rows.map(r => r.round))].sort((a, b) => a - b);
const groups = ['opening', 'midgame'];
const posIdsOf = (g) => posDefs.filter(x => x.group === g).map(x => x.id);
const allPosIds = posDefs.map(x => x.id);

function stat(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  return { n: arr.length, mean: +mean.toFixed(1), median: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1], sd: +sd.toFixed(1) };
}

const out = { rounds, perGroup: {}, all: {}, noiseFloor: null, deltas: {}, sep: {}, ruleDiag: {}, instability: {}, cost: {}, skips: [], crit: 0 };

function lossOf(round, pid, cfg) {
  const anchor = rows.find(x => x.round === round && x.pos === pid && x.type === 'ANCHOR');
  const sel = rows.find(x => x.round === round && x.pos === pid && x.cfg === cfg && x.type === 'SEL');
  const ref = rows.find(x => x.round === round && x.pos === pid && x.cfg === cfg && x.type === 'REF');
  if (!anchor || !sel || !ref) { out.skips.push({ round, pid, cfg, why: 'missing row' }); return null; }
  // the engine does not reset the position after a rejected FEN, so a REF with CRITICAL ERROR is unusable
  if (+ref.fields.crit > 0 || +sel.fields.crit > 0 || +anchor.fields.crit > 0) { out.skips.push({ round, pid, cfg, why: 'crit' }); return null; }
  const loss = (+anchor.fields.score) + (+ref.fields.score);
  return { loss, anchor: +anchor.fields.score, ref: +ref.fields.score, selMove: sel.fields.move, gap: sel.fields.gap, hit: sel.fields.hit, slotUsed: sel.fields.slotUsed, rule: sel.fields.rule,
           // boundednoise extras: judge accept-set size and the judged degradation of the played move
           probs: sel.fields.probs, agap: sel.fields.agap, pnodes: sel.fields.pnodes };
}

for (const cfg of OUT_CFGS) {
  out.all[cfg] = { overall: [], perRound: {} };
  for (const r of rounds) {
    const det = [];
    for (const pid of allPosIds) {
      const d = lossOf(r, pid, cfg);
      if (d) det.push({ pid, ...d });
    }
    out.all[cfg].perRound[r] = { stat: stat(det.map(x => x.loss)), detail: det };
    out.all[cfg].overall.push(...det.map(x => x.loss));
  }
  out.all[cfg].overall = stat(out.all[cfg].overall);
  // per-round means (stability of the expected strength for randomized rules)
  out.all[cfg].roundMeans = rounds.map(r => out.all[cfg].perRound[r].stat && out.all[cfg].perRound[r].stat.mean);
  const rms = out.all[cfg].roundMeans.filter(x => x !== null);
  out.all[cfg].roundMeanSpread = rms.length ? +(Math.max(...rms) - Math.min(...rms)).toFixed(1) : null;
  // per-position loss sd across rounds (single-game variance)
  const perPos = {};
  for (const r of rounds) for (const d of out.all[cfg].perRound[r].detail) (perPos[d.pid] = perPos[d.pid] || []).push(d.loss);
  const sds = Object.values(perPos).filter(a => a.length >= 2).map(a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); });
  out.all[cfg].perPosSdMean = sds.length ? +(sds.reduce((a, b) => a + b, 0) / sds.length).toFixed(1) : null;
  // move instability across rounds
  let tot = 0, unstable = 0;
  for (const pid of allPosIds) {
    const mv = rounds.map(r => { const d = out.all[cfg].perRound[r].detail.find(x => x.pid === pid); return d ? d.selMove : null; }).filter(Boolean);
    if (mv.length < 2) continue;
    tot++;
    if (new Set(mv).size > 1) unstable++;
  }
  out.instability[cfg] = { pairs: tot, unstable };
  // search cost
  const selRows = rows.filter(r => r.type === 'SEL' && r.cfg === cfg);
  const depths = selRows.map(r => +r.fields.depth).filter(Number.isFinite);
  const nodes = selRows.map(r => +r.fields.nodes).filter(Number.isFinite);
  out.cost[cfg] = {
    n: selRows.length,
    depthMin: Math.min(...depths), depthMax: Math.max(...depths),
    nodesMin: Math.min(...nodes), nodesMax: Math.max(...nodes),
    nodesMean: +(nodes.reduce((a, b) => a + b, 0) / nodes.length).toFixed(0),
  };
  // realized gap (top1 - chosen) distribution per config
  {
    const gaps = selRows.map(r => +r.fields.gap).filter(Number.isFinite);
    const buckets = { '0': 0, '1-9': 0, '10-49': 0, '50-199': 0, '200-499': 0, '500+': 0 };
    for (const g of gaps) {
      if (g <= 0) buckets['0']++;
      else if (g < 10) buckets['1-9']++;
      else if (g < 50) buckets['10-49']++;
      else if (g < 200) buckets['50-199']++;
      else if (g < 500) buckets['200-499']++;
      else buckets['500+']++;
    }
    out.cost[cfg].gapStat = stat(gaps);
    out.cost[cfg].gapBuckets = buckets;
  }
  // rule diagnostics
  if (cfg.startsWith('CAP')) {
    const hits = {}; const used = {};
    for (const r of selRows) { hits[r.fields.hit] = (hits[r.fields.hit] || 0) + 1; used[r.fields.slotUsed] = (used[r.fields.slotUsed] || 0) + 1; }
    out.ruleDiag[cfg] = { hits, slotUsedHist: used };
  }
  if (cfg.startsWith('NOI')) {
    const hits = {};
    for (const r of selRows) hits[r.fields.hit] = (hits[r.fields.hit] || 0) + 1;
    out.ruleDiag[cfg] = { hits, randShare: +(hits.rand / (hits.rand + (hits.engine || 0))).toFixed(3) };
  }
  if (cfg.startsWith('BN_')) {
    // boundednoise: did the bounded random branch fire, what did the judge accept, and did every
    // played random move respect the cap?  Also the judge's own search cost (the extra cost the
    // card asks to report).
    const hits = {}; const capUsed = {}; const overCap = []; const acceptN = []; const judgedGap = [];
    let brandMoves = 0, brandPool = 0, brandProbe = 0, pnodes = [], pdepth = [], probesRun = 0;
    for (const r of selRows) {
      hits[r.fields.hit] = (hits[r.fields.hit] || 0) + 1;
      const m = String(r.fields.probs || '').match(/cap=(-?\d+),p=([\d.]+),gapmode=(\w+)/);
      if (m) out.ruleDiag[cfg] = out.ruleDiag[cfg] || { cap: +m[1], p: +m[2], gapmode: m[3] };
      const an = String(r.fields.probs || '').match(/,accept=(\d+)/);
      if (an && Number.isFinite(+an[1])) acceptN.push(+an[1]);
      if (r.fields.hit === 'brand') {
        brandMoves++;
        const agm = String(r.fields.probs || '').match(/,agap=(-?\d+)/);
        const ag = agm ? +agm[1] : NaN;
        if (Number.isFinite(ag)) { judgedGap.push(ag); if (out.ruleDiag[cfg] && ag > out.ruleDiag[cfg].cap) overCap.push([r.pos, ag]); }
        const ps = String(r.fields.pslots || '');
        if (ps && ps !== '-') probesRun++;
        const pn = +r.fields.pnodes; if (Number.isFinite(pn)) pnodes.push(pn);
        const pd = +r.fields.pdepth; if (Number.isFinite(pd)) pdepth.push(pd);
        // was the played bounded move a MAIN-POOL candidate, or only found by the judge probe?
        // (pmoves carries the main pool's moves as k:uci; slots carries only scores)
        const poolMv = String(r.fields.pmoves || '').split(',').map(x => x.split(':')[1]);
        if (poolMv.indexOf(r.fields.move) >= 0) brandPool++; else brandProbe++;
      } else {
        capUsed[r.fields.slotUsed] = (capUsed[r.fields.slotUsed] || 0) + 1;
        const g = +r.fields.gap;
        if (Number.isFinite(g) && out.ruleDiag[cfg] && g > out.ruleDiag[cfg].cap) overCap.push([r.pos, g]);
      }
    }
    const tot = (hits.brand || 0) + (hits.bmiss || 0) + (hits.cap || 0) + (hits.above || 0);
    out.ruleDiag[cfg] = Object.assign(out.ruleDiag[cfg] || {}, {
      hits,
      brandShare: tot ? +((hits.brand || 0) / tot).toFixed(3) : null,
      bmissShare: tot ? +((hits.bmiss || 0) / tot).toFixed(3) : null,
      capBranchShare: tot ? +(((hits.cap || 0) + (hits.above || 0)) / tot).toFixed(3) : null,
      capDegenerateShare: tot ? +((hits.above || 0) / tot).toFixed(3) : null,
      acceptSetMean: acceptN.length ? +(acceptN.reduce((a, b) => a + b, 0) / acceptN.length).toFixed(2) : null,
      acceptSetMin: acceptN.length ? Math.min(...acceptN) : null,
      judgedGapStat: stat(judgedGap),
      capViolations: overCap,
      capBranchSlotHist: capUsed,
      brandFromPool: brandPool, brandFromProbeOnly: brandProbe,
      judge: { probesRun, pnodesMean: pnodes.length ? +(pnodes.reduce((a, b) => a + b, 0) / pnodes.length).toFixed(0) : null,
               pnodesMax: pnodes.length ? Math.max(...pnodes) : null,
               pdepthMax: pdepth.length ? Math.max(...pdepth) : null },
    });
  }
  if (cfg.startsWith('AC_')) {
    // capnoise: how often the random override fired, and what the cap branch WOULD have played
    const hits = {}; const would = {}; const capUsed = {}; const overCap = [];
    for (const r of selRows) {
      hits[r.fields.hit] = (hits[r.fields.hit] || 0) + 1;
      const m = String(r.fields.probs || '').match(/cap=(\d+),p=([\d.]+)/);
      if (m) { out.ruleDiag[cfg] = out.ruleDiag[cfg] || { cap: +m[1], p: +m[2] }; }
      if (r.fields.hit === 'rand') {
        const wb = String(r.fields.probs || '').match(/wouldBe=(\d+)/);
        if (wb) would[wb[1]] = (would[wb[1]] || 0) + 1;
      } else {
        capUsed[r.fields.slotUsed] = (capUsed[r.fields.slotUsed] || 0) + 1;
        const g = +r.fields.gap;
        if (Number.isFinite(g) && out.ruleDiag[cfg] && g > out.ruleDiag[cfg].cap) overCap.push([r.pos, g]);
      }
    }
    const tot = (hits.rand || 0) + (hits.cap || 0) + (hits.above || 0);
    out.ruleDiag[cfg] = Object.assign(out.ruleDiag[cfg] || {}, {
      hits,
      randShare: tot ? +((hits.rand || 0) / tot).toFixed(3) : null,
      capBranchShare: tot ? +(((hits.cap || 0) + (hits.above || 0)) / tot).toFixed(3) : null,
      capDegenerateShare: tot ? +((hits.above || 0) / tot).toFixed(3) : null,   // "all candidates above cap" -> slot 1
      wouldBeSlotHist: would, capBranchSlotHist: capUsed, capViolations: overCap,
    });
  }
  if (cfg.startsWith('TMP')) {
    // from the recorded slot scores + softmax weights: mean prob mass on slot1 and the
    // expected degradation E[gap] the rule is aiming at, vs the realized gap
    let s1p = [], expGap = [];
    for (const r of selRows) {
      const T = +(String(r.fields.probs || '').match(/T=(-?\d+)/) ? RegExp.$1 : NaN);
      const slots = String(r.fields.slots || '').split(',').map(s => s.split(':')).filter(x => x.length === 2 && Number.isFinite(+x[1]));
      if (!slots.length || !Number.isFinite(T)) continue;
      const top = +slots[0][1];
      const w = slots.map(x => Math.exp((+x[1] - top) / T));
      const tot = w.reduce((a, b) => a + b, 0) || 1;
      s1p.push(w[0] / tot);
      expGap.push(slots.reduce((a, x, i) => a + (w[i] / tot) * (top - (+x[1])), 0));
    }
    out.ruleDiag[cfg] = {
      meanProbSlot1: s1p.length ? +(s1p.reduce((a, b) => a + b, 0) / s1p.length).toFixed(3) : null,
      meanExpectedGap: expGap.length ? +(expGap.reduce((a, b) => a + b, 0) / expGap.length).toFixed(1) : null,
      n: s1p.length,
    };
  }
}

// noise floor from ANCH control
out.noiseFloor = out.all.ANCH.overall ? {
  note: 'ANCH plays the anchor search own bestmove; loss should be ~0. Its sd is the metric noise floor.',
  overall: out.all.ANCH.overall,
  perGroup: {},
} : null;
for (const g of groups) {
  const vals = [];
  for (const r of rounds) for (const d of out.all.ANCH.perRound[r].detail) if (groupOf[d.pid] === g) vals.push(d.loss);
  out.noiseFloor.perGroup[g] = stat(vals);
}

// per-group per-config table
for (const g of groups) {
  out.perGroup[g] = {};
  const pids = posIdsOf(g);
  for (const cfg of OUT_CFGS) {
    const perRound = {};
    const all = [];
    for (const r of rounds) {
      const det = out.all[cfg].perRound[r].detail.filter(d => pids.includes(d.pid));
      perRound[r] = { stat: stat(det.map(x => x.loss)), detail: det };
      all.push(...det.map(x => x.loss));
    }
    out.perGroup[g][cfg] = { overall: stat(all), perRound };
  }
}

// pairwise deltas (a minus b, positive = a weaker) with noise-aware verdict
const PAIRS = [
  ['AM0', 'AD0'],            // baseline gap to reproduce (~9 cp midgame)
  ['CAP_AD', 'AD0'], ['CAP_AD', 'AM0'], ['CAP_AM', 'AM0'], ['CAP_AM', 'AD0'], ['CAP_AM', 'CAP_AD'],
  ['TMP_AD', 'AD0'], ['TMP_AD', 'AM0'], ['TMP_AM', 'AM0'], ['TMP_AM', 'AD0'], ['TMP_AM', 'TMP_AD'],
  ['NOI_AD', 'AD0'], ['NOI_AD', 'AM0'], ['NOI_AM', 'AM0'], ['NOI_AM', 'AD0'], ['NOI_AM', 'NOI_AD'],
  ['T8S1', 'AD0'], ['T8S1', 'AM0'],
  ['AD0', 'EX0'], ['CAP_AD', 'EX0'], ['CAP_AM', 'EX0'], ['TMP_AD', 'EX0'], ['TMP_AM', 'EX0'], ['NOI_AD', 'EX0'], ['NOI_AM', 'EX0'],
  // card t_3fff5a44 — A+C composition vs its own components and vs the baselines
  ['AC_AD', 'CAP_AD'], ['AC_AM', 'CAP_AM'],          // what the noise adds on top of the cap
  ['AC_AD', 'NOI_AD'], ['AC_AM', 'NOI_AM'],          // what the cap changes inside the noise scheme
  ['AC_AM', 'AC_AD'], ['AC_AM', 'AM0'], ['AC_AM', 'AD0'], ['AC_AD', 'AD0'], ['AC_AD', 'AM0'],
  ['AC_AM', 'EX0'], ['AC_AD', 'EX0'],
  ['AC_X1', 'AC_AD'], ['AC_X1', 'AC_AM'], ['AC_P15', 'AC_AD'], ['AC_P20', 'AC_P15'], ['AC_AM', 'AC_P20'],
  // card t_f844043c — bounded noise vs the cap-only and unbounded-capnoise versions
  ['BN_AD', 'CAP_AD'], ['BN_AM', 'CAP_AM'],                  // does bounded noise add strength loss?
  ['BN_AD', 'AC_AD'], ['BN_AM', 'AC_AM'],                    // bounded vs unbounded at the same cap
  ['BN_AM', 'BN_P2'],                                        // hybrid judge vs pool-only judge (cost/quality)
  ['BN_AM', 'AM0'], ['BN_AD', 'AD0'], ['BN_AM', 'EX0'], ['BN_AD', 'EX0'], ['BN_AM', 'NOI_AM'],
  ['BN_AM', 'BN_AD'],
].filter(pair => OUT_CFGS.includes(pair[0]) && OUT_CFGS.includes(pair[1]));
for (const [a, b] of PAIRS) {
  const rec = { a, b, groups: {} };
  for (const g of groups.concat(['all'])) {
    const la = [], lb = [], d = [];
    for (const r of rounds) {
      const src = g === 'all' ? out.all[a].perRound[r].detail : out.perGroup[g][a].perRound[r].detail;
      const srcb = g === 'all' ? out.all[b].perRound[r].detail : out.perGroup[g][b].perRound[r].detail;
      for (const da of src) {
        const db = srcb.find(x => x.pid === da.pid);
        if (!db) continue;
        la.push(da.loss); lb.push(db.loss); d.push(da.loss - db.loss);
      }
    }
    const ma = stat(la), mb = stat(lb);
    if (!ma || !mb) continue;
    // paired std error of the mean difference
    const md = d.reduce((x, y) => x + y, 0) / d.length;
    const sd = Math.sqrt(d.reduce((x, y) => x + (y - md) ** 2, 0) / Math.max(d.length - 1, 1));
    const se = sd / Math.sqrt(d.length);
    rec.groups[g] = {
      n: d.length, meanA: ma.mean, meanB: mb.mean, delta: +md.toFixed(1),
      pairedSd: +sd.toFixed(1), seOfMean: +se.toFixed(1), t: se > 0 ? +(md / se).toFixed(2) : null,
      ci95: [+ (md - 1.96 * se).toFixed(1), +(md + 1.96 * se).toFixed(1)],
      aWorse5: d.filter(x => x > 5).length, tie5: d.filter(x => Math.abs(x) <= 5).length, bWorse5: d.filter(x => x < -5).length,
    };
  }
  out.deltas[a + ' minus ' + b] = rec;
}

// per-position separability (baseline threshold 20 cp on 3-round means)
function meanLoss(cfg, pid) {
  const vals = [];
  for (const r of rounds) { const d = out.all[cfg].perRound[r].detail.find(x => x.pid === pid); if (d) vals.push(d.loss); }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
for (const pid of allPosIds) {
  const rec = { group: groupOf[pid] };
  for (const cfg of OUT_CFGS) rec[cfg] = meanLoss(cfg, pid) === null ? null : +meanLoss(cfg, pid).toFixed(0);
  rec.sep = {};
  for (const [a, b] of [['AD0', 'EX0'], ['CAP_AD', 'AD0'], ['CAP_AD', 'EX0'], ['CAP_AM', 'AD0'], ['TMP_AD', 'AD0'], ['TMP_AD', 'EX0'], ['TMP_AM', 'AD0'], ['NOI_AD', 'AD0'], ['NOI_AD', 'EX0'], ['NOI_AM', 'AD0'],
                        ['AC_AD', 'AD0'], ['AC_AD', 'CAP_AD'], ['AC_AM', 'AD0'], ['AC_AM', 'CAP_AM'], ['AC_AM', 'AM0'], ['AC_AM', 'AC_AD'], ['AC_AM', 'EX0'], ['AC_AD', 'EX0'],
                        ['AC_P15', 'AD0'], ['AC_P20', 'AD0'], ['AC_X1', 'AD0'],
                        ['BN_AD', 'CAP_AD'], ['BN_AM', 'CAP_AM'], ['BN_AM', 'AC_AM'], ['BN_AM', 'AM0'], ['BN_AM', 'EX0'], ['BN_P2', 'BN_AM']].filter(p => OUT_CFGS.includes(p[0]) && OUT_CFGS.includes(p[1]))) {
    if (rec[a] === null || rec[b] === null) continue;
    const dd = rec[a] - rec[b];
    rec.sep[a + '>' + b] = { delta: +dd.toFixed(0), cls: dd > 20 ? 'SEP' : (dd < -20 ? 'INV' : 'FLAT') };
  }
  out.sep[pid] = rec;
}

out.crit = rows.filter(r => +r.fields.crit > 0).length;
out.skipCount = out.skips.length;
out.selCount = rows.filter(r => r.type === 'SEL').length;
out.anchorCount = rows.filter(r => r.type === 'ANCHOR').length;
out.refCount = rows.filter(r => r.type === 'REF').length;

const OUTJSON = process.env.ANALYSIS_OUT || 'alt_analysis.json';
fs.writeFileSync(path.join(__dirname, '..', 'new_engine_logs', OUTJSON), JSON.stringify(out, null, 1));
console.log('wrote new_engine_logs/' + OUTJSON);

/* ---------------- human tables ---------------- */
function fmt(s) { return s ? ('n=' + s.n + ' mean=' + s.mean + ' med=' + s.median + ' sd=' + s.sd) : 'NO DATA'; }
console.log('rounds=' + JSON.stringify(rounds) + ' L lines: SEL=' + out.selCount + ' ANCHOR=' + out.anchorCount + ' REF=' + out.refCount + ' crit=' + out.crit + ' skips=' + out.skipCount);
console.log('noise floor (ANCH control): ' + fmt(out.all.ANCH.overall) + '  midgame ' + fmt(out.noiseFloor.perGroup.midgame) + '  opening ' + fmt(out.noiseFloor.perGroup.opening));
for (const g of groups) {
  console.log('\n==== group: ' + g + ' ====');
  console.log('cfg      | overall                        | ' + rounds.map(r => 'r' + r).join(' | '));
  for (const cfg of OUT_CFGS) {
    const e = out.perGroup[g][cfg];
    console.log(cfg.padEnd(8) + '| ' + fmt(e.overall).padEnd(32) + '| ' + rounds.map(r => fmt(e.perRound[r] ? e.perRound[r].stat : null)).join(' | '));
  }
}
console.log('\n==== pairwise mean deltas (a minus b; positive = a weaker; t = delta/se) ====');
for (const k of Object.keys(out.deltas)) {
  const r = out.deltas[k];
  const cell = (g) => r.groups[g] ? ('d=' + r.groups[g].delta + ' t=' + r.groups[g].t + ' ci=' + JSON.stringify(r.groups[g].ci95) + ' w/t/l=' + r.groups[g].aWorse5 + '/' + r.groups[g].tie5 + '/' + r.groups[g].bWorse5) : 'n/a';
  console.log(k.padEnd(20) + ' all: ' + cell('all'));
  console.log(''.padEnd(20) + ' mid: ' + cell('midgame') + '  open: ' + cell('opening'));
}
console.log('\n==== rule diagnostics ====');
console.log(JSON.stringify(out.ruleDiag, null, 1));
console.log('\n==== instability (cross-round chosen-move changes) / cost ====');
for (const cfg of OUT_CFGS) console.log(cfg.padEnd(8) + ' unstable=' + JSON.stringify(out.instability[cfg]) + ' roundMeanSpread=' + out.all[cfg].roundMeanSpread + ' perPosSdMean=' + out.all[cfg].perPosSdMean + ' cost=' + JSON.stringify(out.cost[cfg]));
console.log('\n==== per-position 3-round mean loss ====');
const cols = ['AM0', 'AD0', 'EX0', 'CAP_AD', 'CAP_AM', 'NOI_AD', 'NOI_AM', 'AC_AD', 'AC_AM', 'AC_P15', 'AC_P20', 'AC_X1', 'BN_AD', 'BN_AM', 'BN_P2', 'T8S1', 'ANCH'].filter(c => OUT_CFGS.includes(c));
console.log('id           grp     ' + cols.map(c => c.padStart(7)).join(' '));
for (const pid of allPosIds) {
  const r = out.sep[pid];
  console.log(pid.padEnd(12) + r.group.padEnd(7) + cols.map(c => String(r[c] === null ? 'NA' : r[c]).padStart(7)).join(' '));
}
console.log('\n==== separability tally (delta > 20cp = SEP, < -20 = INV, else FLAT) ====');
const tally = {};
for (const pid of allPosIds) for (const k of Object.keys(out.sep[pid].sep)) { const cls = out.sep[pid].sep[k].cls; tally[k + ' ' + cls] = (tally[k + ' ' + cls] || 0) + 1; }
console.log(JSON.stringify(tally, null, 1));
