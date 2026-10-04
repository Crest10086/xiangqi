/* gen_rule17.js — 判别实验：K+R vs 单王（无子可吃 → rule60 计数器无法被吃子重置）
 * 同一根局面只改 halfmove：0 / 100 / 110 / 114 / 115 / 116 / 118 / 119。
 * 目的：区分两种机制
 *   (A) 引擎把"杀必须在 120 半回合内完成"作为搜索侧规则 → 当 mate 距离 > 剩余半回合数时分数变 cp 0；
 *   (B) 引擎根本不做搜索侧 rule60 处理 → 各档都保持 mate N。
 * 上一轮 R60T_B（K+R vs 单王，黑走）在 halfmove 118 报 mate -1、119 报 cp 0，指向 (A)；
 * 而带黑象的 MT5_* 各档（红可吃象 = 可重置计数器）在 119 仍报 mate 3。本实验把"能否吃子"消掉。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const FEN_BOARD = '3k5/9/9/9/9/9/8R/9/9/5K3';   // 红车 h2 + 红帅 f0 vs 黑将 d9
const CODE = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 };
function parseFen(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) { i += +ch; continue; } const up = ch === ch.toUpperCase(); const v = CODE[ch.toUpperCase()]; if (!v) throw new Error('bad char ' + ch); b[r * 9 + i] = up ? v : -v; i++; } });
  return b;
}
const b = parseFen(FEN_BOARD);
const g = XQ.Game.fromBoard(b); g.side = 1;
const t = XQ.think(b, 1, 12, 4, 300000, 0, null);
console.log('engine.js check: red legal', g.legalMoves().length, 'inCheck', g.inCheck(), 'think d12 score', t && t.score);
const steps = [];
for (const hm of [0, 100, 110, 114, 115, 116, 118, 119]) {
  steps.push({ id: 'KR_' + hm, cmds: ['position fen ' + FEN_BOARD + ' w - - ' + hm + ' 1', 'go depth 14'], timeoutMs: 12000, gapMs: 300 });
}
fs.writeFileSync(path.join(__dirname, 'task_rule14.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('steps:', steps.map(s => s.id).join(' '));
