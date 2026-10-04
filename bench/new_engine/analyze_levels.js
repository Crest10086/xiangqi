/* new_engine/analyze_levels.js — TEST-ONLY analyzer for card t_ef6e93b8.
 * Usage: node analyze_levels.js levels_smoke.log levels_r1.log levels_r2.log ...
 *
 * Score convention: engine side-to-move view.
 *   loss(pos,cfg,round) = anchor_score + ref_score_after_chosen_move
 *   (anchor = best eval for the mover; after playing the chosen move the position from the
 *    mover's view is -ref; loss = anchor - (-ref) = anchor + ref.)  Lower loss = stronger play.
 * Outputs per-group (opening/midgame) per-config mean/median loss across rounds, per-round
 * values (variance signal), mean gap (top1 - chosen slot score), depth/nodes ranges, crit counts.
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
const rows = []; // {round,pos,group,cfg,type,fields}
const meta = {}; // pos -> group

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

// group map from level_positions.json
const posDefs = JSON.parse(fs.readFileSync(path.join(__dirname, 'level_positions.json'), 'utf8'));
for (const p of posDefs) meta[p.id] = p.group;

const CFGS = ['AM', 'AD', 'EX', 'GM', 'S1T300'];
const groups = ['opening', 'midgame'];
const rounds = [...new Set(rows.map(r => r.round))].sort((a, b) => a - b);

function stat(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const med = s[Math.floor(s.length / 2)];
  return { n: arr.length, mean: +mean.toFixed(1), median: med, min: s[0], max: s[s.length - 1] };
}

const out = { rounds, perGroup: {}, variance: {}, gaps: {}, search: {}, crit: 0, skips: [] };

for (const g of groups) {
  const posIds = posDefs.filter(p => p.group === g).map(p => p.id);
  out.perGroup[g] = {};
  for (const cfg of CFGS) {
    const perRound = {};
    const allLoss = [];
    for (const r of rounds) {
      const losses = [];
      for (const pid of posIds) {
        const anchor = rows.find(x => x.round === r && x.pos === pid && x.type === 'ANCHOR');
        const sel = rows.find(x => x.round === r && x.pos === pid && x.cfg === cfg && x.type === 'SEL');
        const ref = rows.find(x => x.round === r && x.pos === pid && x.cfg === cfg && x.type === 'REF');
        if (!anchor || !sel || !ref) { out.skips.push({ r, pid, cfg }); continue; }
        const loss = (+anchor.fields.score) + (+ref.fields.score);
        losses.push({ pid, loss, anchor: +anchor.fields.score, ref: +ref.fields.score, selMove: sel.fields.move, gap: +sel.fields.gap });
        allLoss.push(loss);
      }
      perRound[r] = losses;
    }
    out.perGroup[g][cfg] = { overall: stat(allLoss), perRound: {} };
    for (const r of rounds) {
      const losses = perRound[r].map(x => x.loss);
      out.perGroup[g][cfg].perRound[r] = { stat: stat(losses), detail: perRound[r] };
    }
  }
}

// best-move agreement: does cfg's chosen move equal GM's (deepest search) chosen move?
out.agreement = {};
for (const g of groups) {
  const posIds = posDefs.filter(p => p.group === g).map(p => p.id);
  for (const cfg of CFGS) {
    let agree = 0, tot = 0;
    for (const r of rounds) {
      for (const pid of posIds) {
        const gm = rows.find(x => x.round === r && x.pos === pid && x.cfg === 'GM' && x.type === 'SEL');
        const cf = rows.find(x => x.round === r && x.pos === pid && x.cfg === cfg && x.type === 'SEL');
        if (!gm || !cf) continue;
        tot++;
        if (cf.fields.move === gm.fields.move) agree++;
      }
    }
    out.agreement[g + '|' + cfg] = { agree, total: tot, rate: tot ? +(agree / tot).toFixed(3) : null };
  }
}

// cross-round variance on the chosen move per position+cfg
const vm = {};
for (const r of rows) {
  if (r.type !== 'SEL') continue;
  const k = r.pos + '|' + r.cfg;
  (vm[k] = vm[k] || []).push({ round: r.round, move: r.fields.move, slots: r.fields.slots });
}
let total = 0, same = 0;
for (const k of Object.keys(vm)) {
  const arr = vm[k];
  if (arr.length < 2) continue;
  total++;
  const moves = new Set(arr.map(a => a.move));
  if (moves.size === 1) same++;
  out.variance[k] = arr;
}
out.varianceSummary = { positionsCfgPairs: total, identicalAcrossRounds: same, unstable: total - same };

// gap stats (top1 - chosen) per cfg per group
for (const g of groups) {
  const posIds = posDefs.filter(p => p.group === g).map(p => p.id);
  for (const cfg of CFGS) {
    const gaps = rows.filter(r => r.type === 'SEL' && r.cfg === cfg && posIds.includes(r.pos)).map(r => +r.fields.gap);
    const depths = rows.filter(r => r.type === 'SEL' && r.cfg === cfg && posIds.includes(r.pos)).map(r => +r.fields.depth);
    const nodes = rows.filter(r => r.type === 'SEL' && r.cfg === cfg && posIds.includes(r.pos)).map(r => +r.fields.nodes);
    out.gaps[g + '|' + cfg] = stat(gaps);
    out.search[g + '|' + cfg] = {
      depthMin: Math.min(...depths), depthMax: Math.max(...depths),
      nodesMin: Math.min(...nodes), nodesMax: Math.max(...nodes),
    };
  }
}
out.crit = rows.filter(r => +r.fields.crit > 0).length;
out.skipCount = out.skips.length;

fs.writeFileSync(path.join(__dirname, '..', 'new_engine_logs', 'levels_analysis.json'), JSON.stringify(out, null, 1));

// human-readable table
function fmt(s) { return s ? 'n=' + s.n + ' mean=' + s.mean + ' med=' + s.median + ' min=' + s.min + ' max=' + s.max : 'NO DATA'; }
for (const g of groups) {
  console.log('==== group: ' + g + ' ====');
  console.log('cfg       | overall loss                | ' + rounds.map(r => 'r' + r).join(' | '));
  for (const cfg of CFGS) {
    const e = out.perGroup[g][cfg];
    console.log(cfg.padEnd(9) + '| ' + fmt(e.overall).padEnd(27) + '| ' + rounds.map(r => fmt(e.perRound[r] ? e.perRound[r].stat : null)).join(' | '));
  }
  console.log('gap(top1-chosen): ' + CFGS.map(c => c + '=' + JSON.stringify(out.gaps[g + '|' + c])).join('  '));
  console.log('search: ' + CFGS.map(c => c + '=' + JSON.stringify(out.search[g + '|' + c])).join('  '));
}
console.log('variance:', JSON.stringify(out.varianceSummary));
console.log('agreement with GM move:', JSON.stringify(out.agreement));

// pairwise dominance per position (strict monotonicity evidence)
for (const g of groups) {
  const pairs = [['AM', 'AD'], ['AD', 'EX'], ['EX', 'GM'], ['AM', 'EX'], ['S1T300', 'AD']];
  const res = {};
  for (const [a, b] of pairs) {
    let aWorse = 0, tie = 0, bWorse = 0, tot = 0;
    const posIds = posDefs.filter(p => p.group === g).map(p => p.id);
    for (const r of rounds) {
      for (const pid of posIds) {
        const la = out.perGroup[g][a].perRound[r] && out.perGroup[g][a].perRound[r].detail.find(d => d.pid === pid);
        const lb = out.perGroup[g][b].perRound[r] && out.perGroup[g][b].perRound[r].detail.find(d => d.pid === pid);
        if (!la || !lb) continue;
        tot++;
        if (la.loss > lb.loss + 5) aWorse++;
        else if (lb.loss > la.loss + 5) bWorse++;
        else tie++;
      }
    }
    res[a + ' worse than ' + b] = { aWorse, tie, bWorse, total: tot };
  }
  console.log('monotonicity (' + g + '):', JSON.stringify(res));
}
console.log('crit lines:', out.crit, 'skips:', out.skipCount);
