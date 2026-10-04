/* check_mate1.js — 用项目自身 engine.js 核对新引擎报的 mate 1 是否成立 */
const XQ = require('../../engine.js');
const L = i => String.fromCharCode(97 + (i % 9)), NR = i => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function pf(f) { const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0); rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } }); return b; }
function report(fen, claimPv) {
  const b = pf(fen); const g = XQ.Game.fromBoard(b); g.side = 1;
  console.log('=== FEN', fen, 'red legal moves:', g.legalMoves().length);
  const mates = [];
  for (const m of g.legalMoves()) {
    const nb = g.board.slice(); nb[m.t] = nb[m.f]; nb[m.f] = 0;
    const g2 = XQ.Game.fromBoard(nb); g2.side = -1;
    const lm = g2.legalMoves();
    if (lm.length === 0) mates.push({ mv: uci(m.f, m.t), inCheck: g2.inCheck() ? '将死' : '困毙' });
  }
  console.log('  mate-in-1 (将死/困毙) per engine.js:', mates.map(m => m.mv + '(' + m.inCheck + ')').join(' ') || 'NONE');
  if (claimPv) {
    const mv = g.legalMoves().find(m => uci(m.f, m.t) === claimPv);
    console.log('  claimed pv', claimPv, 'legal?', !!mv);
    if (mv) { const nb = g.board.slice(); nb[mv.t] = mv.f ? nb[mv.f] : nb[mv.f]; nb[mv.t] = nb[mv.f]; nb[mv.f] = 0; const g2 = XQ.Game.fromBoard(nb); g2.side = -1; console.log('    after: black inCheck=', g2.inCheck(), 'legal=', g2.legalMoves().length, g2.legalMoves().map(m => uci(m.f, m.t) + ':' + XQ.pieceName(g2.board[m.f])).join(' ')); }
  }
}
report('4k4/3P5/9/9/5R3/9/9/9/9/3K5', 'f5f8');
report('4k4/3R5/9/9/9/9/9/9/9/3K5', 'd8f8');
report('5k3/3R5/9/9/9/9/9/9/9/3K5', null);   // black to move (NOREP_119 root)
report('4k4/5R3/9/9/9/9/9/9/9/3K5', null);   // NOREP_121 root, black to move
