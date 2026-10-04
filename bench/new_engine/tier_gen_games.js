/* new_engine/tier_gen_games.js — TEST-ONLY 五档互弈 task generator (card t_a8096ea3).
 * Usage: node tier_gen_games.js <round> [smoke]      -> task_games_r<round>.json
 *
 * Also copies C:/Users/35165/xiangqi/engine.js to new_engine/xq_engine.js (the served root is
 * new_engine/, so the harness cannot reference ../engine.js) and logs the sha256 so the report can
 * prove the harness used the repo's own rules + built-in engine, not a stale copy.
 *
 * Tier cfgs come from tier_tiers.json (written by tier_decide.js from the calibration), i.e. from
 * measured numbers, never invented here. The middle tiers all share ONE search budget
 * (movetime/MultiPV/Hash identical): the contract forbids building the ladder out of thinking time.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = __dirname;

const roundArg = (process.argv[2] || '1');
const round = Number.isFinite(+(roundArg.replace(/^t/, ''))) ? +roundArg.replace(/^t/, '') : 1;
const smoke = process.argv[3] === 'smoke';

const TIERS_PATH = path.join(ROOT, 'tier_tiers.json');
if (!fs.existsSync(TIERS_PATH)) { console.error('missing ' + TIERS_PATH + ' — run tier_decide.js first'); process.exit(2); }
const tiers = JSON.parse(fs.readFileSync(TIERS_PATH, 'utf8'));

/* copy the project engine and prove the copy is the repo file */
const SRC_ENGINE = path.join(ROOT, '..', '..', 'engine.js');
const DST_ENGINE = path.join(ROOT, 'xq_engine.js');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
fs.copyFileSync(SRC_ENGINE, DST_ENGINE);
const engineSha = sha(SRC_ENGINE);
if (sha(DST_ENGINE) !== engineSha) throw new Error('engine copy mismatch');

const XQ = require(SRC_ENGINE);
const PIECE_FEN = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
function boardToFen(board, side) {
  let out = '';
  for (let r = 0; r < 10; r++) {
    let empty = 0;
    for (let c = 0; c < 9; c++) {
      const v = board[r * 9 + c];
      if (v === 0) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      out += v > 0 ? PIECE_FEN[v] : PIECE_FEN[-v].toLowerCase();
    }
    if (empty) out += empty;
    if (r < 9) out += '/';
  }
  return out + ' ' + (side === 1 ? 'w' : 'b') + ' - - 0 1';
}
function fenToBoard(fen) {
  const MAP = { K: 1, A: 2, B: 3, C: 6, N: 4, R: 5, P: 7 };
  const board = new Array(90).fill(0);
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/[0-9]/.test(ch)) { c += +ch; continue; }
      const v = MAP[ch.toUpperCase()];
      board[r * 9 + c] = (ch === ch.toUpperCase()) ? v : -v;
      c++;
    }
  });
  return board;
}
const uciOf = (m) => { const L = 'abcdefghi'; return L[m.f % 9] + (9 - Math.floor(m.f / 9)) + L[m.t % 9] + (9 - Math.floor(m.t / 9)); };

/* positions: the initial position (openings) + midgame fixtures whose pools have real intermediate
 * gradients (the calibration logged those gap lists; positions where every alternative is a blunder
 * are useless for a game ladder, so the two 'hard' fixtures are excluded). */
const positions = [];
{
  const b = XQ.initialBoard();
  positions.push({ id: 'INIT', group: 'opening', fen: boardToFen(b, 1) });
}
const MID = ['MG_QT05', 'MG_QT10', 'MG_QT14', 'MG_QB3'];
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'level_positions.json'), 'utf8'));
for (const p of src) {
  if (!MID.includes(p.id)) continue;
  positions.push({ id: p.id, group: p.group, fen: p.fen });
}
for (const p of positions) {
  const board = fenToBoard(p.fen);
  const side = p.fen.split(' ')[1] === 'w' ? 1 : -1;
  const n = XQ.legalMoves(board, side).length;
  if (!n) throw new Error('fixture ' + p.id + ' has no legal moves');
  p.side = side;
  p.legalCount = n;
  p.legal = XQ.legalMoves(board, side).map(uciOf);
}

const TIER = (name) => { const t = tiers[name]; if (!t) throw new Error('tier_tiers.json has no ' + name); return t; };
const PAIRS = [
  ['业余', '入门'], ['进阶', '业余'], ['高手', '进阶'], ['大师', '高手'],   // adjacent
  ['高手', '业余'], ['大师', '进阶'], ['业余', '入门'], ['进阶', '入门'],   // cross / transitivity
];
const GAMES_PER_PAIR = smoke ? 1 : 2;

const games = [];
for (let pi = 0; pi < PAIRS.length; pi++) {
  for (let g = 0; g < GAMES_PER_PAIR; g++) {
    const pos = positions[(pi + g) % positions.length];
    games.push({
      id: 'M' + pi + '-' + pos.id + '-C' + g + '-R' + round,
      hi: TIER(PAIRS[pi][0]), lo: TIER(PAIRS[pi][1]), pairName: PAIRS[pi][0] + '_vs_' + PAIRS[pi][1],
      posId: pos.id, fen: pos.fen, group: pos.group, legal: pos.legal, fenSide: pos.side,
      hiPlaysFirst: g % 2 === 0,
      maxPlies: smoke ? 40 : 150,
      seed: 101000 + round * 1000 + pi * 20 + g,
    });
  }
}

const task = {
  round: round, seedSalt: 101000 + round * 1000, engineCopySha256_16: engineSha,
  fixedSearchBudget: tiers.fixedSearchBudget,
  games: games,
};
const name = smoke ? 'task_games_smoke.json' : 'task_games_r' + round + '.json';
fs.writeFileSync(path.join(ROOT, name), JSON.stringify(task, null, 1));
console.log('wrote', name, 'games=' + games.length, 'positions=' + positions.length,
  positions.map(p => p.id + ':' + p.legalCount).join(','));
console.log('engine copy sha256(16)=' + engineSha);
console.log('tiers=', JSON.stringify({
  入门: tiers.入门, 业余: tiers.业余.cap + '/' + tiers.业余.p, 进阶: tiers.进阶.cap + '/' + tiers.进阶.p,
  高手: tiers.高手.cap + '/' + tiers.高手.p, 大师: tiers.大师.kind + ' mpv' + tiers.大师.multipv + ' t' + tiers.大师.movetime,
}));
