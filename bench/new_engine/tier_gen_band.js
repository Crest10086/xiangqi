/* new_engine/tier_gen_band.js — TEST-ONLY mistakeBand ladder (card t_a8096ea3, review round 1 item 1).
 * Usage: node tier_gen_band.js            -> task_tier_r4.json  (round 4, consumed by tier_verify.js)
 *
 * Why this round exists: the review showed that p's EFFECT is capped by the band. At cap 80 the
 * mistake band is empty in most of the 17 calibration pools, so p=0.50 only produced a real
 * (worse-than-stable) move on ~12% of the calibration selections. The reviewer asked for the three
 * band settings to be MEASURED, not reasoned about:
 *     band = cap + 50 | cap + 200 | no upper bound
 * on the SAME 17 positions and the SAME fixed search budget (movetime 300 / MultiPV 8 / Hash 64).
 *
 * Configs:
 *   CAP80   cap 80 p 0            — within-round reference (the stable strength of the 业余/进阶 cap)
 *   B50/B200/BINF  cap 80 p 0.50 with mistakeBand 50 / 200 / 100000 ("no upper bound")
 *   G50/G200/GINF  cap 25 p 0.10 with the same three bands  (the 高手 rung: same question, small p)
 *   ANCH    metric noise floor (replays the ANCHOR pool, no extra pool search)
 *
 * Everything else (positions, budget, seed recipe, ANCHOR/REF yardstick) is byte-identical to
 * tier_gen_task.js, so B200 here must reproduce the r1/r2 P50 point within noise — that is the
 * internal consistency check of this round.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const XQ = require(path.join(ROOT, '..', '..', 'engine.js'));

const MOVETIME = 300, HASH = 64, MPV = 8;
const BAND_INF = 100000;   // "no upper bound": larger than any pool gap the engine can report

const tier = (id, cap, p, band) => ({
  id: id, multipv: MPV, movetime: MOVETIME, hash: HASH, rule: 'tier',
  cap: cap, p: p, mistakeBand: band,
  openingCap: cap, openingMistakeBand: band, hardCap: 0, hardMistakeBand: 700,
});

const CONFIGS = [
  tier('CAP80', 80, 0.00, 200),      // reference: stable strength at this cap
  tier('B50',   80, 0.50, 50),       // 业余 candidate, tight band
  tier('B200',  80, 0.50, 200),      // 业余 candidate as currently decided
  tier('BINF',  80, 0.50, BAND_INF), // 业余 candidate, band with no upper bound
  tier('G50',   25, 0.10, 50),       // 高手 candidate, tight band
  tier('G200',  25, 0.10, 200),      // 高手 candidate as currently decided
  tier('GINF',  25, 0.10, BAND_INF), // 高手 candidate, band with no upper bound
  { id: 'ANCH', multipv: 1, movetime: 0, hash: 256, rule: 'anchor' },
];

function uciOf(m) {
  const L = 'abcdefghi';
  return L[m.f % 9] + (9 - Math.floor(m.f / 9)) + L[m.t % 9] + (9 - Math.floor(m.t / 9));
}

const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'level_positions.json'), 'utf8'));
const positions = [];
for (const p of src) {
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
  round: 4,
  seedSalt: 97000 + 4 * 977,
  refMs: 2000, refHash: 256,
  pre: ['setoption name Threads value 4', 'setoption name Hash value 64', 'setoption name MultiPV value 1'],
  configs: CONFIGS,
  positions: positions,
};

fs.writeFileSync(path.join(ROOT, 'task_tier_r4.json'), JSON.stringify(task, null, 1));
console.log('wrote task_tier_r4.json positions=' + positions.length, 'configs=' + CONFIGS.length);
console.log('searches =', positions.length * (1 + 2 * CONFIGS.length));
