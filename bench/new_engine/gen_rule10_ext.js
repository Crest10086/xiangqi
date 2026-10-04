/* gen_rule10.js — 分离 rule60 与「重复算和」：造一条**不重复**的长着法串（无吃子、无将军、
 * 任何局面在 history 中最多出现 2 次），让 halfmove 自然累计到 118/121/130/150。
 * 若引擎在根局面自动判 60 回合和 → 根分数会变成 0；若不会 → 保持物质优势分（红多一车 ≈ +500）。
 * 长着法串由项目自身 engine.js 生成并逐步断言合法 + 统计重复次数。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const sq = (r, c) => r * 9 + c;
const L = (i) => String.fromCharCode(97 + (i % 9));
const NR = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function boardToFen(b, side, hm) {
  let o = '';
  for (let r = 0; r < 10; r++) { let e = 0; for (let c = 0; c < 9; c++) { const v = b[r * 9 + c]; if (!v) { e++; continue; } if (e) { o += e; e = 0; } o += v > 0 ? 'KABNRPC'[v - 1] : 'kabnrpc'[-v - 1]; } if (e) o += e; if (r < 9) o += '/'; }
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + hm + ' 1';
}
function parseFen(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } });
  return b;
}
const START = '4k4/9/9/9/R8/9/9/9/9/3K5';   // 红车 + 红帅 vs 黑单将（红大优，无杀）

/* 贪心生成：每步选「不造成将军、不造成吃子、目标局面历史上出现次数最少」的合法着法 */
function buildSequence(plies) {
  const b = parseFen(START);
  const g = XQ.Game.fromBoard(b); g.side = 1;
  const seen = new Map();
  const addSeen = (board, side) => { const k = board.join(',') + '|' + side; seen.set(k, (seen.get(k) || 0) + 1); };
  addSeen(g.board, g.side);
  const moves = [];
  for (let p = 0; p < plies; p++) {
    const legal = g.legalMoves();
    if (!legal.length) return { fail: 'no legal move at ply ' + p };
    let best = null, bestKey = null;
    for (const m of legal) {
      const nb = g.board.slice(); nb[m.t] = nb[m.f]; nb[m.f] = 0;
      if (XQ.inCheck(nb, -g.side)) continue;              // 不将军
      if (XQ.inCheck(nb, g.side)) continue;               // 不自将被将
      const k = nb.join(',') + '|' + (-g.side);
      const cnt = seen.get(k) || 0;
      // 偏好：出现次数少 > 车尽量动（避免王来回走导致重复）> 目标格离原点远
      const moverIsRook = Math.abs(g.board[m.f]) === 5;
      const dist = Math.abs((m.t / 9) | 0 - (m.f / 9 | 0)) + Math.abs(m.t % 9 - m.f % 9);
      const key = [-cnt, moverIsRook ? 1 : 0, dist];
      if (!best || key > bestKey) { best = m; bestKey = key; }
    }
    if (!best) return { fail: 'no quiet move at ply ' + p };
    moves.push(uci(best.f, best.t));
    g.move(best);
    addSeen(g.board, g.side);
  }
  const maxRep = Math.max(...[...seen.values()]);
  return { moves, maxRep, plies: moves.length };
}

const targets = [130, 149, 150];
const steps = [];
const info = {};
let cache = {};   // 同一贪心序列的前缀，保证各档只差最后几步
for (const n of targets) {
  const r = cache[n] || buildSequence(n);
  cache[n] = r;
  if (r.fail) { console.log('SKIP', n, r.fail); continue; }
  info['seq' + n] = { plies: r.plies, maxOccurrenceOfAnyPosition: r.maxRep, halfmoveAtEnd: n };
  console.log('seq', n, 'plies', r.plies, 'max occurrence of any position =', r.maxRep);
  steps.push({ id: 'NOREP_' + n, cmds: ['position fen ' + START + ' w - - 0 1 moves ' + r.moves.join(' '), 'go depth 12'], timeoutMs: 12000, gapMs: 400 });
}
fs.writeFileSync(path.join(__dirname, 'rule10_info.json'), JSON.stringify(info, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule7.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('steps:', steps.map(s => s.id).join(' '));
