/* replay_rule7.js — 用项目自身 engine.js 回放 task_rule7.json 的长着法串，
 * 逐步检查：是否吃子、是否将军、终局子力/合法着法数，并把各档根局面的 FEN 打出来
 * （供后续用 FEN 直接喂引擎做 halfmove 阈值实验）。
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
const task = JSON.parse(fs.readFileSync(path.join(__dirname, 'task_rule7.json'), 'utf8'));
const out = {};
for (const step of task.steps) {
  const cmd = step.cmds[0];
  const fen = cmd.replace(/^position fen /, '').split(' moves ')[0];
  const moves = cmd.includes(' moves ') ? cmd.split(' moves ')[1].trim().split(/\s+/) : [];
  const g = XQ.Game.fromBoard(parseFen(fen)); g.side = 1;
  let caps = 0, checks = 0, bad = null;
  for (let i = 0; i < moves.length; i++) {
    const mv = g.legalMoves().find(m => uci(m.f, m.t) === moves[i]);
    if (!mv) { bad = 'ply' + i + ' illegal ' + moves[i]; break; }
    if (g.board[mv.t] !== 0) caps++;
    const wasCheck = g.inCheck();
    g.move(mv);
    if (g.inCheck()) checks++;
    void wasCheck;
  }
  const mat = XQ.evaluate(g.board);
  const legal = g.legalMoves();
  out[step.id] = {
    plies: moves.length, captures: caps, positionsInCheckAfterMove: checks, illegal: bad,
    rootFenAtEnd: boardToFen(g.board, g.side, moves.length),
    sideToMove: g.side, inCheck: g.inCheck(), legalMovesAtRoot: legal.length,
    staticEvalRedPositive: mat,
  };
  console.log('===', step.id, JSON.stringify(out[step.id], null, 1));
}
fs.writeFileSync(path.join(__dirname, 'rule7_replay.json'), JSON.stringify(out, null, 1));
