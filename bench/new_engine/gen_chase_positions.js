/* gen_chase_positions.js — 构造"红方长将"局面（皮卡鱼判例实测用），并用本项目 engine.js 校验
 * 走子合法性 + 打印每一手的合法着法全集，用来确认循环是否"被迫"。
 * 坐标: board[row*9+col], row0=黑底线(rank9), row9=红底线(rank0); UCI = letter(col)+digit(9-row)
 * 输出: bench/new_engine/chase_positions.json
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
const show = (row, col) => L(sq(row, col)) + N(sq(row, col));

// ---- CHK: 红炮 a7<->b7 长将（炮隔子将军），黑将 a9<->b9 被迫来回 ----
// 炮的其它落点全部被堵: a8/b8 是黑卒(炮架), a6 是黑车, b6/c7 是红卒
function buildCHK() {
  const b = new Array(90).fill(0);
  b[sq(0, 0)] = -1; // 黑将 a9
  b[sq(1, 0)] = -7; // 黑卒 a8  (炮架)
  b[sq(1, 1)] = -7; // 黑卒 b8  (炮架)
  b[sq(2, 0)] = 6;  // 红炮 a7
  b[sq(3, 0)] = -5; // 黑车 a6  (堵住炮向下 + 黑方的物质优势)
  b[sq(3, 1)] = 7;  // 红卒 b6  (堵 b6)
  b[sq(2, 2)] = 7;  // 红卒 c7  (堵 c7)
  b[sq(9, 4)] = 1;  // 红帅 e0
  b[sq(9, 3)] = 2;  // 红仕 d0
  b[sq(9, 5)] = 2;  // 红仕 f0
  b[sq(8, 4)] = 7;  // 红兵 e1 (封住帅)
  return b;
}
// ---- CTRL: 同盘面但去掉两个炮架 -> 炮永远不将军（对照：纯重复应判 0）----
function buildCTRL() {
  const b = buildCHK();
  b[sq(1, 0)] = 0;
  b[sq(1, 1)] = 0;
  return b;
}

function probe(board, side, cycleMoves, plies) {
  const g = XQ.Game.fromBoard(board.slice());
  g.side = side;
  const log = [];
  for (let p = 0; p < plies; p++) {
    const legal = g.legalMoves();
    const want = cycleMoves[p % cycleMoves.length];
    const mv = legal.find(m => m.f === want[0] && m.t === want[1]);
    log.push({
      ply: p, side: g.side, inCheck: g.inCheck(),
      chosen: uci(want[0], want[1]), ok: !!mv,
      legalCount: legal.length,
      legal: legal.map(m => uci(m.f, m.t) + ':' + (Math.abs(g.board[m.f]) === 1 ? 'K' : Math.abs(g.board[m.f]) === 6 ? 'C' : Math.abs(g.board[m.f]) === 5 ? 'R' : Math.abs(g.board[m.f]) === 7 ? 'P' : 'O')),
      fen: boardToFen(g.board, g.side),
    });
    if (!mv) break;
    g.move(mv);
  }
  return { g, log };
}

const out = {};
const cyc = [
  [sq(2, 0), sq(2, 1)], // 炮 a7 -> b7 (将军黑将 b9)
  [sq(0, 0), sq(0, 1)], // 将 a9 -> b9
  [sq(2, 1), sq(2, 0)], // 炮 b7 -> a7 (将军黑将 a9)
  [sq(0, 1), sq(0, 0)], // 将 b9 -> a9
];
for (const [id, board] of [['CHK', buildCHK()], ['CTRL', buildCTRL()]]) {
  const { g, log } = probe(board, 1, cyc, 8);
  out[id] = { fen: boardToFen(board, 1), moves: cyc.map(m => uci(m[0], m[1])), log, fenEnd: boardToFen(g.board, g.side) };
  console.log('=====', id, 'FEN:', boardToFen(board, 1), '=====');
  console.log('cycle moves:', out[id].moves.join(' '));
  for (const r of log) console.log('ply', r.ply, 'side', r.side, 'inCheck', r.inCheck, 'chosen', r.chosen, r.ok ? 'OK' : 'ILLEGAL', 'legal(' + r.legalCount + '):', r.legal.join(' '));
}
fs.writeFileSync(path.join(__dirname, 'chase_positions.json'), JSON.stringify(out, null, 1));
console.log('\nwritten -> chase_positions.json');
