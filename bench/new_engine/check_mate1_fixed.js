/* check_mate1_fixed.js — 修正版：之前的 check_mate1.js 里我把 FEN 字母映射成
 * 'KABNRPC'（漏了 C），导致 P(兵) 被解析成 C(炮)。正确映射是 'KABNRPC' → K1 A2 B3 N4 R5 C6 P7。
 * 本文件重新核对新引擎报的 mate 1 是否成立。
 */
const XQ = require('../../engine.js');
const L = i => String.fromCharCode(97 + (i % 9)), NR = i => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
const CODE = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 };
function pf(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => {
    let i = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { i += +ch; continue; }
      const up = ch === ch.toUpperCase();
      const v = CODE[ch.toUpperCase()];
      if (!v) throw new Error('bad fen char ' + ch);
      b[r * 9 + i] = up ? v : -v; i++;
    }
  });
  return b;
}
function report(fen, side, claimPv) {
  const b = pf(fen); const g = XQ.Game.fromBoard(b); g.side = side;
  const lm = g.legalMoves();
  console.log('=== FEN', fen, 'side', side, 'legal:', lm.length, 'piece dump:', b.map(v => v).join(','));
  const mates = [];
  for (const m of lm) {
    const nb = g.board.slice(); nb[m.t] = nb[m.f]; nb[m.f] = 0;
    const g2 = XQ.Game.fromBoard(nb); g2.side = -side;
    const l2 = g2.legalMoves();
    if (l2.length === 0) mates.push(uci(m.f, m.t) + '(' + (g2.inCheck() ? '将死' : '困毙') + ')');
  }
  console.log('  mate-in-1 per engine.js:', mates.join(' ') || 'NONE');
  if (claimPv) {
    const mv = lm.find(m => uci(m.f, m.t) === claimPv);
    console.log('  claimed', claimPv, 'legal?', !!mv);
    if (mv) {
      const nb = g.board.slice(); nb[mv.t] = nb[mv.f]; nb[mv.f] = 0;
      const g2 = XQ.Game.fromBoard(nb); g2.side = -side;
      console.log('    after: opponent inCheck=', g2.inCheck(), 'legal=', g2.legalMoves().length, g2.legalMoves().map(m => uci(m.f, m.t) + ':' + XQ.pieceName(g2.board[m.f])).join(' '));
    }
  }
}
report('4k4/3P5/9/9/5R3/9/9/9/9/3K5', 1, 'f5f8');
report('4k4/3P5/9/9/5R3/9/9/9/9/3K5', 1, 'f5f0');
report('2N1k4/9/9/9/9/9/9/3K5/9/9', 1, 'd2d1 e9f9 c9d7');
report('5k3/9/9/9/2b6/4R4/9/9/9/3K5', 1, null);   // 修正版长捉探针起点
