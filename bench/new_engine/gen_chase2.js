/* gen_chase2.js — 构造「红方长将」与「无将纯重复」两个局面，并用本项目 engine.js 校验循环合法性。
 * 坐标: board[row*9+col], row0=黑底线(rank9), row9=红底线(rank0); UCI = letter(col)+digit(9-row)
 * P_CHK : 红炮 a7<->b7 借黑卒 a8/b8 作炮架，交替将军黑将 b9<->a9（红方每手都是将军）
 *         红方物质落后（黑有一车），亚洲规则下红长将判负；电脑规则下三次重复判和。
 * P_CTRL: 同盘面但把 b8 的炮架挪走 -> 红炮永远不将军，循环仍成立（纯重复对照）。
 * 输出: bench/new_engine/chase2_positions.json
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
      if (empty && v !== 0) { out += empty; empty = 0; }
      if (v === 0) { empty++; continue; }
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

function base() {
  const b = new Array(90).fill(0);
  b[sq(0, 1)] = -1;  // 黑将 b9
  b[sq(1, 0)] = -7;  // 黑卒 a8 (炮架)
  b[sq(1, 1)] = -7;  // 黑卒 b8 (炮架)
  b[sq(2, 0)] = 6;   // 红炮 a7
  b[sq(3, 0)] = -5;  // 黑车 a6 (红方物质落后)
  b[sq(3, 1)] = 7;   // 红卒 b6
  b[sq(2, 2)] = 7;   // 红卒 c7
  b[sq(9, 4)] = 1;   // 红帅 e0
  b[sq(9, 3)] = 2;   // 红仕 d0
  b[sq(9, 5)] = 2;   // 红仕 f0
  b[sq(8, 4)] = 7;   // 红兵 e1
  return b;
}
function noScreen() { const b = base(); b[sq(1, 1)] = 0; b[sq(1, 8)] = -7; return b; } // 炮架 b8 -> i8

const CYCLE = [
  [sq(2, 0), sq(2, 1)], // 红炮 a7->b7 : 借 b8 卒将军 b9 将
  [sq(0, 1), sq(0, 0)], // 黑将 b9->a9
  [sq(2, 1), sq(2, 0)], // 红炮 b7->a7 : 借 a8 卒将军 a9 将
  [sq(0, 0), sq(0, 1)], // 黑将 a9->b9
];

function probe(board, side, plies) {
  const g = XQ.Game.fromBoard(board.slice());
  g.side = side;
  const log = [];
  const fens = [];
  for (let p = 0; p < plies; p++) {
    const legal = g.legalMoves();
    const want = CYCLE[p % CYCLE.length];
    const mv = legal.find(m => m.f === want[0] && m.t === want[1]);
    log.push({
      ply: p, side: g.side, inCheck: g.inCheck(),
      chosen: uci(want[0], want[1]), ok: !!mv,
      legalCount: legal.length,
      legal: legal.map(m => uci(m.f, m.t) + ':' + (Math.abs(g.board[m.f]) === 1 ? 'K' : Math.abs(g.board[m.f]) === 6 ? 'C' : Math.abs(g.board[m.f]) === 5 ? 'R' : Math.abs(g.board[m.f]) === 7 ? 'P' : 'O')),
      fen: boardToFen(g.board, g.side),
    });
    fens.push(boardToFen(g.board, g.side));
    if (!mv) break;
    g.move(mv);
  }
  return { log, fens, endFen: boardToFen(g.board, g.side), endSide: g.side };
}

const out = {};
for (const [id, board] of [['P_CHK', base()], ['P_CTRL', noScreen()]]) {
  const r = probe(board, 1, 8);
  const startFen = boardToFen(board, 1);
  // 三次重复 = 起始局面(第1次) + 4手后(第2次) + 8手后(第3次)
  out[id] = {
    fen: startFen,
    cycle: CYCLE.map(m => uci(m[0], m[1])),
    fenAfter4: r.fens[4],
    fenAfter8: r.fens[8],
    log: r.log,
  };
  console.log('=====', id, 'FEN:', startFen, '=====');
  console.log('cycle:', out[id].cycle.join(' '));
  for (const e of r.log) console.log('ply', e.ply, 'side', e.side, 'inCheck', e.inCheck, e.chosen, e.ok ? 'OK' : 'ILLEGAL', 'legal(' + e.legalCount + '):', e.legal.join(' '));
  console.log('fenAfter4:', out[id].fenAfter4);
  console.log('fenAfter8:', out[id].fenAfter8);
}
fs.writeFileSync(path.join(__dirname, 'chase2_positions.json'), JSON.stringify(out, null, 1));
console.log('\nwritten -> chase2_positions.json');
