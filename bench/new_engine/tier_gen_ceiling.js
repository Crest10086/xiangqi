/* new_engine/tier_gen_ceiling.js — TEST-ONLY 大师上限 task generator (card t_a8096ea3).
 * Usage: node tier_gen_ceiling.js      -> task_tier_r3.json  (round 3, consumed by tier_verify.js)
 *
 * The 大师 tier has no cap/p: it is the ceiling. What still has to be measured is HOW MUCH extra
 * thinking is worth, because the contract forbids using thinking time as a strength knob for the
 * middle tiers — so the middle tiers must be shown to be reachable (and distinguishable) at ONE
 * fixed budget, while 大师 is the one rung where movetime IS the parameter.
 *
 * Configs (all rule 'tier' with cap 0 / p 0, i.e. "always the best candidate" — the master
 * behaviour, expressed in the same rule the tiers use so the numbers are directly comparable):
 *   M300M8  MultiPV=8, 300 ms  — the tier budget's best candidate (the cap-0 control)
 *   M1000   MultiPV=1, 1000 ms, Hash 256
 *   M2000   MultiPV=1, 2000 ms, Hash 256  (= the ANCHOR configuration)
 *   M4000   MultiPV=1, 4000 ms, Hash 256
 *   M8000   MultiPV=1, 8000 ms, Hash 256  — the practical upper bound probe
 * Positions: 6 (3 opening + 3 midgame) — enough to see depth/nodes growth and its (non-)effect on
 * loss, cheap enough to run alongside the calibration.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const XQ = require(path.join(ROOT, '..', '..', 'engine.js'));

function uciOf(m) { const L = 'abcdefghi'; return L[m.f % 9] + (9 - Math.floor(m.f / 9)) + L[m.t % 9] + (9 - Math.floor(m.t / 9)); }
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'level_positions.json'), 'utf8'));
const KEEP = ['OP00', 'OP06', 'OP08', 'MG_QT05', 'MG_QT14', 'MG_QB3'];
const positions = [];
for (const p of src) {
  if (!KEEP.includes(p.id)) continue;
  const MAP = { K: 1, A: 2, B: 3, C: 6, N: 4, R: 5, P: 7 };
  const board = new Array(90).fill(0);
  p.fen.split(' ')[0].split('/').forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/[0-9]/.test(ch)) { c += +ch; continue; }
      const v = MAP[ch.toUpperCase()];
      board[r * 9 + c] = (ch === ch.toUpperCase()) ? v : -v;
      c++;
    }
  });
  const legal = XQ.legalMoves(board, p.side).map(uciOf);
  if (!legal.length) throw new Error('fixture ' + p.id + ' has no legal moves');
  positions.push({ id: p.id, group: p.group, fen: p.fen, side: p.side, legal: legal });
}

const master = (id, movetime, multipv) => ({ id: id, multipv: multipv || 1, movetime: movetime, hash: 256, rule: 'tier', cap: 0, p: 0 });
const CONFIGS = [
  master('M300M8', 300, 8),
  master('M1000', 1000),
  master('M2000', 2000),
  master('M4000', 4000),
  master('M8000', 8000),
  { id: 'ANCH', multipv: 1, movetime: 0, hash: 256, rule: 'anchor' },
];

const task = {
  round: 3, seedSalt: 97000 + 3 * 977,
  refMs: 2000, refHash: 256,
  pre: ['setoption name Threads value 4', 'setoption name Hash value 256', 'setoption name MultiPV value 1'],
  configs: CONFIGS,
  positions: positions,
};
fs.writeFileSync(path.join(ROOT, 'task_tier_r3.json'), JSON.stringify(task, null, 1));
console.log('wrote task_tier_r3.json positions=' + positions.length + ' configs=' + CONFIGS.length);
console.log('searches =', positions.length * (1 + 2 * (CONFIGS.length - 1) + 1));
