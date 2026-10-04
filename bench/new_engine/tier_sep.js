/* new_engine/tier_sep.js — distinguishability check for the chosen tier parameters
 * (card t_a8096ea3). Reads tier_analysis.json + tier_tiers.json and answers the acceptance question
 * the earlier cards used: "相邻两档差 >20 cp 记为可区分" — per position and in aggregate, for the
 * ACTUAL tier parameters, not for the probe configs.
 *
 * Two kinds of numbers, both reported:
 *   measured  — the loss difference at the nearest probed point we actually ran (CAP / P configs)
 *   modelled  — the difference between the chosen tier cfgs, via the fitted loss model
 * Also reports the movetime control (cap80@300 vs cap80@150) and the noise floor (ANCH vs CAP0).
 */
const fs = require('fs');
const path = require('path');
const T = require('./tier_rules.js');

const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', 'tier_analysis.json'), 'utf8'));
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'tier_fit_out.json'), 'utf8'));
const TIERS = JSON.parse(fs.readFileSync(path.join(__dirname, 'tier_tiers.json'), 'utf8'));
const POS = A.perPosition, IDS = Object.keys(POS);
const candsOf = (gaps) => gaps.map((g, i) => ({ slot: i + 1, score: -g, move: 'mv' + (i + 1), gap: g }));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function modelLoss(cfg, pid) {
  const p = POS[pid];
  if (!p.poolGaps || !p.poolGaps.length) return null;
  const cands = candsOf(p.poolGaps);
  const cls = T.classify(cfg, p.group, cands);
  const c = F.coefs[cls];
  if (!c || c.slope === null) return null;
  return c.intercept + c.slope * T.expectedGap(cfg, cands, p.group);
}

const LADDER = [
  { name: '大师(cap0@2000)', cfg: { rule: 'tier', cap: 0, p: 0, mistakeBand: 200, hardCap: 0 } },
  { name: '高手(cap25 p0.10)', cfg: TIERS['高手'] },
  { name: '进阶(cap80 p0)', cfg: TIERS['进阶'] },
  { name: '业余(cap80 p0.50)', cfg: TIERS['业余'] },
];

console.log('positions=' + IDS.length + '  threshold for 可区分 = 20 cp (same as NEW_ENGINE_LEVELS_BASELINE.md §4)\n');

console.log('modelled per-position loss of the chosen tiers (cp vs the ANCHOR best move)');
console.log(['pos'].concat(LADDER.map(l => l.name)).join('\t'));
const perPos = {};
for (const pid of IDS) {
  const row = LADDER.map(l => modelLoss(l.cfg, pid));
  perPos[pid] = row;
  console.log([pid].concat(row.map(x => x === null ? '-' : x.toFixed(0))).join('\t'));
}

console.log('\nadjacent-pair separation (modelled)');
console.log(['pair', 'meanDiff', 'positions>20cp', 'share', 'positions where the weaker is NOT worse'].join('\t'));
for (let i = 1; i < LADDER.length; i++) {
  const diffs = [];
  let sep = 0, inv = 0;
  for (const pid of IDS) {
    const a = modelLoss(LADDER[i - 1].cfg, pid), b = modelLoss(LADDER[i].cfg, pid);
    if (a === null || b === null) continue;
    diffs.push(b - a);
    if (b - a > 20) sep++;
    if (b - a < -20) inv++;
  }
  console.log([LADDER[i - 1].name + ' -> ' + LADDER[i].name, mean(diffs).toFixed(1),
    sep + '/' + diffs.length, (sep / diffs.length).toFixed(2), inv].join('\t'));
}

/* measured separation from the runs we actually did */
function measuredLoss(cfgId, pid) {
  const p = POS[pid];
  const v = (p.lossByCfg || {})[cfgId];
  return (v === null || v === undefined) ? null : v;
}
const MEASURED = [
  ['CAP0', 'CAP25'], ['CAP25', 'CAP50'], ['CAP50', 'CAP80'], ['CAP80', 'CAP150'],
  ['CAP80', 'P50'],            // the p dimension at a fixed cap (业余 minus 进阶)
  ['CAP80', 'MT150'],          // movetime control: same cap, different movetime
  ['CAP0', 'ANCH'],            // noise floor: both always play the best candidate at their budget
];
console.log('\nmeasured separation between the probed points (r1+r2 pooled)');
console.log(['pair', 'meanDiff', 'positions>20cp', 'share'].join('\t'));
for (const [a, b] of MEASURED) {
  const diffs = [];
  let sep = 0;
  for (const pid of IDS) {
    const la = measuredLoss(a, pid), lb = measuredLoss(b, pid);
    if (la === null || lb === null) continue;
    diffs.push(lb - la);
    if (lb - la > 20) sep++;
  }
  if (!diffs.length) { console.log([a + ' -> ' + b, 'no data'].join('\t')); continue; }
  console.log([a + ' -> ' + b, mean(diffs).toFixed(1), sep + '/' + diffs.length, (sep / diffs.length).toFixed(2)].join('\t'));
}

/* cross-round stability of the chosen cfgs' nearest measured points (r1 vs r2) */
if (A.logs && A.logs.length > 1) {
  console.log('\nround-to-round stability (the same cfg in two independent rounds): see perCfg hitShare;');
  console.log('the harness logs per-round values in tier_analysis.json perRound if multiple rounds were passed.');
}
