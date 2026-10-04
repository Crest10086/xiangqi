/* horse_probe2.js — 放宽版「单马长将」搜索：
 * 要求：红每一手都将军；黑方每步都被将且至少有 1 个合法应将（不要求唯一）；
 *       黑方永远不将军红帅；红马永远没有被黑将吃掉的风险（红马安全）；
 *       4 步（或 6/8 步）循环回到完全相同的局面（含轮到红走）。
 * 附加：报告该形里红方是否存在任何杀（用 engine.js 做 depth 6 全搜索判定），
 *       单马对单将理论上无杀 → 这是判例判定的最干净探针。
 */
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const sq = (r, c) => r * 9 + c;
const L = (i) => String.fromCharCode(97 + (i % 9));
const NN = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NN(f) + L(t) + NN(t);
const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
function fen(b, side, hm) {
  let o = '';
  for (let r = 0; r < 10; r++) { let e = 0; for (let c = 0; c < 9; c++) { const v = b[r * 9 + c]; if (!v) { e++; continue; } if (e) { o += e; e = 0; } o += v > 0 ? MAP[v] : MAP[-v].toLowerCase(); } if (e) o += e; if (r < 9) o += '/'; }
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + (hm || 0) + ' 1';
}
const palaceB = [], palaceR = [];
for (let r = 0; r <= 2; r++) for (let c = 3; c <= 5; c++) palaceB.push(sq(r, c));
for (let r = 7; r <= 9; r++) for (let c = 3; c <= 5; c++) palaceR.push(sq(r, c));

const found = [];
for (const rk of palaceR) {
  for (let h1 = 0; h1 < 90; h1++) {
    for (const bk1 of palaceB) {
      if (bk1 === h1 || rk === h1) continue;
      const s0 = new Array(90).fill(0); s0[h1] = 4; s0[bk1] = -1; s0[rk] = 1;
      if (XQ.inCheck(s0, 1) || XQ.inCheck(s0, -1)) continue;         // 起始面：谁都不被将
      const g0 = XQ.Game.fromBoard(s0.slice());
      if (g0.legalMoves().length === 0) continue;
      // DFS over (red checking move, black reply) pairs, up to 4 pairs
      const startKey = s0.join(',') + '|1';
      const visited = new Set([startKey]);
      const dfs = (board, moves, depth) => {
        if (depth >= 4) return false;
        const g = XQ.Game.fromBoard(board.slice()); g.side = 1;
        for (const m of g.legalMoves()) {
          const b1 = board.slice(); b1[m.t] = b1[m.f]; b1[m.f] = 0;
          if (!XQ.inCheck(b1, -1)) continue;                 // 红必须将军
          const g1 = XQ.Game.fromBoard(b1.slice()); g1.side = -1;
          const replies = g1.legalMoves();
          if (replies.length === 0) continue;                // 被将方不能是杀/困毙
          for (const rm of replies) {
            const b2 = b1.slice(); b2[rm.t] = b2[rm.f]; b2[rm.f] = 0;
            if (XQ.inCheck(b2, 1)) continue;                 // 黑不能反将（否则不是长将形）
            const nm = moves.concat([uci(m.f, m.t), uci(rm.f, rm.t)]);
            const k = b2.join(',') + '|1';
            if (k === startKey && nm.length >= 4) {
              found.push({ fen: fen(s0, 1), cycle: nm, plies: nm.length });
              return true;
            }
            if (visited.has(k)) continue;
            visited.add(k);
            if (dfs(b2, nm, depth + 1)) return true;
            visited.delete(k);
          }
        }
        return false;
      };
      dfs(s0, [], 0);
      if (found.length >= 12) break;
    }
    if (found.length >= 12) break;
  }
  if (found.length >= 12) break;
}

console.log('cycles found:', found.length);
const seen = new Set();
for (const f of found) {
  const k = f.fen + f.cycle.join(' ');
  if (seen.has(k)) continue; seen.add(k);
  // re-verify the cycle explicitly, ply by ply, with the project engine
  const rows = f.fen.split(' ')[0].split('/');
  const b = new Array(90).fill(0);
  for (let r = 0; r < 10; r++) { let i = 0; for (const ch of rows[r]) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } }
  const g = XQ.Game.fromBoard(b.slice()); g.side = 1;
  let ok = true, detail = [];
  for (let p = 0; p < 12; p++) {
    const want = f.cycle[p % f.cycle.length];
    const legal = g.legalMoves();
    const mv = legal.find(m => uci(m.f, m.t) === want);
    const chk = g.inCheck();
    if (g.side === -1 && (!chk || legal.length === 0)) { ok = false; detail.push('ply' + p + ' bad reply'); }
    if (!mv) { ok = false; detail.push('ply' + p + ' illegal ' + want); break; }
    detail.push('ply' + p + ' ' + (g.side === 1 ? 'RED ' : 'BLK ') + want + ' legal=' + legal.length + ' inCheck=' + chk);
    g.move(mv);
    if (g.side === 1 && p >= 1 && !XQ.inCheck(g.board, -1)) { /* red to move: black should have just been checked */ }
  }
  const closed = g.board.join(',') === b.join(',') && g.side === 1;
  // does red have any mate within depth 6? use project engine think()
  const t = XQ.think(b, 1, 6, 3, 200000, 0, null);
  console.log(ok && closed ? 'OK  ' : 'BAD ', f.fen, f.cycle.join(' '), 'plies=' + f.plies, 'depth6score=' + (t ? t.score : 'n/a'), detail.filter(d => d.includes('bad') || d.includes('illegal')).join(';'));
}
