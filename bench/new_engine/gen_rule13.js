/* gen_rule13.js — rule60 计数器上限的精确扫描：同一个 halfmove 值在不同局面上有的被拒、有的被接受
 * （rule5 日志里 4k4/3P5/9/9/5R3/9/9/9/9/3K5 halfmove=120 被拒；rule9 日志里
 *  4k4/3R5/9/9/9/9/9/9/9/3K5 halfmove=120 被接受）。本探针把「局面」和「halfmove」两个变量
 * 分开扫描，找出每个局面的确切拒绝阈值。用 go depth 2（极短）只做解析验证。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
function parseFen(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } });
  return b;
}
const CASES = [
  ['C_rook_f5_pawn_d8', '4k4/3P5/9/9/5R3/9/9/9/9/3K5'],
  ['D_only_kings', '4k4/9/9/9/9/9/9/9/9/3K5'],
  ['E_rook_a5_extra_pawn', '4k4/9/9/9/R8/9/9/P8/9/3K5'],
];
const steps = [];
const meta = {};
for (const [tag, fen] of CASES) {
  const b = parseFen(fen);
  const g = XQ.Game.fromBoard(b); g.side = 1;
  meta[tag] = { fen, redLegal: g.legalMoves().length, redInCheck: g.inCheck(), staticEval: XQ.evaluate(b) };
  for (const hm of [110, 115, 118, 119, 120, 121, 122, 125, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 239, 240, 241, 250, 300, 400, 500, 900, 999]) {
    steps.push({ id: 'SW_' + tag + '_' + hm, cmds: ['position fen ' + fen + ' w - - ' + hm + ' 1', 'go depth 2'], timeoutMs: 5000, gapMs: 120 });
  }
}
fs.writeFileSync(path.join(__dirname, 'rule13_meta.json'), JSON.stringify(meta, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule10.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('cases:', CASES.map(c => c[0]).join(' '));
console.log('steps:', steps.length);
for (const k in meta) console.log(k, JSON.stringify(meta[k]));
