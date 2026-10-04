/* gen_rule15.js — rule60 阈值的受控扫描（单一局面族、无兵无炮、只改半回合数）
 * 修正：boardToFen 的字母表必须是 'KABNRCP'/'kabnrcp'（C=6, P=7）。之前 gen_rule10/gen_rule14
 * 写成 'KABNRPC'，把 value 7 写成 'C'，FEN 里的"兵"实际是炮 —— 那批 130/149/150 结果口径不清，作废。
 *
 * 根局面：黑将 e9 + 黑象 c9（合法象位，提供无限黑方闲着）+ 红车 a4 + 红帅 d0。
 * 生成器用项目 engine.js 产出一条 **无吃子、无将军、不自将被将、任何局面出现次数 ≤ 2** 的
 * 150 半回合quiet 串；各档（118/119/120/121/125/130/140/149/150）取同一条串的**前缀**，
 * 于是各档只差"已经走了多少半回合"这一个变量，rule60 计数器 = 半回合数（全程无兵无吃子）。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
const sq = (r, c) => r * 9 + c;
const L = i => String.fromCharCode(97 + (i % 9)), NR = i => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function boardToFen(b, side, hm) {
  let o = '';
  for (let r = 0; r < 10; r++) {
    let e = 0;
    for (let c = 0; c < 9; c++) { const v = b[r * 9 + c]; if (!v) { e++; continue; } if (e) { o += e; e = 0; } o += v > 0 ? MAP[v] : MAP[-v].toLowerCase(); }
    if (e) o += e; if (r < 9) o += '/';
  }
  const rows = o.split('/');
  if (rows.length !== 10 || rows.some(r => [...r].reduce((n, ch) => n + (/\d/.test(ch) ? +ch : 1), 0) !== 9)) throw new Error('bad fen width: ' + o);
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + hm + ' 1';
}
function startBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 4)] = -1;  // 黑将 e9（九宫内）
  b[sq(0, 2)] = -3;  // 黑象 c9（合法象位，提供无限黑方闲着）
  b[sq(5, 0)] = 5;   // 红车 a4（第 4 横线，与黑将不同线）
  b[sq(9, 5)] = 1;   // 红帅 f0（九宫内；与黑将 e9 不同线 → 不飞将）
  return b;
}
/* engine.js 不校验初始王位/象位，这里自己补上（新引擎会校验：WHITE king(s) on invalid positions.） */
function assertPlacement(b) {
  const inPalace = (i, side) => { const r = (i / 9) | 0, c = i % 9; return c >= 3 && c <= 5 && (side === 1 ? r >= 7 : r <= 2); };
  for (let i = 0; i < 90; i++) {
    if (b[i] === 1 && !inPalace(i, 1)) throw new Error('red king outside palace at ' + L(i) + NR(i));
    if (b[i] === -1 && !inPalace(i, -1)) throw new Error('black king outside palace at ' + L(i) + NR(i));
    if (Math.abs(b[i]) === 3 && !ELEPHANT_SQ.has(i)) throw new Error('elephant on illegal square ' + L(i) + NR(i));
    if (b[i] === 7 && ((b[i] / 9) | 0) === 9) throw new Error('bad red pawn rank');
  }
}
const ELEPHANT_SQ = new Set([[0, 2], [0, 6], [2, 0], [2, 4], [2, 8], [4, 2], [4, 6]].map(([r, c]) => r * 9 + c));
function build(plies) {
  const b = startBoard();
  assertPlacement(b);
  const g = XQ.Game.fromBoard(b); g.side = 1;
  const seen = new Map();
  const bump = (board, side) => { const k = board.join(',') + '|' + side; seen.set(k, (seen.get(k) || 0) + 1); };
  bump(g.board, g.side);
  const moves = [];
  for (let p = 0; p < plies; p++) {
    let best = null, bestKey = null;
    for (const m of g.legalMoves()) {
      if (g.board[m.t] !== 0) continue;                    // 不吃子
      const nb = g.board.slice(); nb[m.t] = nb[m.f]; nb[m.f] = 0;
      if (XQ.inCheck(nb, -g.side)) continue;               // 不将军
      if (XQ.inCheck(nb, g.side)) continue;                // 不自将被将（含飞将）
      let placementOk = true;
      for (let i = 0; i < 90; i++) if (Math.abs(nb[i]) === 3 && !ELEPHANT_SQ.has(i)) { placementOk = false; break; }
      if (!placementOk) continue;
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
  return { moves, maxRep: Math.max(...seen.values()), plies: moves.length, rootFenAtEnd: boardToFen(g.board, g.side, moves.length), sideToMove: g.side, legalAtRoot: g.legalMoves().length, inCheckAtRoot: g.inCheck() };
}
const FULL = build(150);
if (FULL.fail) { console.log('sequence build failed:', FULL.fail); process.exit(1); }
console.log('full sequence: plies', FULL.plies, 'maxOccurrence', FULL.maxRep, 'end', FULL.rootFenAtEnd, 'side', FULL.sideToMove, 'legal', FULL.legalAtRoot);
const targets = [118, 119, 120, 121, 125, 130, 140, 149, 150];
const meta = { startFen: boardToFen(startBoard(), 1, 0), fullSequence: FULL.moves, maxOccurrence: FULL.maxRep,档位: {} };
const steps = [];
for (const n of targets) {
  const prefix = FULL.moves.slice(0, n);
  const g = XQ.Game.fromBoard(startBoard()); g.side = 1;
  for (const mv of prefix) { const m = g.legalMoves().find(x => uci(x.f, x.t) === mv); if (!m) { console.log('prefix broken at', n, mv); process.exit(1); } g.move(m); }
  meta['档位'][n] = { rootFen: boardToFen(g.board, g.side, n), sideToMove: g.side, legalAtRoot: g.legalMoves().length, inCheck: g.inCheck(), staticEval: XQ.evaluate(g.board) };
  steps.push({ id: 'R60S_' + n, cmds: ['position fen ' + meta.startFen + ' moves ' + prefix.join(' '), 'go depth 12'], timeoutMs: 15000, gapMs: 500 });
  console.log('档', n, meta['档位'][n].rootFen, 'side', g.side, 'legal', g.legalMoves().length, 'staticEval', XQ.evaluate(g.board));
}
fs.writeFileSync(path.join(__dirname, 'rule15_meta.json'), JSON.stringify(meta, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule12.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('steps:', steps.map(s => s.id).join(' '));
