/* new_engine/tier_gen_ceiling2.js — TEST-ONLY 大师 movetime 上限 + 内存/首载代价 (card t_a8096ea3,
 * review round 1 item 3).
 * Usage: node tier_gen_ceiling2.js      -> task_tier_r5.json  (round 5, consumed by tier_verify.js)
 *
 * Why: r3 measured the 大师 ceiling on 6 positions only, and the contract on t_9c93fb06 asks for the
 * master movetime to be MEASURED "including memory and first-load cost", not inherited from the old
 * 6000 ms default. This round:
 *   - 10 positions (up from 6; the two 少子形/HARD fixtures are kept because the master plays the
 *     best candidate there and they are exactly the complex positions the review says are missing),
 *   - a movetime ladder that INCLUDES 6000 ms: 1000 / 2000 / 4000 / 6000 / 8000, all MultiPV=1
 *     Hash=256, rule 'tier' cap 0 p 0 (the master behaviour expressed in the tier rule),
 *   - plus the tier-budget reference M300M8 (MultiPV 8 / 300 ms / Hash 64) and the ANCH noise floor,
 *   - and after every config the driver asks the worker for its WASM heap size and Chrome's
 *     measured memory (worker_mb.js 'heapreq' / 'measure'), so the cost of a bigger movetime/Hash is
 *     a number in the log instead of an assumption. First-load cost (NNUE bytes, importScripts /
 *     initialize timings, heap at 'ready') is logged once at startup.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const XQ = require(path.join(ROOT, '..', '..', 'engine.js'));

function uciOf(m) { const L = 'abcdefghi'; return L[m.f % 9] + (9 - Math.floor(m.f / 9)) + L[m.t % 9] + (9 - Math.floor(m.t / 9)); }
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'level_positions.json'), 'utf8'));
// 10 positions: 3 openings + 7 midgame (includes both HARD fixtures MG_QT01 / MG_QT19)
const KEEP = ['OP00', 'OP06', 'OP08', 'MG_QT05', 'MG_QT10', 'MG_QT14', 'MG_QT19', 'MG_QT01', 'MG_QB3', 'MG_QB9'];
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

const master = (id, movetime, multipv, hash) => ({ id: id, multipv: multipv || 1, movetime: movetime, hash: hash, rule: 'tier', cap: 0, p: 0 });
const CONFIGS = [
  master('M300M8', 300, 8, 64),      // the tier budget's best candidate (reference)
  master('M1000', 1000, 1, 256),
  master('M2000', 2000, 1, 256),     // = the ANCHOR configuration, the value currently decided
  master('M4000', 4000, 1, 256),
  master('M6000', 6000, 1, 256),     // the old default — measured, not inherited
  master('M8000', 8000, 1, 256),
  { id: 'ANCH', multipv: 1, movetime: 0, hash: 256, rule: 'anchor' },
];

const task = {
  round: 5, seedSalt: 97000 + 5 * 977,
  refMs: 2000, refHash: 256,
  pre: ['setoption name Threads value 4', 'setoption name Hash value 256', 'setoption name MultiPV value 1'],
  configs: CONFIGS,
  positions: positions,
  memProbe: true,   // tier_driver asks the worker for heap + measured memory after each config
};
fs.writeFileSync(path.join(ROOT, 'task_tier_r5.json'), JSON.stringify(task, null, 1));
console.log('wrote task_tier_r5.json positions=' + positions.length + ' configs=' + CONFIGS.length);
console.log('searches =', positions.length * (1 + 2 * (CONFIGS.length - 1) + 1));
