/* gen_rule9.js — 长将判定的对照组（同一局面，非将军的重复循环 + 更多重复档）
 * 复用 rule8_positions.json 里已自检通过的 PERP 局面（红单马长将 + 黑有过河卒，红绝无杀）。
 * 目的：区分「引擎对任何重复都按和扣分」与「引擎只对长将扣分/判负」。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));
const sq = (r, c) => r * 9 + c;
const L = (i) => String.fromCharCode(97 + (i % 9));
const NR = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function parseFen(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } });
  return b;
}
const pos = JSON.parse(fs.readFileSync(path.join(__dirname, 'rule8_positions.json'), 'utf8')).positions.PERP;
const FEN = pos.fen, CHK_CYCLE = pos.cycle;
console.log('PERP fen:', FEN, 'check cycle:', CHK_CYCLE.join(' '));

/* 找同一局面里「双方都不将军」的 4 步闭合循环（2 个回合对），用 engine.js 断言每步合法 */
function findIdleCycle() {
  const b = parseFen(FEN);
  const startKey = b.join(',');
  let found = null;
  const dfs = (board, moves, depth) => {
    if (found) return true;
    if (depth >= 2) return false;
    const g = XQ.Game.fromBoard(board.slice()); g.side = 1;
    for (const m of g.legalMoves()) {
      const b1 = board.slice(); b1[m.t] = b1[m.f]; b1[m.f] = 0;
      if (XQ.inCheck(b1, -1)) continue;                       // 红不将军
      const g1 = XQ.Game.fromBoard(b1.slice()); g1.side = -1;
      for (const rm of g1.legalMoves()) {
        const b2 = b1.slice(); b2[rm.t] = b2[rm.f]; b2[rm.f] = 0;
        if (XQ.inCheck(b2, 1)) continue;                      // 黑不将军
        const nm = moves.concat([uci(m.f, m.t), uci(rm.f, rm.t)]);
        if (b2.join(',') === startKey && nm.length === 4) { found = nm; return true; }
        if (dfs(b2, nm, depth + 1)) return true;
      }
    }
    return false;
  };
  dfs(b, [], 0);
  return found;
}
const IDLE = findIdleCycle();
console.log('idle (non-checking) cycle:', IDLE ? IDLE.join(' ') : 'NONE');

/* 再验证一次：IDLE 循环跑 3 遍合法且闭合 */
if (IDLE) {
  const b = parseFen(FEN); const g = XQ.Game.fromBoard(b); g.side = 1;
  let ok = true;
  for (let p = 0; p < 12; p++) {
    const want = IDLE[p % 4];
    const mv = g.legalMoves().find(m => uci(m.f, m.t) === want);
    if (!mv || g.inCheck()) { ok = false; console.log('idle cycle broken at ply', p, want); break; }
    g.move(mv);
  }
  console.log('idle cycle 3x legal+closed:', ok && g.board.join(',') === b.join(',') && g.side === 1);
  if (!(ok && g.board.join(',') === b.join(','))) { console.log('discard idle cycle'); }
}

const steps = [];
const rep = (cycle, n) => Array(n).fill(cycle.join(' ')).join(' ');
if (IDLE) {
  steps.push({ id: 'IDLE_R1', cmds: ['position fen ' + FEN + ' moves ' + rep(IDLE, 1), 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
  steps.push({ id: 'IDLE_R3', cmds: ['position fen ' + FEN + ' moves ' + rep(IDLE, 3), 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
}
steps.push({ id: 'CHK_R4', cmds: ['position fen ' + FEN + ' moves ' + rep(CHK_CYCLE, 4), 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
steps.push({ id: 'CHK_R6', cmds: ['position fen ' + FEN + ' moves ' + rep(CHK_CYCLE, 6), 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
fs.writeFileSync(path.join(__dirname, 'task_rule6.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('steps:', steps.map(s => s.id).join(' '));
