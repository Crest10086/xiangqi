/* gen_chase3.js — 判例实测用局面构造 + 用本项目 engine.js 校验「循环是被迫的」
 *
 * P_CHK  长将: 红车 a5<->b5 交替将军黑将 b9<->a9；黑方多一车(i1)物质领先。
 *        校验点: 黑方每次被将军时，唯一合法应将 = 王走到另一侧（a8/b8 被红车控制）。
 *        判例预期: 亚洲规则 长将判负 -> 引擎应给出 mate 级分数；纯重复判和 -> 0cp；无判例 -> 物质分。
 * P_REP  对照(纯重复无将军): 同盘面，黑将挪到 i9，红车 a5<->b5 仍形成三次重复但从不将军。
 *        预期: 无 mate 级分数（要么物质分，要么重复判和 0cp）。
 *
 * 坐标: board[row*9+col], row0=黑底线(rank9), row9=红底线(rank0); UCI = letter(col)+digit(9-row)
 * 输出: bench/new_engine/chase3_positions.json
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

function base(kingRow0Col, rookI1) {
  const b = new Array(90).fill(0);
  b[sq(0, 1)] = -1;   // 黑将 b9
  b[sq(4, 0)] = 5;    // 红车 a5
  b[sq(8, 8)] = -5;   // 黑车 i1 (黑方物质领先；被将军时永远拿不到先手)
  b[sq(9, 3)] = 2;    // 红仕 d0
  b[sq(9, 4)] = 1;    // 红帅 e0
  b[sq(9, 5)] = 2;    // 红仕 f0
  return b;
}
function control() {
  const b = base();
  b[sq(0, 1)] = 0;
  b[sq(0, 8)] = -1;   // 黑将 i9 -> 红车 a5/b5 永远不将军
  return b;
}

const CYC_CHK = [
  [sq(4, 0), sq(4, 1)], // 红车 a5->b5 (将军 b9)
  [sq(0, 1), sq(0, 0)], // 黑将 b9->a9
  [sq(4, 1), sq(4, 0)], // 红车 b5->a5 (将军 a9)
  [sq(0, 0), sq(0, 1)], // 黑将 a9->b9
];
const CYC_REP = [
  [sq(4, 0), sq(4, 1)],
  [sq(0, 8), sq(0, 7)], // 黑将 i9->h9 (不应将, 纯重复)
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
for (const [id, board, cycle] of [['P_CHK', base(), CYC_CHK], ['P_REP', control(), CYC_REP]]) {
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
fs.writeFileSync(path.join(__dirname, 'chase3_positions.json'), JSON.stringify(out, null, 1));
console.log('\nwritten -> chase3_positions.json');
