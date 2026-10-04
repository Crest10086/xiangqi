/* gen_rule14.js — 让 rule60 计数器自然累计到 130/149/150 半回合（上一版在 ply 121 因困毙中断）
 * 构造：红车 + 红帅 vs 黑单将 + 两个已过河、只能横向走的黑卒（a0 / c0）——黑方永远有合法闲着，
 * 双方都能无限走quiet 着法，计数器可以越过 120。
 * 生成器用项目 engine.js 逐 ply 断言：不将军、不吃子、不自将被将、任何局面出现次数 ≤ 2。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const L = i => String.fromCharCode(97 + (i % 9)), NR = i => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function boardToFen(b, side, hm) {
  let o = '';
  for (let r = 0; r < 10; r++) { let e = 0; for (let c = 0; c < 9; c++) { const v = b[r * 9 + c]; if (!v) { e++; continue; } if (e) { o += e; e = 0; } o += v > 0 ? 'KABNRPC'[v - 1] : 'kabnrpc'[-v - 1]; } if (e) o += e; if (r < 9) o += '/'; }
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + hm + ' 1';
}
const sq = (r, c) => r * 9 + c;
function startBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 4)] = -1;   // 黑将 e9
  b[sq(5, 0)] = 5;    // 红车 a4（第 4 横线，远离 e 线）
  b[sq(9, 3)] = 1;    // 红帅 d0
  b[sq(9, 0)] = -7;   // 黑卒 a0（只能横向走）
  b[sq(9, 2)] = -7;   // 黑卒 c0（只能横向走）
  return b;
}
function build(plies) {
  const b = startBoard();
  const g = XQ.Game.fromBoard(b); g.side = 1;
  const seen = new Map();
  const bump = (board, side) => { const k = board.join(',') + '|' + side; seen.set(k, (seen.get(k) || 0) + 1); };
  bump(g.board, g.side);
  const moves = [];
  for (let p = 0; p < plies; p++) {
    let best = null, bestKey = null;
    for (const m of g.legalMoves()) {
      const nb = g.board.slice();
      if (nb[m.t] !== 0) continue;                       // 不吃子（吃子会重置 rule60 计数）
      nb[m.t] = nb[m.f]; nb[m.f] = 0;
      if (XQ.inCheck(nb, -g.side)) continue;             // 不将军
      if (XQ.inCheck(nb, g.side)) continue;              // 不自将被将
      const k = nb.join(',') + '|' + (-g.side);
      const cnt = seen.get(k) || 0;
      const key = [-cnt, Math.abs(m.t % 9 - m.f % 9) + Math.abs(((m.t / 9) | 0) - ((m.f / 9) | 0))];
      if (!best || key > bestKey) { best = m; bestKey = key; }
    }
    if (!best) return { fail: 'no quiet move at ply ' + p };
    moves.push(uci(best.f, best.t));
    g.move(best);
    bump(g.board, g.side);
  }
  return { moves, maxRep: Math.max(...seen.values()), plies: moves.length, rootFenAtEnd: boardToFen(g.board, g.side, moves.length), sideToMove: g.side, legalAtRoot: g.legalMoves().length };
}
const targets = [130, 149, 150];
const steps = []; const meta = {};
for (const n of targets) {
  const r = build(n);
  if (r.fail) { console.log('SKIP', n, r.fail); continue; }
  meta['seq' + n] = { plies: r.plies, maxOccurrence: r.maxRep, rootFenAtEnd: r.rootFenAtEnd, sideToMove: r.sideToMove, legalAtRoot: r.legalAtRoot };
  console.log('seq', n, 'plies', r.plies, 'maxOccurrence', r.maxRep, 'rootAtEnd', r.rootFenAtEnd, 'side', r.sideToMove, 'legal', r.legalAtRoot);
  steps.push({ id: 'NOREP_' + n, cmds: ['position fen ' + boardToFen(startBoard(), 1, 0) + ' moves ' + r.moves.join(' '), 'go depth 12'], timeoutMs: 15000, gapMs: 500 });
}
fs.writeFileSync(path.join(__dirname, 'rule14_meta.json'), JSON.stringify(meta, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule11.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('steps:', steps.map(s => s.id).join(' '));
