/* new_engine/alt_gen_task.js — TEST-ONLY task generator for cards t_9f14af96 / t_3fff5a44
 * (t_9f14af96: 候选 gap 阈值 / 池内加权随机 / 叠加降质 三方案实测;
 *  t_3fff5a44: A+C 叠加 AC_AD(cap=60,p=0.10) / AC_AM(cap=200,p=0.25) + cap/p 定标插值点).
 *
 * Usage: node alt_gen_task.js <round> [smoke|calib|bn]
 *   main  -> task_ac_r<round>.json        (the experiment + its paired controls)
 *   calib -> task_calib_r<round>.json     (cap/p grid for the conversion table)
 *   bn / b-prefix -> task_bn_r<round>.json (card t_f844043c: bounded noise + its controls)
 *   the legacy names task_alt_* stay on disk unchanged so the previous card stays reproducible.
 *
 * Positions are the SAME 17 as the baseline card t_ef6e93b8 (level_positions.json) so results are
 * directly comparable with bench/NEW_ENGINE_LEVELS_BASELINE.md.
 * Additionally every position carries its full legal-move list (generated offline through the
 * project's own engine.js) — the driver samples from it for the "叠加降质 / move noise" scheme.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const XQ = require(path.join(ROOT, '..', '..', 'engine.js'));

const roundArg = (process.argv[2] || '1');
const round = Number.isFinite(+(roundArg.replace(/^[cb]/, ''))) ? +roundArg.replace(/^[cb]/, '') : 1;
const MODE = process.argv[3] === 'calib' || /^c/.test(roundArg) ? 'calib'
           : process.argv[3] === 'bn' || /^b/.test(roundArg) ? 'bn' : 'main';
const smoke = process.argv[3] === 'smoke';

function uciOf(m) {
  const fc = m.f % 9, fr = Math.floor(m.f / 9), tc = m.t % 9, tr = Math.floor(m.t / 9);
  const L = 'abcdefghi';
  return L[fc] + (9 - fr) + L[tc] + (9 - tr);
}

// board[] -> FEN (same convention as gen_level_positions.js / pikafish_bridge.js)
function boardToFen(board, side) {
  const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
  let out = '';
  for (let r = 0; r < 10; r++) {
    let empty = 0;
    for (let c = 0; c < 9; c++) {
      const v = board[r * 9 + c];
      if (v === 0) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      out += v > 0 ? MAP[v] : MAP[-v].toLowerCase();
    }
    if (empty) out += empty;
    if (r < 9) out += '/';
  }
  return out + ' ' + (side === 1 ? 'w' : 'b') + ' - - 0 1';
}

/* ---- config matrix -------------------------------------------------------------
 * Fixed search budget on purpose: movetime/hash are NOT strength knobs (proven by the
 * baseline's S1T300 control). Only the candidate POOL WIDTH and the SELECTION RULE vary.
 * AM0/AD0/EX0 reproduce the baseline configs so the new schemes are compared in-run.
 *
 * card t_3fff5a44 (this file's MODE=main set): the two A+C compositions AC_AD / AC_AM are the
 * experiment; CAP_* / NOI_* are re-run in the same round so every comparison is a PAIRED one
 * (same position, same round). TMP_* from the previous card are dropped — B was judged not
 * viable and is not needed for the acceptance criteria; the round stays at 11 configs / ~20 min.
 * MODE=calib swaps in the cap/p interpolation grid used for the conversion table.
 * ----------------------------------------------------------------------------- */
const BASE_CONTROLS = [
  // baseline controls (identical to NEW_ENGINE_LEVELS_BASELINE.md 1.2)
  { id: 'AM0',    multipv: 4, movetime: 150, hash: 64,  rule: 'slot', slot: 4 },          // 业余 baseline (9cp above AD0)
  { id: 'AD0',    multipv: 3, movetime: 300, hash: 64,  rule: 'slot', slot: 3 },          // 进阶 baseline
  { id: 'EX0',    multipv: 2, movetime: 500, hash: 128, rule: 'slot', slot: 2 },          // 高手 baseline (ladder anchor)
  // scheme A alone (gap cap) — control for "what the cap does without noise"
  { id: 'CAP_AD', multipv: 8, movetime: 150, hash: 64,  rule: 'cap', cap: 60  },
  { id: 'CAP_AM', multipv: 8, movetime: 150, hash: 64,  rule: 'cap', cap: 200 },
  // scheme C alone (move noise) — control for "what p does without a cap"
  { id: 'NOI_AD', multipv: 4, movetime: 150, hash: 64,  rule: 'noise', p: 0.10, base: 1 },
  { id: 'NOI_AM', multipv: 4, movetime: 150, hash: 64,  rule: 'noise', p: 0.25, base: 4 },
];

const MAIN_CONFIGS = [
  ...BASE_CONTROLS,
  // scheme A+C — 叠加: cap picks the acceptable candidate, then prob p overrides it with a random legal move
  { id: 'AC_AD',  multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 60,  p: 0.10 },
  { id: 'AC_AM',  multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 200, p: 0.25 },
  // control: wide pool (MultiPV 8) but take slot 1 — isolates the cost of widening the pool
  { id: 'T8S1',   multipv: 8, movetime: 150, hash: 64,  rule: 'slot', slot: 1 },
  // control: play the ANCHOR search's own bestmove — measures the metric's noise floor (loss should be ~0)
  { id: 'ANCH',   multipv: 1, movetime: 0,   hash: 256, rule: 'anchor' },
];

/* calibration round: cap/p grid at fixed pool+budget, to build the "want X cp -> use cap/p" table */
const CALIB_CONFIGS = [
  { id: 'AM0',    multipv: 4, movetime: 150, hash: 64,  rule: 'slot', slot: 4 },
  { id: 'CAP_AD', multipv: 8, movetime: 150, hash: 64,  rule: 'cap', cap: 60  },
  { id: 'CAP_AM', multipv: 8, movetime: 150, hash: 64,  rule: 'cap', cap: 200 },
  { id: 'NOI_AM', multipv: 4, movetime: 150, hash: 64,  rule: 'noise', p: 0.25, base: 4 },
  { id: 'AC_AD',  multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 60,  p: 0.10 },
  { id: 'AC_P15', multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 200, p: 0.15 },
  { id: 'AC_P20', multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 200, p: 0.20 },
  { id: 'AC_AM',  multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 200, p: 0.25 },
  { id: 'AC_X1',  multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 60,  p: 0.25 },  // cross cell: small cap + big p
  { id: 'ANCH',   multipv: 1, movetime: 0,   hash: 256, rule: 'anchor' },
];

/* card t_f844043c (bounded noise): the SAME 11 controls the previous card used, minus NOI_AD
 * (not needed for this card's acceptance), plus the three bounded-noise variants:
 *   BN_AD / BN_AM  — gapmode='hybrid': pool verdict for pool candidates, a shallow wide PROBE
 *                    search judges every other legal move (the definition the card suggests).
 *                    The probe runs ONLY on draws where the random branch fires
 *                    (AltRules.willRandom uses the same first draw as pick()), and its cost is
 *                    logged as pnodes/pdepth -> the "extra search cost" is measurable per move.
 *   BN_P2          — gapmode='pool': the main candidate pool is the judge, ZERO extra search.
 *                    Same cap/p as BN_AM, so the two judge implementations are directly comparable.
 * Probe: MultiPV 16 / movetime 150 / Hash 64 — same time budget as the CAP_* main search but a
 * wider PV, so its per-move gaps are comparable to the pool gaps. */
const JUDGE = { probePV: 16, probeMs: 150, probeHash: 64 };
const BN_CONFIGS = [
  { id: 'AM0',    multipv: 4, movetime: 150, hash: 64,  rule: 'slot', slot: 4 },
  { id: 'AD0',    multipv: 3, movetime: 300, hash: 64,  rule: 'slot', slot: 3 },
  { id: 'EX0',    multipv: 2, movetime: 500, hash: 128, rule: 'slot', slot: 2 },
  { id: 'CAP_AD', multipv: 8, movetime: 150, hash: 64,  rule: 'cap', cap: 60  },
  { id: 'CAP_AM', multipv: 8, movetime: 150, hash: 64,  rule: 'cap', cap: 200 },
  { id: 'NOI_AM', multipv: 4, movetime: 150, hash: 64,  rule: 'noise', p: 0.25, base: 4 },
  { id: 'AC_AD',  multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 60,  p: 0.10 },
  { id: 'AC_AM',  multipv: 8, movetime: 150, hash: 64,  rule: 'capnoise', cap: 200, p: 0.25 },
  { id: 'BN_AD',  multipv: 8, movetime: 150, hash: 64,  rule: 'boundednoise', cap: 60,  p: 0.25, gapmode: 'hybrid', ...JUDGE },
  { id: 'BN_AM',  multipv: 8, movetime: 150, hash: 64,  rule: 'boundednoise', cap: 200, p: 0.40, gapmode: 'hybrid', ...JUDGE },
  { id: 'BN_P2',  multipv: 8, movetime: 150, hash: 64,  rule: 'boundednoise', cap: 200, p: 0.40, gapmode: 'pool' },
  { id: 'ANCH',   multipv: 1, movetime: 0,   hash: 256, rule: 'anchor' },
];

const configs = MODE === 'calib' ? CALIB_CONFIGS : MODE === 'bn' ? BN_CONFIGS : MAIN_CONFIGS;

const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'level_positions.json'), 'utf8'));
const positions = [];
for (const p of src) {
  if (smoke && p.id !== 'OP00' && p.id !== 'MG_QT01' && p.id !== 'MG_QB3') continue;
  // rebuild the board from the stored FEN and re-derive legal moves with the project engine
  const board = new Array(90).fill(0);
  const MAP = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 };
  const rows = p.fen.split(' ')[0].split('/');
  if (rows.length !== 10) { console.log('BAD FEN rows', p.id); continue; }
  let ok = true;
  rows.forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/[0-9]/.test(ch)) { c += +ch; continue; }
      const up = ch === ch.toUpperCase();
      const v = MAP[ch.toUpperCase()];
      if (!v) { ok = false; return; }
      board[r * 9 + c] = up ? v : -v;
      c++;
    }
    if (c !== 9) { ok = false; }
  });
  if (!ok) { console.log('BAD FEN parse', p.id); continue; }
  const side = p.side;
  const legal = XQ.legalMoves(board, side).map(uciOf);
  if (legal.length !== p.nLegal) console.log('legal count differs', p.id, legal.length, p.nLegal);
  if (boardToFen(board, side) !== p.fen) console.log('FEN round-trip differs', p.id);
  positions.push({ id: p.id, group: p.group, fen: p.fen, side: side, legal: legal });
}

const task = {
  round: round,
  // different PRNG stream per round -> independent draws for randomized rules.
  // calib rounds use their own base so their draws are independent of the main rounds'.
  // main/calib keep the previous card's base; the bounded-noise rounds use their own base 96000
  // so this card's random draws are an INDEPENDENT sample, not a replay of t_3fff5a44's draws.
  seedSalt: (MODE === 'calib' ? 95000 : MODE === 'bn' ? 96000 : 90000) + round * 977,
  refMs: 2000,
  refHash: 256,
  pre: ['setoption name Threads value 4', 'setoption name Hash value 64', 'setoption name MultiPV value 1'],
  configs: configs,
  positions: positions,
};

const tag = MODE === 'calib' ? 'task_calib' : MODE === 'bn' ? 'task_bn' : 'task_ac';
const name = smoke ? tag + '_smoke.json' : tag + '_r' + round + '.json';
fs.writeFileSync(path.join(ROOT, name), JSON.stringify(task, null, 1));
console.log('wrote', name, 'positions=' + positions.length, 'configs=' + configs.length);
console.log('searches per round =', positions.length * (1 + 2 * configs.length));
for (const p of positions) console.log(p.id, p.group, 'legal=' + p.legal.length);
