/* verify_pv.js — 用项目自身 engine.js 校验新引擎报告的 PV/杀 是否成立
 * 用法: node verify_pv.js  (内置本卡用到的几条 PV)
 */
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const L = (i) => String.fromCharCode(97 + (i % 9));
const NR = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function parseFen(fen) {
  const rows = fen.split(' ')[0].split('/');
  const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } });
  return { board: b, side: fen.split(' ')[1] === 'w' ? 1 : -1 };
}
function check(name, fen, pv, claim) {
  const { board, side } = parseFen(fen);
  const g = XQ.Game.fromBoard(board.slice()); g.side = side;
  const moves = pv.trim().split(/\s+/);
  console.log('===', name, '===');
  console.log('  start side', side, 'legalMoves(start)=', g.legalMoves().length, 'inCheck(start)=', g.inCheck());
  for (let i = 0; i < moves.length; i++) {
    const want = moves[i];
    const legal = g.legalMoves();
    const mv = legal.find(m => uci(m.f, m.t) === want);
    if (!mv) {
      console.log('  ply', i, want, 'ILLEGAL per engine.js. legal=(' + legal.length + '):', legal.map(m => uci(m.f, m.t)).join(' '));
      return { ok: false, why: 'illegal pv move ' + want };
    }
    g.move(mv);
    const after = g.legalMoves();
    console.log('  ply', i, want, 'ok side=' + g.side, 'inCheck=' + g.inCheck(), 'legalAfter=' + after.length);
    if (after.length === 0) {
      const res = g.inCheck() ? 'MATE' : 'STALEMATE(困毙)';
      console.log('  -> engine.js says:', res, '(claim was', claim + ')');
      return { ok: true, res, atPly: i };
    }
  }
  console.log('  -> no terminal position after pv; engine.js legal=' + g.legalMoves().length, '(claim was', claim + ')');
  return { ok: false, why: 'pv does not terminate' };
}

check('CHK mate1', '4k4/3P5/9/9/5R3/9/9/9/9/3K5 w - - 0 1', 'f5f8', 'mate 1');
check('HORSE mate2', '2N1k4/9/9/9/9/9/9/3K5/9/9 w - - 0 1', 'd2d1 e9f9 c9d7', 'mate 2');
check('HORSE mate2 (alt cand)', '3N1k3/9/9/9/9/9/9/3K5/9/9 w - - 0 1', 'd9e7 f9f8 e7d9', 'mate?');
check('HORSE mate2 (alt cand2)', '4k1N2/9/9/9/9/9/9/3K5/9/9 w - - 0 1', 'g9f7 e9e8 f7g9', 'mate?');
