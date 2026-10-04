/* gen_rule16.js — 精确锁定 rule60 判和线与"杀的距离"的关系（纯 FEN，无着法历史 → 无重复干扰）
 * 根局面取自 gen_rule15 的 120 半回合末态：3k5/9/b6R1/9/9/9/9/9/9/5K3 w
 *   —— engine.js 已确认该形红方有杀（新引擎在 120 半回合档报 mate 5）。
 * 只改 FEN 的 halfmove 字段：0 / 100 / 110 / 114 / 115 / 116 / 117 / 118 / 119。
 * 若引擎的规则是"杀必须在 120 半回合内完成"，则 mate 分数会在
 *   halfmove + 2*5 > 120 的那一档塌成 cp 0。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const FEN_BOARD = '3k5/9/b6R1/9/9/9/9/9/9/5K3';
function parseFen(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) { i += +ch; continue; } const up = ch === ch.toUpperCase(); const v = 'KABNRCP'.indexOf(ch.toUpperCase()) + 1; if (!v) throw new Error('bad char ' + ch); b[r * 9 + i] = up ? v : -v; i++; } });
  return b;
}
const b = parseFen(FEN_BOARD);
const g = XQ.Game.fromBoard(b); g.side = 1;
const t = XQ.think(b, 1, 12, 4, 300000, 0, null);
console.log('engine.js self-check: red legal', g.legalMoves().length, 'inCheck', g.inCheck(), 'engine.js think d12 score', t ? t.score : 'n/a', 'pv', t && t.pv ? t.pv.join(' ') : '');
const steps = [];
for (const hm of [0, 100, 110, 114, 115, 116, 117, 118, 119]) {
  steps.push({ id: 'MT5_' + hm, cmds: ['position fen ' + FEN_BOARD + ' w - - ' + hm + ' 1', 'go depth 14'], timeoutMs: 12000, gapMs: 300 });
}
fs.writeFileSync(path.join(__dirname, 'task_rule13.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('steps:', steps.map(s => s.id).join(' '));
