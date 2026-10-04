/* horse_probe.js — 直接枚举「单马长将」4 步被迫循环
 * 语义（红为长将方）：
 *   S0: 马在 A，黑将在 X，红走，黑不被将（A 不攻击 X）
 *   红 A->B  => 黑被将（B 攻击 X）
 *   黑唯一合法应将 X->Y
 *   红 B->A  => 黑被将（A 攻击 Y）      [A 必须攻击 Y 且不攻击 X]
 *   黑唯一合法应将 Y->X  => 回到 S0
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

// horse move legality (no leg block needed when board is empty except king/rook? must check)
function horseTargets(b, h) {
  const r = (h / 9) | 0, c = h % 9, out = [];
  for (const [dr, dc] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
    const lr = Math.abs(dr) === 2 ? r + (dr > 0 ? 1 : -1) : r;
    const lc = Math.abs(dc) === 2 ? c + (dc > 0 ? 1 : -1) : c;
    if (b[lr * 9 + lc] !== 0) continue;
    const t = b[nr * 9 + nc];
    if (t === 0 || t < 0) out.push(nr * 9 + nc);
  }
  return out;
}

const results = [];
for (const X of palaceB) {
  for (const Y of palaceB) {
    if (X === Y) continue;
    // X->Y must be a legal king step (adjacency or flying-general, checked later by engine.js)
    for (const A of Array.from({ length: 90 }, (_, i) => i)) {
      if (A === X || A === Y) continue;
      for (const B of horseTargets(new Array(90).fill(0).map((v, i) => i === A ? 4 : 0), A)) {
        if (B === X || B === Y || B === A) continue;
        // A must attack Y, not attack X ; B must attack X, not attack Y
        const bA = new Array(90).fill(0); bA[A] = 4; bA[Y] = -1;
        if (!XQ.isAttacked(bA, Y, 1)) continue;
        const bA2 = new Array(90).fill(0); bA2[A] = 4; bA2[X] = -1;
        if (XQ.isAttacked(bA2, X, 1)) continue;
        const bB = new Array(90).fill(0); bB[B] = 4; bB[X] = -1;
        if (!XQ.isAttacked(bB, X, 1)) continue;
        const bB2 = new Array(90).fill(0); bB2[B] = 4; bB2[Y] = -1;
        if (XQ.isAttacked(bB2, Y, 1)) continue;
        // A->B must be a legal horse move on the real board (leg not blocked)
        const board0 = new Array(90).fill(0); board0[A] = 4; board0[X] = -1;
        if (!horseTargets(board0, A).includes(B)) continue;
        const board1 = board0.slice(); board1[B] = 4; board1[A] = 0;
        if (!horseTargets(board1, B).includes(A)) continue;
        for (const RK of palaceR) {
          if (RK === A || RK === B || RK === X || RK === Y) continue;
          // build S0 and verify with the project engine
          const s0 = new Array(90).fill(0); s0[A] = 4; s0[X] = -1; s0[RK] = 1;
          if (XQ.inCheck(s0, 1) || XQ.inCheck(s0, -1)) continue;
          const g = XQ.Game.fromBoard(s0.slice()); g.side = 1;
          const redMoves = g.legalMoves().filter(m => m.f === A && m.t === B);
          if (!redMoves.length) continue;
          const nb1 = s0.slice(); nb1[B] = 4; nb1[A] = 0;
          if (!XQ.inCheck(nb1, -1)) continue;
          const g1 = XQ.Game.fromBoard(nb1.slice()); g1.side = -1;
          const r1 = g1.legalMoves();
          if (r1.length !== 1 || uci(r1[0].f, r1[0].t) !== uci(X, Y)) continue;
          const nb2 = nb1.slice(); nb2[Y] = -1; nb2[X] = 0;
          if (XQ.inCheck(nb2, 1)) continue;
          const g2 = XQ.Game.fromBoard(nb2.slice()); g2.side = 1;
          const red2 = g2.legalMoves().filter(m => m.f === B && m.t === A);
          if (!red2.length) continue;
          const nb3 = nb2.slice(); nb3[A] = 4; nb3[B] = 0;
          if (!XQ.inCheck(nb3, -1)) continue;
          const g3 = XQ.Game.fromBoard(nb3.slice()); g3.side = -1;
          const r2 = g3.legalMoves();
          if (r2.length !== 1 || uci(r2[0].f, r2[0].t) !== uci(Y, X)) continue;
          results.push({ fen: fen(s0, 1), cycle: [uci(A, B), uci(X, Y), uci(B, A), uci(Y, X)], A, B, X, Y, RK });
        }
      }
    }
  }
}
console.log('raw cycles found:', results.length);
const seen = new Set();
const uniq = results.filter(r => { const k = r.fen + r.cycle.join(' '); if (seen.has(k)) return false; seen.add(k); return true; });
console.log('unique:', uniq.length);
for (const r of uniq.slice(0, 20)) console.log(r.fen, r.cycle.join(' '));
