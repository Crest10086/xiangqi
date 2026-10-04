/* new_engine/tier_gen_task.js — TEST-ONLY task generator for card t_a8096ea3
 * (按新契约定五档参数：小 cap 区间标定 + 业余档定型 + 五档互弈).
 *
 * Usage: node tier_gen_task.js <round> [smoke]      -> task_tier_r<round>.json
 *
 * Positions are the SAME 17 as bench/NEW_ENGINE_LEVELS_BASELINE.md (level_positions.json) so every
 * number is directly comparable with the three weak-tier cards that came before.
 *
 * ONE fixed search budget (movetime 300 / MultiPV 8 / Hash 64 / Threads 4) for every tier config:
 * the contract forbids building the ladder out of movetime/Hash, so the only things that vary are
 * cap / p / mistakeBand. Two controls make that claim testable instead of asserted:
 *   MT150  — the same cap at a different movetime (must be indistinguishable from CAP80)
 *   CAP0   — cap 0 (always the best candidate) = the master-equivalent reference at this budget
 *
 *   CAP0/25/50/80/150  the small-cap ladder the card asks to calibrate (p = 0)
 *   P10/P25/P50        the mistake dimension at a fixed cap 80 (p ladder)
 *   G10                a 高手 candidate: small cap + a small mistake probability
 *   HRD                the 少子形 (HARD) handling: hardCap 0 + hardMistakeBand 700, p 0.25
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const XQ = require(path.join(ROOT, '..', '..', 'engine.js'));

const roundArg = (process.argv[2] || '1');
const round = Number.isFinite(+(roundArg.replace(/^t/, ''))) ? +roundArg.replace(/^t/, '') : 1;
const smoke = process.argv[3] === 'smoke';

const MOVETIME = 300, HASH = 64, MPV = 8;

const CONFIGS = [
  // --- cap ladder at p=0: what cap actually costs, in the small range the tiers need ---
  { id: 'CAP0',   multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 0,   p: 0 },
  { id: 'CAP25',  multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 25,  p: 0 },
  { id: 'CAP50',  multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 50,  p: 0 },
  { id: 'CAP80',  multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 80,  p: 0 },
  { id: 'CAP150', multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 150, p: 0 },
  // --- mistake dimension at a fixed cap: p ladder ---
  { id: 'P10', multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 80, p: 0.10, mistakeBand: 200 },
  { id: 'P25', multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 80, p: 0.25, mistakeBand: 200 },
  { id: 'P50', multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 80, p: 0.50, mistakeBand: 200 },
  // --- 高手 candidate: near-master stable + occasional mistake ---
  { id: 'G10', multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 25, p: 0.10, mistakeBand: 200 },
  // --- 少子形 handling: the mistake dimension must be what drops a piece there, not the cap ---
  { id: 'HRD', multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier', cap: 80, p: 0.25, mistakeBand: 200, hardCap: 0, hardMistakeBand: 700 },
  // --- control: same cap, different movetime (must be indistinguishable) ---
  { id: 'MT150', multipv: MPV, movetime: 150, hash: HASH, rule: 'tier', cap: 80, p: 0 },
  // --- metric noise floor ---
  { id: 'ANCH', multipv: 1, movetime: 0, hash: 256, rule: 'anchor' },
];

function uciOf(m) {
  const L = 'abcdefghi';
  return L[m.f % 9] + (9 - Math.floor(m.f / 9)) + L[m.t % 9] + (9 - Math.floor(m.t / 9));
}

const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'level_positions.json'), 'utf8'));
const positions = [];
for (const p of src) {
  if (smoke && p.id !== 'OP00' && p.id !== 'MG_QT01' && p.id !== 'MG_QB3') continue;
  const board = new Array(90).fill(0);
  const MAP = { K: 1, A: 2, B: 3, C: 6, N: 4, R: 5, P: 7 };
  const rows = p.fen.split(' ')[0].split('/');
  let ok = rows.length === 10;
  rows.forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/[0-9]/.test(ch)) { c += +ch; continue; }
      const v = MAP[ch.toUpperCase()];
      if (!v) { ok = false; return; }
      board[r * 9 + c] = (ch === ch.toUpperCase()) ? v : -v;
      c++;
    }
    if (c !== 9) ok = false;
  });
  if (!ok) { console.log('BAD FEN parse', p.id); continue; }
  positions.push({ id: p.id, group: p.group, fen: p.fen, side: p.side, legal: XQ.legalMoves(board, p.side).map(uciOf) });
}

const task = {
  // independent PRNG stream for this card (main 90000 / calib 95000 / bounded 96000 are taken)
  round: round,
  seedSalt: 97000 + round * 977,
  refMs: 2000,
  refHash: 256,
  pre: ['setoption name Threads value 4', 'setoption name Hash value 64', 'setoption name MultiPV value 1'],
  configs: CONFIGS,
  positions: positions,
};

const name = smoke ? 'task_tier_smoke.json' : 'task_tier_r' + round + '.json';
fs.writeFileSync(path.join(ROOT, name), JSON.stringify(task, null, 1));
console.log('wrote', name, 'positions=' + positions.length, 'configs=' + CONFIGS.length);
console.log('searches per round =', positions.length * (1 + 2 * CONFIGS.length));
