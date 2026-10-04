/* horse_probe3.js — 找「长将而无杀」形：红方每手将军、黑方每步被将且有合法应将、
 * 但红方在 engine.js 的 depth 8 全搜索里没有任何杀（真正的例和长将形）。
 * 输出候选 FEN + 4步被迫循环。
 */
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const L = (i) => String.fromCharCode(97 + (i % 9));
const NR = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
function fen(b, side) {
  let o = '';
  for (let r = 0; r < 10; r++) { let e = 0; for (let c = 0; c < 9; c++) { const v = b[r * 9 + c]; if (!v) { e++; continue; } if (e) { o += e; e = 0; } o += v > 0 ? MAP[v] : MAP[-v].toLowerCase(); } if (e) o += e; if (r < 9) o += '/'; }
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - 0 1';
}
function parseFen(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } });
  return b;
}
const palaceB = [], palaceR = [];
for (let r = 0; r <= 2; r++) for (let c = 3; c <= 5; c++) palaceB.push(sq(r, c));
for (let r = 7; r <= 9; r++) for (let c = 3; c <= 5; c++) palaceR.push(sq(r, c));
function sq(r, c) { return r * 9 + c; }

/* 1) 枚举所有 4 步「红每步将军 / 黑每步被将且有应将」的循环（单马 vs 单将） */
const cycles = [];
for (const rk of palaceR) for (let h = 0; h < 90; h++) for (const bk of palaceB) {
  if (bk === h || rk === h) continue;
  const s0 = new Array(90).fill(0); s0[h] = 4; s0[bk] = -1; s0[rk] = 1;
  if (XQ.inCheck(s0, 1) || XQ.inCheck(s0, -1)) continue;
  if (XQ.Game.fromBoard(s0.slice()).legalMoves().length === 0) continue;
  const startKey = s0.join(',') + '|1';
  const visited = new Set([startKey]);
  const dfs = (board, moves, depth) => {
    if (depth >= 3) return false;
    const g = XQ.Game.fromBoard(board.slice()); g.side = 1;
    for (const m of g.legalMoves()) {
      const b1 = board.slice(); b1[m.t] = b1[m.f]; b1[m.f] = 0;
      if (!XQ.inCheck(b1, -1)) continue;
      const g1 = XQ.Game.fromBoard(b1.slice()); g1.side = -1;
      const replies = g1.legalMoves();
      if (replies.length === 0) continue;
      for (const rm of replies) {
        const b2 = b1.slice(); b2[rm.t] = b2[rm.f]; b2[rm.f] = 0;
        if (XQ.inCheck(b2, 1)) continue;
        const nm = moves.concat([uci(m.f, m.t), uci(rm.f, rm.t)]);
        if (b2.join(',') === s0.join(',') && nm.length === 4) { cycles.push({ fen: fen(s0, 1), cycle: nm, replies: replies.length }); return true; }
        if (visited.has(b2.join(',') + '|1')) continue;
        visited.add(b2.join(',') + '|1');
        if (dfs(b2, nm, depth + 1)) return true;
        visited.delete(b2.join(',') + '|1');
      }
    }
    return false;
  };
  dfs(s0, [], 0);
}
console.log('cycles found:', cycles.length);

/* 2) 用 engine.js 自己 depth8 搜索：红是否有任何杀？只保留无杀的形 */
const seen = new Set();
const keep = [];
for (const c of cycles) {
  if (seen.has(c.fen)) continue; seen.add(c.fen);
  const b = parseFen(c.fen);
  const t = XQ.think(b, 1, 8, 4, 400000, 0, null);
  const hasMate = t && Math.abs(t.score) > 5000;
  if (!hasMate) keep.push({ fen: c.fen, cycle: c.cycle, depth8Score: t ? t.score : null });
}
console.log('no-mate (drawish) perpetual-check forms:', keep.length);
for (const k of keep.slice(0, 12)) console.log('  ', k.fen, k.cycle.join(' '), 'depth8score=', k.depth8Score);
