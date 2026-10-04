/* gen_chase4.js — 判例（长将）实测局面构造 + 用本项目 engine.js 校验「循环是被迫的」
 *
 * P_CHK   长将: 红车 a5<->b5 交替将军黑将 b9<->a9（黑方应将只有王走，实测见日志）。
 *         黑方多一车(i1) => 物质上黑优。若引擎内建「长将判负」，红方分数应是 mate 级负分。
 * P_REP   对照(循环但不将军): 黑将放在 i9，红车 a5<->b5 仍形成重复但从不将军。
 *         用于区分「重复判和」与「判例」。
 * P_CHK_ADV 长将但将军方物质占优: 红多一车。若「长将判负」被内建，红方分数应被压到和棋(0cp)。
 *
 * 坐标: board[row*9+col], row0=黑底线(rank9), row9=红底线(rank0); UCI = letter(col)+digit(9-row)
 * 输出: bench/new_engine/chase4_positions.json
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
function boardToFen(board, side) {
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
const L = (i) => String.fromCharCode(97 + (i % 9));
const N = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + N(f) + L(t) + N(t);
const sq = (row, col) => row * 9 + col;
const NAME = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };

function skeleton() {
  const b = new Array(90).fill(0);
  b[sq(2, 0)] = -7;  // 黑卒 a7 —— 挡住 a 线，使 a8 不被红车控制（黑将唯一逃生格）
  b[sq(4, 0)] = 5;   // 红车 a5
  b[sq(8, 8)] = -5;  // 黑车 i1 —— 黑方物质领先；被将军时永远轮不到它应将
  b[sq(9, 3)] = 2;   // 红仕 d0
  b[sq(9, 4)] = 1;   // 红帅 e0
  b[sq(9, 5)] = 2;   // 红仕 f0
  return b;
}
function pChk() { const b = skeleton(); b[sq(0, 1)] = -1; return b; }            // 黑将 b9 -> 红车可长将
function pRep() { const b = skeleton(); b[sq(0, 8)] = -1; return b; }           // 黑将 i9 -> 红车永不将军
function pChkAdv() { const b = pChk(); b[sq(8, 3)] = 5; return b; }            // 再加红车 d1 -> 红方物质占优

const CYC_KING = [
  [sq(4, 0), sq(4, 1)], // 红车 a5->b5
  [sq(0, 1), sq(0, 0)], // 黑将 b9->a9
  [sq(4, 1), sq(4, 0)], // 红车 b5->a5
  [sq(0, 0), sq(0, 1)], // 黑将 a9->b9
];
const CYC_KING_I = [
  [sq(4, 0), sq(4, 1)],
  [sq(0, 8), sq(0, 7)], // 黑将 i9->h9
  [sq(4, 1), sq(4, 0)],
  [sq(0, 7), sq(0, 8)],
];

function probe(board, side, cycle, plies) {
  const g = XQ.Game.fromBoard(board.slice());
  g.side = side;
  const log = [], fens = [];
  for (let p = 0; p < plies; p++) {
    const legal = g.legalMoves();
    const want = cycle[p % cycle.length];
    const mv = legal.find(m => m.f === want[0] && m.t === want[1]);
    log.push({
      ply: p, side: g.side, inCheck: g.inCheck(),
      play: uci(want[0], want[1]), legalMove: !!mv,
      legalCount: legal.length,
      legal: legal.map(m => uci(m.f, m.t) + ':' + NAME[Math.abs(g.board[m.f])]),
      fen: boardToFen(g.board, g.side),
    });
    fens.push(boardToFen(g.board, g.side));
    if (!mv) break;
    g.move(mv);
  }
  return { log, fens };
}

const out = {};
for (const [id, board, cycle] of [['P_CHK', pChk(), CYC_KING], ['P_REP', pRep(), CYC_KING_I], ['P_CHK_ADV', pChkAdv(), CYC_KING]]) {
  const r = probe(board, 1, cycle, 9);
  out[id] = {
    fen: boardToFen(board, 1),
    cycle: cycle.map(m => uci(m[0], m[1])),
    fenPly1: r.fens[1], fenPly3: r.fens[3], fenPly5: r.fens[5], fenPly7: r.fens[7],
    log: r.log,
  };
  console.log('=====', id, 'FEN:', out[id].fen, '=====');
  console.log('cycle:', out[id].cycle.join(' '));
  for (const e of r.log) console.log('ply', e.ply, 'side', e.side, 'inCheck', e.inCheck, e.play, e.legalMove ? 'OK' : 'ILLEGAL', 'legal(' + e.legalCount + '):', e.legal.join(' '));
}
fs.writeFileSync(path.join(__dirname, 'chase4_positions.json'), JSON.stringify(out, null, 1));
console.log('\nwritten -> chase4_positions.json');
