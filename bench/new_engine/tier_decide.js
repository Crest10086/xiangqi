/* new_engine/tier_decide.js — turn the calibration into the five tier parameter sets and WRITE
 * tier_tiers.json (card t_a8096ea3). Self-checking: it refuses to write a ladder that is not
 * monotone in the measured model, so the numbers in the report are the ones the data supports.
 *
 * Contract (user 2026-10-04 21:40, t_9c93fb06 comment):
 *   入门 = built-in engine, completely unchanged
 *   业余 = close to 进阶 but makes mistakes      -> SAME cap as 进阶, plus p > 0
 *   进阶 = stably weaker than 高手               -> larger cap than 高手, p = 0
 *   高手 = close to 大师 but occasionally errs   -> small cap + small p
 *   大师 = limit strength                        -> MultiPV=1, best candidate, no cap
 * movetime / Hash are NOT part of the ladder: every engine tier uses the same 300 ms / MultiPV 8 /
 * Hash 64 search; only 大师 differs (it is the ceiling, not a rung).
 */
const fs = require('fs');
const path = require('path');
const T = require('./tier_rules.js');

const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', 'tier_analysis.json'), 'utf8'));
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'tier_fit_out.json'), 'utf8'));
const POS = A.perPosition, POS_IDS = Object.keys(POS);
const candsOf = (gaps) => gaps.map((g, i) => ({ slot: i + 1, score: -g, move: 'mv' + (i + 1), gap: g }));

function predict(cfg) {
  const per = { opening: [], normal: [], hard: [] };
  for (const pid of POS_IDS) {
    const p = POS[pid];
    if (!p.poolGaps || !p.poolGaps.length) continue;
    const cands = candsOf(p.poolGaps);
    const cls = T.classify(cfg, p.group, cands);
    const c = F.coefs[cls];
    if (!c || c.slope === null) continue;
    per[cls].push(c.intercept + c.slope * T.expectedGap(cfg, cands, p.group));
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const all = [].concat(per.opening, per.normal, per.hard);
  return { all: mean(all), opening: mean(per.opening), normal: mean(per.normal), hard: mean(per.hard) };
}

const MOVETIME = 300, HASH = 64, MPV = 8;
const mk = (id, cap, p, band) => ({ id: id, rule: 'tier', cap: cap, p: p, mistakeBand: band,
  openingCap: cap, openingMistakeBand: band, hardCap: 0, hardMistakeBand: 700,
  multipv: MPV, movetime: MOVETIME, hash: HASH });

/* ------------------------------------------------------------------ *
 * The contract has THREE parameters, not two (review round 1, item 2):
 *   cap         stable strength: the worst candidate this tier plays normally
 *   p           probability of making a mistake instead of the stable choice
 *   mistakeBand how far a mistake may reach: candidates with cap < gap <= cap+mistakeBand.
 * mistakeBand is the SAME quantity as the "bounded" degradation limit measured in
 * bench/NEW_ENGINE_WEAK_TIER_BOUNDED.md (card t_f844043c): there, a random move had to be within
 * cap of the best candidate; here the mistake must be strictly worse than the stable choice but
 * within mistakeBand of it. Both exist to keep 少子形 (HARD) positions from 白丢子 — the bounded
 * card's acceptance criterion was "loss>300cp rate back to 0%", and an unbounded band breaks it
 * (measured in bench/new_engine_logs/tier_r4.log: the no-upper-bound config played a 583 cp blunder
 * on MG_QT01).
 * ------------------------------------------------------------------ */
const CONTRACT = {
  parameters: ['cap', 'p', 'mistakeBand'],
  definitions: {
    cap: 'stable strength: the largest judged degradation (cp vs the pool best) this tier plays normally',
    p: 'probability of MAKING A MISTAKE instead of playing the stable choice',
    mistakeBand: 'extra reach of a mistake: only candidates with cap < gap <= cap+mistakeBand may be picked; ' +
      'this is the bounded degradation limit from bench/NEW_ENGINE_WEAK_TIER_BOUNDED.md (t_f844043c)',
  },
  boundedRelationship: 'mistakeBand == the bounded limit of the boundednoise rule, re-expressed so the random ' +
    'branch is strictly WORSE than the stable choice (the fix for the bounded card\'s negative finding 1b). ' +
    'hardMistakeBand 700 is the 少子形 variant of the same limit.',
  effectRate: 'realized mistake rate = p * P(band non-empty), NOT p. See mistakeEffectRate per tier.',
};

/* ---- measured mistake effectiveness (review round 1, item 1) ------------------------------------
 * effectRate   = share of played selections that were actually worse than the stable choice (hit=rand)
 * bandCeiling  = P(band non-empty) over the logged candidate pools: the structural ceiling of p
 *
 * IMPORTANT (and the reason this is computed here instead of being asserted): the cfgs that were
 * actually PROBED in r1/r2 are plain cfgs (cap/p/mistakeBand, no per-class overrides), while the
 * cfgs the decision writes are the same plus openingCap=cap and hardCap 0 / hardMistakeBand 700.
 * Both ceilings are reported so nobody reads one as the other.
 * Pooled over the individual round analyses when they exist (tier_analysis.json keeps only the last
 * round per position, so pooling from A alone would understate the sample). */
function roundAnalyses() {
  const out = [];
  for (const f of ['tier_analysis_r1.json', 'tier_analysis_r2.json']) {
    const p = path.join(__dirname, '..', 'new_engine_logs', f);
    if (fs.existsSync(p)) out.push({ name: f, data: JSON.parse(fs.readFileSync(p, 'utf8')) });
  }
  if (!out.length) out.push({ name: 'tier_analysis.json', data: A });
  return out;
}
function effectStats(measuredCfgId, decidedKey) {
  const rounds = roundAnalyses();
  let n = 0, rand = 0, bmiss = 0, pools = 0, empty = 0, poolsDec = 0, emptyDec = 0;
  const perRound = [];
  const decCfg = CHOICE[decidedKey];
  for (const R of rounds) {
    const c = R.data.perCfg[measuredCfgId];
    if (!c) continue;
    const h = {};
    for (const seg of String(c.hitShare).split(',')) { const i = seg.indexOf(':'); h[seg.slice(0, i)] = +seg.slice(i + 1); }
    const rr = (h.rand || 0) * c.n, bb = (h.bmiss || 0) * c.n;
    perRound.push({ round: R.name, n: c.n, firedRate: c.n ? (rr + bb) / c.n : null, effectRate: c.n ? rr / c.n : null });
    n += c.n; rand += rr; bmiss += bb;
    const cfgProbed = c.cfg;                       // exactly what the browser ran
    const cfgDecided = decCfg || cfgProbed;        // what the decision writes
    for (const pid of Object.keys(R.data.perPosition)) {
      const p = R.data.perPosition[pid];
      if (!p.poolGaps || !p.poolGaps.length) continue;
      const cands = candsOf(p.poolGaps);
      pools++;
      const cls = T.classify(cfgProbed, p.group, cands);
      const band = cands.filter((x) => x.move && x.gap > T.capFor(cfgProbed, cls) && x.gap <= T.mistakeCapFor(cfgProbed, cls));
      if (!band.length) empty++;
      poolsDec++;
      const cls2 = T.classify(cfgDecided, p.group, cands);
      const band2 = cands.filter((x) => x.move && x.gap > T.capFor(cfgDecided, cls2) && x.gap <= T.mistakeCapFor(cfgDecided, cls2));
      if (!band2.length) emptyDec++;
    }
  }
  if (!n) return null;
  return {
    measuredCfg: measuredCfgId,
    note: 'cfg probed in the calibration = plain cap/p/mistakeBand (no per-class overrides); ' +
      'cfg decided adds openingCap=cap and hardCap0/hardMistakeBand700 — both ceilings are given.',
    perRound: perRound,
    calibrationEffectRate: rand / n,
    firedRate: (rand + bmiss) / n,
    effectRateOfFired: (rand + bmiss) ? rand / (rand + bmiss) : null,
    bandCeilingProbedCfg: pools ? 1 - empty / pools : null,
    bandCeilingDecidedCfg: poolsDec ? 1 - emptyDec / poolsDec : null,
    poolsTested: pools,
    selectionsTested: n,
  };
}

/* The rungs. cap/p values are the MEASURED points from the two calibration rounds (r1+r2 means,
 * cp given up vs the ANCHOR best move):
 *   cap 0 -> -0.4 | cap 25 -> 11.3 | cap 50 -> 17.2 | cap 80 -> 31.8 | cap 150 -> 58.0
 *   cap80 p0.10 -> 31.6 | cap80 p0.25 -> 29.4 | cap80 p0.50 -> 46.3   (band 200)
 *   cap80 + hardCap0/hardBand700 p0.25 -> 48.6
 * cap80 at movetime 150 measured 33.2 vs cap80 at 300 measured 31.8 -> the movetime control passes
 * (inside the ±20-70 noise floor), which is the contract's "movetime is not a strength knob".
 * p only weakens when the mistake band actually contains candidates: at p<=0.25 with band 200 the
 * branch fell back (bmiss) in most positions, at p=0.50 it produced a measurable drop. The chosen
 * 业余 point is therefore the measured p=0.50 point, not a guessed one. */
const CHOICE = {
  高手: mk('T_GAO', 25, 0.10, 200),   // near master: measured 12.6 cp (the G10 point)
  进阶: mk('T_JIN', 80, 0.00, 200),   // stably weaker: measured 31.8 cp (the CAP80 point)
  业余: mk('T_YOU', 80, 0.50, 200),   // SAME stable cap as 进阶, but half the moves are mistakes: 46.3 cp
};
const CONTROL = mk('C_CAP0', 0, 0, 200);   // control rung: always the best candidate at the tier budget
/* 大师 = the ceiling, and its movetime is a PENDING value, not a settled one (review round 1, item 3):
 * r3 measured only 6 positions, r5 measured 10 positions with the memory probe. Both agree that
 * 1000 ms and above are within noise of each other, so the choice is made on COST, not on strength:
 * the strength column of a 10-position sample is a direction check, and the value must be re-checked
 * on a real device with complex positions before it is treated as final. movetimeAlternatives keeps
 * the old 6000 default as an allowed value instead of inheriting it. */
const MASTER = {
  id: 'T_DA', kind: 'master', multipv: 1, movetime: 2000, hash: 256,
  movetimeAlternatives: [1000, 2000, 4000, 6000, 8000],
  status: 'pending-real-device',
  statusNote: 'movetime measured on bench samples only (r3: 6 positions; r5: 10 positions). ' +
    '1000/2000/4000/6000/8000 ms are indistinguishable in strength on that sample (all within the ' +
    'noise floor), so 2000 is chosen as the cheapest of the flat region, NOT because it is stronger. ' +
    'Needs a real-device check on complex positions (memory, first-load, UI latency) before it is final.',
  measuredCost: {
    note: 'bench/new_engine_logs/tier_r5.log + tier_ceiling_cost.js (10 positions, MultiPV1, Hash256)',
    firstLoadMs: { importScripts: 5, wasmModule: 42, nnueFetch: 166, nnueFsWrite: 179, engineInitialize: 551 },
    nnueBytes: 50706378,
    wasmHeapAfterInitBytes: 322174976,
    wasmHeapGrewToBytes: 573571072,
    heapNote: 'the WASM heap reaches ~547 MB and does NOT grow further between movetime 1000 and 8000 ms ' +
      'at Hash 256 — the memory cost is the Hash setting, not the movetime.',
    nodesMeanByMovetime: { '300/MultiPV8': 580900, '1000': 1773897, '2000': 3447290, '4000': 7013783, '6000': 10311265, '8000': 13671819 },
    lossMeanByMovetime: { '300/MultiPV8': -2.5, '1000': -0.4, '2000': -4.5, '4000': -3.7, '6000': -2.7, '8000': -4.1, 'ANCHOR': -3.0 },
    samplePositions: 10,
  },
};  // = the measured ANCHOR configuration
const RUKN = { id: 'T_RUKN', kind: 'builtin', depth: 2, qDepth: 0, maxNodes: 1500, randomness: 45 }; // engine.js LEVELS[0], unchanged

console.log('predicted mean loss (cp vs the ANCHOR best move) for the chosen rungs:');
const preds = {};
for (const name of ['高手', '进阶', '业余']) {
  const cfg = CHOICE[name];
  const q = predict(cfg);
  preds[name] = q;
  console.log('  ' + name + ' cap=' + cfg.cap + ' p=' + cfg.p + ' band=' + cfg.mistakeBand +
    '  all=' + (q.all === null ? '-' : q.all.toFixed(1)) +
    ' opening=' + (q.opening === null ? '-' : q.opening.toFixed(1)) +
    ' normal=' + (q.normal === null ? '-' : q.normal.toFixed(1)) +
    ' hard=' + (q.hard === null ? '-' : q.hard.toFixed(1)));
}
const masterRef = predict({ rule: 'tier', cap: 0, p: 0, mistakeBand: 200, hardCap: 0 });
console.log('  大师 reference (cap0/p0, i.e. always the best candidate at this budget) all=' +
  (masterRef.all === null ? '-' : masterRef.all.toFixed(1)));

/* monotonicity gate: 大师 < 高手 < 进阶 < 业余 in predicted degradation */
const order = [masterRef.all, preds['高手'].all, preds['进阶'].all, preds['业余'].all];
let mono = true;
for (let i = 1; i < order.length; i++) if (!(order[i] > order[i - 1])) mono = false;
console.log('monotonicity gate 大师<高手<进阶<业余: ' + (mono ? 'PASS' : 'FAIL') + ' ' + order.map(x => x.toFixed(1)).join(' < '));
if (!mono) { console.log('refusing to write tier_tiers.json'); process.exit(1); }

const out = {
  generated: new Date().toISOString(),
  source: { analysis: 'new_engine_logs/tier_analysis.json', fit: 'tier_fit_out.json', logs: A.logs },
  contract: CONTRACT,
  fixedSearchBudget: { movetime: MOVETIME, multipv: MPV, hash: HASH, threads: 4 },
  note: 'cap/p/mistakeBand are the only strength knobs; 大师 is the ceiling (MultiPV=1 + the measured ANCHOR budget), not a rung.',
  mistakeEffectRate: {
    definition: 'realized mistake rate = share of played selections that were actually WORSE than the stable choice ' +
      '(hit=rand). It equals p * P(band non-empty) and is always below p.',
    calibration: {
      业余: effectStats('P50', '业余'),
      进阶: effectStats('CAP80', '进阶'),
      高手: effectStats('G10', '高手'),
    },
    game: {
      source: 'node tier_effect_report.js --games new_engine_logs/games_r1.log games_r2.log (32 games, 1388 moves)',
      业余: { moves: 541, effectiveRand: 109, firedButBandEmpty: 162, effectRate: 0.201, effectRateOfFired: 0.402 },
      进阶: { moves: 450, effectiveRand: 0, firedButBandEmpty: 0, effectRate: 0.0, note: 'p=0 by design' },
      高手: { moves: 397, effectiveRand: 28, firedButBandEmpty: 13, effectRate: 0.071, effectRateOfFired: 0.683 },
      measuredGapOfMistakeMoves: { 业余: { median: 116, p90: 220, max: 264 }, 高手: { median: 94, p90: 181, max: 200 } },
    },
    hardPositionsNote: 'in 少子形 (HARD) positions no engine tier ever played a mistake candidate: 34 HARD moves across ' +
      'the 32 games (业余 12 / 进阶 11 / 高手 11), hit=rand 0 times (业余 7 above + 5 bmiss, band empty in 11/12; ' +
      '进阶 11 above; 高手 10 above + 1 bmiss). hardCap 0 means only the pool-best candidate is accepted and ' +
      'hardMistakeBand 700 was empty in 30/34 of them. The bounded constraint works as designed, but the low tiers ' +
      'are artificially careful in simplified positions and that must not be promised to players.',
  },
  mistakeBandLadderMeasured: {
    source: 'node tier_verify.js new_engine_logs/tier_r4.log --out new_engine_logs/tier_analysis_r4.json ' +
      '(same 17 positions, same 300ms/MultiPV8/Hash64 budget, only mistakeBand varied)',
    finding: 'widening the band from cap+50 to cap+200 is NOT a strength knob (measured 43.9 vs 52.9 cp overall, ' +
      'midgame 54.4 vs 45.6 — inside the noise floor, and both above the p=0 reference 37.4). Removing the upper ' +
      'bound DOES change strength (104.6 cp) and it breaks the bounded constraint: a 583 cp blunder on MG_QT01 and ' +
      '290.5 cp average in HARD positions, which is exactly the 白丢子 the bounded card (t_f844043c) was closed for.',
    decision: 'keep mistakeBand 200 (bounded). To make a tier weaker, move cap or p — not the band.',
    measured: {
      CAP80_p0: { overall: 37.4, opening: 21.8, midgame: 43.8, hard: -1.5, gapMax: 73 },
      band_cap50_p50: { overall: 43.9, opening: 18.8, midgame: 54.4, hard: 0.5, gapMax: 128 },
      band_cap200_p50: { overall: 52.9, opening: 70.6, midgame: 45.6, hard: -1.5, gapMax: 240 },
      band_unbounded_p50: { overall: 104.6, opening: 107.2, midgame: 103.5, hard: 290.5, gapMax: 588 },
      band_cap50_cap25_p10: { overall: 46.8, midgame: 61.7, hard: 291.0, note: 'cap25 + band50 lets a 565 cp blunder through in HARD' },
      band_cap200_cap25_p10: { overall: 8.0, midgame: 9.8, hard: 2.5, gapMax: 25 },
      band_unbounded_cap25_p10: { overall: 38.5, midgame: 53.3, hard: 283.5, gapMax: 556 },
    },
  },
  reviewPending: [
    '大师 movetime is a bench-only measurement (r3: 6 positions, r5: 10 positions) and is marked pending-real-device; ' +
    '1000-8000 ms are indistinguishable in strength on that sample, so the value is chosen on cost, not strength.',
    'adjacent tiers are separable on the MEAN (18-21 cp) but not per single game: per-position hit rate 24-53%, ' +
    'noise floor ±7 cp per position / ±14 cp per round mean.',
    '17 calibration positions include only 2 HARD and several "everything is bad" positions; a finer ladder needs ' +
    'more midgame positions with real intermediate gradients.',
    'in 少子形 (HARD) positions no engine tier ever played a mistake candidate: 34 HARD moves across the 32 games ' +
    '(业余 12 / 进阶 11 / 高手 11) produced hit=rand 0 times (业余 7 above + 5 bmiss with the band empty in 11/12, ' +
    '进阶 11 above, 高手 10 above + 1 bmiss). The bounded constraint works as designed, but "the low tiers blunder ' +
    'in simplified positions" is NOT supported by this data and must not be promised to players.',
  ],
  入门: RUKN,
  对照: Object.assign({ name: '对照', tier: '对照', note: 'control rung: always the best candidate at the TIER budget (isolates a tier mistake dimension from thinking time)' }, CONTROL),
  业余: Object.assign({ name: '业余', tier: '业余' }, CHOICE.业余),
  进阶: Object.assign({ name: '进阶', tier: '进阶' }, CHOICE.进阶),
  高手: Object.assign({ name: '高手', tier: '高手' }, CHOICE.高手),
  大师: Object.assign({ name: '大师', tier: '大师' }, MASTER),
  predictedLoss: { 大师: masterRef, 高手: preds['高手'], 进阶: preds['进阶'], 业余: preds['业余'] },
};
const outPath = path.join(__dirname, 'tier_tiers.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('wrote ' + outPath);
