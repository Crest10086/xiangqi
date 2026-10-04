/* new_engine/tier_verify.js — offline replay + analysis of a tier_driver log (card t_a8096ea3).
 * Run: node tier_verify.js <logname> [more.log ...]
 *   logname is looked up in ../new_engine_logs/ (bare names) or used as given.
 * Writes tier_analysis.json next to the logs and prints the calibration tables.
 *
 * What it does, and why it is trustworthy:
 *   1. Replays the selection from the LOGGED candidate pool using tier_rules.js — the same module
 *      the browser used (same seed formula: strHash(round|pos|cfg) ^ seedSalt). Any disagreement
 *      means the harness and the tested rule diverged, and that is reported, not smoothed over.
 *   2. For every (cfg, position) it computes the REF reply score minus the ANCHOR score in
 *      side-to-move centipawns = the cost of playing this tier's move instead of the best move.
 *      That is the same yardstick NEW_ENGINE_LEVELS_BASELINE.md uses, so numbers compare with the
 *      three weak-tier cards.
 *   3. Reports E[gap] predicted by tier_rules.expectedGap from the logged pools next to the
 *      measured cost — the calibration model that lets unseen (cap, band, p) points be predicted
 *      from ONE round instead of a new experiment per point.
 */
const fs = require('fs');
const path = require('path');
const T = require('./tier_rules.js');

const LOGDIR = path.join(__dirname, '..', 'new_engine_logs');
const args = process.argv.slice(2);
if (!args.length) { console.log('usage: node tier_verify.js <logname> [...]'); process.exit(2); }
let explicitSalt = null;
const logs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--salt') { explicitSalt = +args[++i]; continue; }
  if (args[i] === '--out') { i++; continue; }
  logs.push(args[i]);
}

/* cfg objects come from the generator's task files, so the replay uses the EXACT cfg objects the
 * browser used (the log carries only the id). seedSalt likewise comes from the task file. */
const CFGS = {};
const SALT_BY_ROUND = {};   // each round has its own seedSalt (tier_gen_task.js), so the replay
                           // must use the salt of the round the line came from, not one global salt
for (const f of fs.readdirSync(__dirname)) {
  if (!/^task_tier(_r\d+|_smoke)\.json$/.test(f)) continue;
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  for (const c of t.configs) CFGS[c.id] = c;
  if (t.seedSalt) SALT_BY_ROUND[t.round] = t.seedSalt;
}
const saltOfRound = (r) => (explicitSalt !== null ? explicitSalt
  : (SALT_BY_ROUND[r] !== undefined ? SALT_BY_ROUND[r] : 97000));
const cfgOf = (id) => { const c = CFGS[id]; if (!c) throw new Error('unknown cfg id ' + id + ' (task file missing?)'); return c; };
const groupOf = (posId) => (/^OP/.test(posId) ? 'opening' : 'midgame');

function readLog(n) {
  const p = n.includes(path.sep) || n.endsWith('.log') && fs.existsSync(n) ? n : path.join(LOGDIR, n);
  const q = fs.existsSync(p) ? p : path.join(LOGDIR, n + '.log');
  if (!fs.existsSync(q)) throw new Error('no such log: ' + n);
  return fs.readFileSync(q, 'utf8').split(/\r?\n/);
}

/* ---------------- parse ---------------- */
const SEL_RE = /\|SEL\|move=(\S+)\|slotScore=(\S+)\|top1=(\S+)\|gap=(\S+)\|rule=(\S+)\|hit=(\S+)\|slotUsed=(\d+)\|seed=(\d+)\|probs=(.*?)\|depth=(\S*)\|nodes=(\S*)\|slots=(.*?)\|smoves=(.*?)\|crit=(\d+)/;
const ANCH_RE = /\|ANCHOR\|move=(\S+)\|score=(\S+)\|mate=(\S+)\|depth=(\S*)\|nodes=(\S*)\|crit=(\d+)/;
const REF_RE = /\|REF\|move=(\S+)\|score=(\S+)\|mate=(\S+)/;

const state = new Map();   // posId -> {anchor, cfgs:{}}
const order = [];
let replayChecked = 0, replayMismatch = [], skips = 0, lines = 0;

function ensure(pos) {
  if (!state.has(pos)) { state.set(pos, { cfgs: {} }); order.push(pos); }
  return state.get(pos);
}

for (const name of logs) {
  for (const line of readLog(name)) {
    if (!line.startsWith('L|')) continue;
    lines++;
    const parts = line.split('|');
    const round = +parts[1], posId = parts[2], cfgId = parts[3];
    const rec = ensure(posId);
    if (line.includes('|ANCHOR|')) {
      const m = line.match(ANCH_RE);
      if (m) rec.anchor = { move: m[1], score: +m[2], nodes: m[4] === '-' ? null : +m[4] };
      continue;
    }
    if (line.includes('|SKIP|')) { skips++; continue; }
    const m = line.match(SEL_RE);
    if (!m) continue;
    const cfgId2 = cfgId;
    const slots = {};
    for (const tok of m[12].split(',')) {
      const i = tok.indexOf(':');
      if (i > 0) slots[+tok.slice(0, i)] = { score: +tok.slice(i + 1) };
    }
    for (const tok of m[13].split(',')) {
      const i = tok.indexOf(':');
      if (i > 0 && slots[+tok.slice(0, i)]) slots[+tok.slice(0, i)].pv = [tok.slice(i + 1)];
    }
    const pool = { slots: slots };
    const cfg = cfgOf(cfgId2);
    const seed = (T.strHash(round + '|' + posId + '|' + cfgId2) ^ saltOfRound(round)) >>> 0;
    const replay = T.pick(cfg, pool, { group: groupOf(posId) }, seed);
    replayChecked++;
    if (!replay.skip && (replay.move !== m[1] || replay.slotUsed !== +m[7])) {
      replayMismatch.push({ log: name, round: round, pos: posId, cfg: cfgId2, logged: m[1] + '/' + m[7], replay: replay.move + '/' + replay.slotUsed });
    }
    rec.cfgs[cfgId2] = {
      cfg: cfg, hit: m[6], slotUsed: +m[7], move: m[1], gap: +m[4], top1: +m[3],
      nodes: m[11] === '-' ? null : +m[11], depth: m[10] === '-' ? null : +m[10],
      crit: +m[14], seed: seed, cands: T.candidates(pool),
      predicted: T.expectedGap(cfg, T.candidates(pool), groupOf(posId)),
      cls: T.classify(cfg, groupOf(posId), T.candidates(pool)),
      probs: m[9] || '',
    };
  }
}

/* second pass: REF scores */
for (const name of logs) {
  for (const line of readLog(name)) {
    if (!line.startsWith('L|')) continue;
    const parts = line.split('|');
    const posId = parts[2], cfgId = parts[3];
    if (!line.includes('|REF|')) continue;
    const m = line.match(REF_RE);
    const rec = state.get(posId);
    if (!m || !rec || !rec.cfgs[cfgId]) continue;
    rec.cfgs[cfgId].refScore = +m[2];
  }
}

/* ---------------- analysis ---------------- */
function lossOf(rec, cfgId) {
  const c = rec.cfgs[cfgId];
  if (!c || c.refScore === undefined || !rec.anchor) return null;
  // Same yardstick as analyze_alt.js: ANCHOR scores the position for the side to move, REF scores
  // it AFTER our move from the opponent's side, so the centipawns given up = anchor + ref.
  return rec.anchor.score + c.refScore;
}
function pct(a, q) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; const i = Math.min(s.length - 1, Math.floor(q * (s.length - 1))); return s[i]; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function fmt(x, d) { return x === null || x === undefined ? '-' : (typeof x === 'number' ? x.toFixed(d === undefined ? 1 : d) : x); }

const cfgIds = [];
for (const posId of order) for (const id of Object.keys(state.get(posId).cfgs)) if (!cfgIds.includes(id)) cfgIds.push(id);

const out = { generated: new Date().toISOString(), logs: logs, salts: SALT_BY_ROUND, lines: lines, skips: skips,
             replay: { checked: replayChecked, mismatch: replayMismatch.length, samples: replayMismatch.slice(0, 10) },
             positions: order.length, perCfg: {}, perCfgByGroup: {}, perPosition: {}, cost: {} };

for (const id of cfgIds) {
  const costs = [], gaps = [], pred = [], nodes = [], hits = {};
  const byGroup = { opening: [], midgame: [] };
  const hard = { n: 0, cost: [], gap: [] };
  for (const posId of order) {
    const rec = state.get(posId);
    const c = rec.cfgs[id];
    if (!c) continue;
    const g = groupOf(posId);
    const cost = lossOf(rec, id);
    hits[c.hit] = (hits[c.hit] || 0) + 1;
    gaps.push(c.gap); pred.push(c.predicted);
    if (c.nodes !== null) nodes.push(c.nodes);
    if (cost !== null) { costs.push(cost); byGroup[g].push(cost); }
    if (c.cls === 'hard') { hard.n++; if (cost !== null) hard.cost.push(cost); hard.gap.push(c.gap); }
  }
  out.perCfg[id] = {
    n: gaps.length, cfg: CFGS[id],
    hitShare: Object.keys(hits).map(k => k + ':' + (hits[k] / gaps.length).toFixed(2)).join(','),
    gapMean: mean(gaps), gapMedian: pct(gaps, 0.5), gapMax: gaps.length ? Math.max.apply(null, gaps) : null,
    predictedGap: mean(pred),
    costMean: mean(costs), costMedian: pct(costs, 0.5), costP25: pct(costs, 0.25), costP75: pct(costs, 0.75),
    costOpening: mean(byGroup.opening), costMidgame: mean(byGroup.midgame),
    nodesMean: mean(nodes),
    hardN: hard.n, hardCostMean: mean(hard.cost),
  };
}

console.log('log lines=' + lines + ' positions=' + order.length + ' cfgs=' + cfgIds.length + ' skips=' + skips + ' salts=' + JSON.stringify(SALT_BY_ROUND));
console.log('replay check: ' + replayChecked + ' selections replayed from the logged pools, mismatches=' + replayMismatch.length);
for (const s of out.replay.samples) console.log('  MISMATCH ' + JSON.stringify(s));
console.log('');

const hdr = ['cfg', 'n', 'hitShare', 'gapMean', 'gapMed', 'gapMax', 'predGap', 'costMean', 'costMed', 'costOpen', 'costMid', 'hardN', 'hardCost', 'nodesMean'];
console.log(hdr.join('\t'));
for (const id of cfgIds) {
  const c = out.perCfg[id];
  console.log([id, c.n, c.hitShare, fmt(c.gapMean), fmt(c.gapMedian), fmt(c.gapMax), fmt(c.predictedGap),
    fmt(c.costMean), fmt(c.costMedian), fmt(c.costOpening), fmt(c.costMidgame), c.hardN, fmt(c.hardCostMean),
    fmt(c.nodesMean, 0)].join('\t'));
}

/* per-position detail: which positions produce no cost at any cap (the 少子形 problem) */
console.log('\nper-position loss by cfg (centipawns given up vs the ANCHOR best move; 0 = played the best move)');
console.log(['pos', 'n_cfgs'].concat(cfgIds).join('\t'));
for (const posId of order) {
  const rec = state.get(posId);
  const row = [posId, Object.keys(rec.cfgs).length];
  for (const id of cfgIds) {
    const c = lossOf(rec, id);
    row.push(c === null ? '-' : c);
  }
  console.log(row.join('\t'));
  // the candidate gap list of the fixed-budget pool (first tier-rule cfg seen): the calibration
  // model evaluates unseen (cap, band, p) points against these recorded pools.
  let poolGaps = null, poolCls = null;
  for (const id of cfgIds) {
    const c = rec.cfgs[id];
    if (c && c.cfg && c.cfg.rule === 'tier') { poolGaps = c.cands.map(x => x.gap); poolCls = c.cls; break; }
  }
  const byCfg = (fn) => { const o = {}; for (const id of cfgIds) o[id] = fn(id); return o; };
  out.perPosition[posId] = { anchor: rec.anchor, group: groupOf(posId), poolGaps: poolGaps, poolCls: poolCls,
    lossByCfg: byCfg(id => lossOf(rec, id)),
    gapByCfg: byCfg(id => rec.cfgs[id] ? rec.cfgs[id].gap : null),
    hitByCfg: byCfg(id => rec.cfgs[id] ? rec.cfgs[id].hit : null),
    clsByCfg: byCfg(id => rec.cfgs[id] ? rec.cfgs[id].cls : null) };
}

const outArgIdx = args.indexOf('--out');
const outPath = outArgIdx >= 0 ? path.resolve(args[outArgIdx + 1]) : path.join(LOGDIR, 'tier_analysis.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('\nwrote ' + outPath);
