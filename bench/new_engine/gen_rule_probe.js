/* gen_rule_probe.js — 判例实测局面：构造 + 用本项目 engine.js 校验合法性
 * CHK: 红车 a5<->b5 交替将军黑将 b9<->a9（红方每手都是将军）；红方多一车一相一兵（正常评估红优）。
 * REP: 同样的 8 手循环但不将军（对照：纯重复）。
 * R60: rule60 计数器 = 119 的局面（走一手即满 120 半回合）+ rule60=0 对照。
 * 输出: bench/new_engine/rule_probe_positions.json + 打印校验日志
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
function boardToFen(board, side, rule60) {
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
  return out + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + (rule60 === undefined ? 0 : rule60) + ' 1';
}
const L = (i) => String.fromCharCode(97 + (i % 9));
const N = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + N(f) + L(t) + N(t);
const sq = (row, col) => row * 9 + col;
const NAME = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
const parse = (s) => { const c = s.charCodeAt(0) - 97, r = 9 - (+s[1]); return sq(r, c); };

// ---- 局面 A/B 共用盘面: 黑只有将(b9 或 d9); 红 帅e0 + 车a5 + 相a1 + 兵b2 ----
function boardFor(blackKingSq) {
  const b = new Array(90).fill(0);
  b[blackKingSq] = -1;
  b[sq(4, 0)] = 5;  // 红车 a5
  b[sq(8, 0)] = 3;  // 红相 a1 (被 b2 别眼, 无合法着法)
  b[sq(7, 1)] = 7;  // 红兵 b2
  b[sq(9, 4)] = 1;  // 红帅 e0
  return b;
}
const CHK_START = boardFor(sq(0, 1));   // 黑将 b9
const REP_START = boardFor(sq(0, 3));   // 黑将 d9 (对照: 循环不将军)
const CHK_CYCLE = ['a5b5', 'b9a9', 'b5a5', 'a9b9'];
const REP_CYCLE = ['a5c5', 'd9e9', 'c5a5', 'e9d9'];

function probe(board, side, cycle, plies) {
  const g = XQ.Game.fromBoard(board.slice());
  g.side = side;
  const log = [], fens = [];
  for (let p = 0; p < plies; p++) {
    const legal = g.legalMoves();
    const want = cycle[p % cycle.length];
    const mv = legal.find(m => uci(m.f, m.t) === want);
    log.push({
      ply: p, side: g.side, inCheck: g.inCheck(), play: want, legalMove: !!mv,
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
for (const [id, board, cycle] of [['CHK', CHK_START, CHK_CYCLE], ['REP', REP_START, REP_CYCLE]]) {
  const r = probe(board, 1, cycle, 9);
  out[id] = {
    fen: boardToFen(board, 1), cycle,
    fenPly4: r.fens[4], fenPly8: r.fens[8],
    allLegal: r.log.every(e => e.legalMove),
    redCheckingAt: r.log.filter(e => e.side === 1).map(e => ({ ply: e.ply, givesCheckNext: null })),
    log: r.log,
  };
  console.log('=====', id, 'FEN:', out[id].fen, 'allLegal=', out[id].allLegal, '=====');
  for (const e of r.log) console.log('ply', e.ply, 'side', e.side, 'inCheckBefore', e.inCheck, e.play, e.legalMove ? 'OK' : 'ILLEGAL', 'legal(' + e.legalCount + '):', e.legal.join(' '));
  console.log('fen@ply4:', out[id].fenPly4);
  console.log('fen@ply8:', out[id].fenPly8);
}
// rule60 探针盘面
const r60board = new Array(90).fill(0);
r60board[sq(0, 4)] = -1;  // 黑将 e9
r60board[sq(4, 0)] = 5;   // 红车 a5 (远离黑将, 1 步内不可能将死)
r60board[sq(9, 4)] = 1;   // 红帅 e0
out.R60 = { fen119: boardToFen(r60board, 1, 119), fen0: boardToFen(r60board, 1, 0) };
console.log('R60 fen119:', out.R60.fen119);
console.log('R60 fen0  :', out.R60.fen0);
fs.writeFileSync(path.join(__dirname, 'rule_probe_positions.json'), JSON.stringify(out, null, 1));
console.log('\nwritten -> rule_probe_positions.json');
