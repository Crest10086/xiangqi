/* gen_rule11.js — 修正版长捉探针（上一轮 CHZ1 被新引擎拒绝的真正原因：黑象放在 e5，
 * 而黑象只能位于 7 个合法象位，e5 不在其中；项目自身 engine.js 不校验这一点，所以自检通过。）
 * 本生成器把黑象放在合法象位（c5 = row4,col2），红车沿第 4 横线交替捉 c5 / a7 的无根象。
 * 全部 FEN 与长着法串由本生成器产出，并用项目 engine.js 逐 ply 断言：
 *   · 每步合法；红方落子后黑象确实被攻击（捉成立）且黑象无根（吃它得子 → 符合"捉"定义）；
 *   · 全程不将军、不吃子；4 步循环闭合。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const sq = (r, c) => r * 9 + c;
const L = i => String.fromCharCode(97 + (i % 9)), NR = i => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function boardToFen(b, side, hm) {
  let o = '';
  for (let r = 0; r < 10; r++) { let e = 0; for (let c = 0; c < 9; c++) { const v = b[r * 9 + c]; if (!v) { e++; continue; } if (e) { o += e; e = 0; } o += v > 0 ? 'KABNRPC'[v - 1] : 'kabnrpc'[-v - 1]; } if (e) o += e; if (r < 9) o += '/'; }
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + (hm || 0) + ' 1';
}
const MAPPER = { c9: [0, 2], g9: [0, 6], a7: [2, 0], e7: [2, 4], i7: [2, 8], c5: [4, 2], g5: [4, 6] };
const LEGAL_BLACK_ELEPHANT = new Set(Object.values(MAPPER).map(([r, c]) => r * 9 + c));

function chaseBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 5)] = -1;  // 黑将 f9（与红帅不同线，不会被将死）
  b[sq(4, 2)] = -3;  // 黑象 c5（合法象位，无根）
  b[sq(5, 4)] = 5;   // 红车 e4
  b[sq(9, 3)] = 1;   // 红帅 d0
  return b;
}
/* e4->c4 捉 c5 的象；象 c5->e7 逃；c4->e4 捉 e7 的象；象 e7->c5 逃 → 回到起点 */
const CYCLE = ['e4c4', 'c5e7', 'c4e4', 'e7c5'];

function verify() {
  const b = chaseBoard();
  for (const p of LEGAL_BLACK_ELEPHANT) if (b[p] === -3) { /* ok */ }
  const elephantSquares = [];
  for (let i = 0; i < 90; i++) if (b[i] === -3) elephantSquares.push(i);
  const legalPlacement = elephantSquares.every(i => LEGAL_BLACK_ELEPHANT.has(i));
  const startKey = b.join(',');
  const g = XQ.Game.fromBoard(b); g.side = 1;
  const log = [];
  let ok = legalPlacement;
  if (!ok) log.push({ fail: 'elephant on illegal square' });
  for (let p = 0; p < 18; p++) {
    const want = CYCLE[p % CYCLE.length];
    const legal = g.legalMoves();
    const mv = legal.find(m => uci(m.f, m.t) === want);
    if (!mv) { ok = false; log.push({ ply: p, fail: 'illegal ' + want, legalCount: legal.length }); break; }
    if (g.inCheck()) { ok = false; log.push({ ply: p, fail: 'side to move is in check' }); break; }
    g.move(mv);
    if (g.inCheck()) { ok = false; log.push({ ply: p, fail: 'move gave check (not a pure chase)' }); break; }
    if (g.side === 1) {   // 刚走完红方着法：检查捉是否成立
      let at = -1; for (let i = 0; i < 90; i++) if (g.board[i] === -3) at = i;
      if (at < 0) { ok = false; log.push({ ply: p, fail: 'chased elephant gone' }); break; }
      if (!LEGAL_BLACK_ELEPHANT.has(at)) { ok = false; log.push({ ply: p, fail: 'elephant left legal squares: ' + uci(at, at) }); break; }
      const attacked = XQ.isAttacked(g.board, at, 1);
      const guarded = XQ.isAttacked(g.board, at, -1);
      log.push({ ply: p, play: want, elephantAt: uci(at, at), attacked, unguarded: !guarded });
      if (!attacked) { ok = false; log.push({ ply: p, fail: 'chase not established' }); break; }
      if (guarded) { ok = false; log.push({ ply: p, fail: 'chased piece is guarded (not a strict 捉)' }); break; }
    }
    if (g.legalMoves().length === 0) { ok = false; log.push({ ply: p, fail: 'side to move has no legal move' }); break; }
  }
  const closed = g.board.join(',') === startKey && g.side === 1;
  return { ok: ok && closed, startFen: boardToFen(b, 1), log };
}
const r = verify();
console.log('CHZ-FIX', r.startFen, 'selfCheckOk=', r.ok);
for (const e of r.log) console.log('  ', JSON.stringify(e));
if (!r.ok) { console.log('probe rejected, no task written'); process.exit(1); }
const rep = n => Array(n).fill(CYCLE.join(' ')).join(' ');
const steps = [
  { id: 'CHZF_R0', cmds: ['position fen ' + r.startFen, 'go depth 15'], timeoutMs: 20000, gapMs: 300 },
  { id: 'CHZF_R2', cmds: ['position fen ' + r.startFen + ' moves ' + rep(2), 'go depth 15'], timeoutMs: 20000, gapMs: 300 },
  { id: 'CHZF_R3', cmds: ['position fen ' + r.startFen + ' moves ' + rep(3), 'go depth 15'], timeoutMs: 20000, gapMs: 300 },
];
fs.writeFileSync(path.join(__dirname, 'rule11_positions.json'), JSON.stringify({ fen: r.startFen, cycle: CYCLE, log: r.log }, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule9.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('steps:', steps.map(s => s.id).join(' '));
