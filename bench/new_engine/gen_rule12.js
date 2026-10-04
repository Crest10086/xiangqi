/* gen_rule12.js — 收尾两件事（一次跑完）
 *
 * (1) R60T：把「困毙在 1」的根局面直接写成 FEN，只改 halfmove 字段 116..122。
 *     该局面由 replay_rule7.js 从已验证的长着法串末态导出（无吃子、无将军、无重复歧义）：
 *       4k4/3R5/9/9/9/9/9/9/9/3K5 w  —— engine.js 断言：红有 d8f8 一步造成黑方 legalMoves()==0（困毙）
 *       5k3/3R5/9/9/9/9/9/9/9/3K5 b  —— 黑只有 1 个合法着法，走完红下一步即困毙
 *     目的：定位内置 60 回合规则的确切阈值（mate 分数在哪一档被判和压掉）。
 *
 * (2) CHZF：修正版长捉探针。上一轮 CHZ1 被新引擎拒收的真正原因是我把黑象放在 e5 —— 黑象只能
 *     位于 7 个合法象位（c9/g9/a7/e7/i7/c5/g5），e5 不在其中；项目 engine.js 不校验象位所以自检没拦住。
 *     这里把黑象放在合法象位 c5（无根），红车 e4<->c4 交替捉 c5/e7 的象。三档 ×0/×2/×3。
 *
 * 所有 FEN/着法串都在此生成并用项目 engine.js 断言。
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
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + (hm === undefined ? 0 : hm) + ' 1';
}
function parseFen(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } });
  return b;
}
const ELEPHANT_SQ = new Set([[0, 2], [0, 6], [2, 0], [2, 4], [2, 8], [4, 2], [4, 6]].map(([r, c]) => r * 9 + c));

const out = {};

/* ---------- (1) 困毙在 1 的局面：验证 + 只改 halfmove ---------- */
const M1STALE_W = '4k4/3R5/9/9/9/9/9/9/9/3K5';   // 红走，d8f8 → 黑 legalMoves()==0
const M1STALE_B = '5k3/3R5/9/9/9/9/9/9/9/3K5';    // 黑走，只有 1 个合法着法
function assertStaleMate1(fen, moverSide, pv) {
  const b = parseFen(fen); const g = XQ.Game.fromBoard(b); g.side = moverSide;
  const lm = g.legalMoves();
  const info = { legalMovesAtRoot: lm.length };
  if (pv) {
    const mv = lm.find(m => uci(m.f, m.t) === pv);
    info.pvLegal = !!mv;
    if (mv) {
      const nb = g.board.slice(); nb[mv.t] = nb[mv.f]; nb[mv.f] = 0;
      const g2 = XQ.Game.fromBoard(nb); g2.side = -moverSide;
      info.afterPvOpponentLegal = g2.legalMoves().length;
      info.afterPvOpponentInCheck = g2.inCheck();
      info.terminalType = g2.legalMoves().length === 0 ? (g2.inCheck() ? '将死' : '困毙') : 'not terminal';
    }
  }
  return info;
}
out.staleW = assertStaleMate1(M1STALE_W, 1, 'd8f8');
out.staleB = assertStaleMate1(M1STALE_B, -1, null);
out.staleB.blackLegal = (() => { const g = XQ.Game.fromBoard(parseFen(M1STALE_B)); g.side = -1; return g.legalMoves().map(m => uci(m.f, m.t)); })();
console.log('staleW assert:', JSON.stringify(out.staleW));
console.log('staleB assert:', JSON.stringify(out.staleB));

/* ---------- (2) 修正版长捉探针 ---------- */
function chaseBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 5)] = -1;  // 黑将 f9
  b[sq(4, 2)] = -3;  // 黑象 c5（合法象位、无根）
  b[sq(5, 4)] = 5;   // 红车 e4
  b[sq(9, 3)] = 1;   // 红帅 d0
  return b;
}
const CHZ_CYCLE = ['e4c4', 'c5e7', 'c4e4', 'e7c5'];
function verifyChase() {
  const b = chaseBoard();
  const startKey = b.join(',');
  let ok = true; const log = [];
  for (let i = 0; i < 90; i++) if (b[i] === -3 && !ELEPHANT_SQ.has(i)) { ok = false; log.push({ fail: 'initial elephant on illegal square ' + uci(i, i) }); }
  const g = XQ.Game.fromBoard(b); g.side = 1;
  for (let p = 0; p < 12; p++) {
    const want = CHZ_CYCLE[p % CHZ_CYCLE.length];
    const legal = g.legalMoves();
    const mv = legal.find(m => uci(m.f, m.t) === want);
    if (!mv) { ok = false; log.push({ ply: p, fail: 'illegal ' + want, legalCount: legal.length }); break; }
    if (g.inCheck()) { ok = false; log.push({ ply: p, fail: 'side to move already in check' }); break; }
    const mover = g.side;
    g.move(mv);
    if (g.inCheck()) { ok = false; log.push({ ply: p, fail: 'move gave check (not a pure chase)' }); break; }
    if (mover === 1) {
      let at = -1; for (let i = 0; i < 90; i++) if (g.board[i] === -3) at = i;
      if (at < 0) { ok = false; log.push({ ply: p, fail: 'chased elephant gone' }); break; }
      const attacked = XQ.isAttacked(g.board, at, 1);
      const guarded = XQ.isAttacked(g.board, at, -1);
      log.push({ ply: p, play: want, elephantAt: uci(at, at), legalSquare: ELEPHANT_SQ.has(at), attacked, unguarded: !guarded });
      if (!ELEPHANT_SQ.has(at) || !attacked || guarded) { ok = false; log.push({ ply: p, fail: 'chase assertion failed' }); break; }
    }
    if (g.legalMoves().length === 0) { ok = false; log.push({ ply: p, fail: 'opponent has no legal move' }); break; }
  }
  const closed = g.board.join(',') === startKey && g.side === 1;
  return { ok: ok && closed, fen: boardToFen(b, 1), log };
}
const chz = verifyChase();
out.chz = chz;
console.log('CHZF', chz.fen, 'selfCheckOk=', chz.ok);
for (const e of chz.log) console.log('  ', JSON.stringify(e));

/* ---------- 任务 ---------- */
const steps = [];
for (const hm of [0, 116, 117, 118, 119, 120, 121, 122, 125]) {
  steps.push({ id: 'R60T_W_' + hm, cmds: ['position fen ' + M1STALE_W + ' w - - ' + hm + ' 1', 'go depth 14'], timeoutMs: 12000, gapMs: 300 });
}
for (const hm of [0, 118, 119, 120, 121]) {
  steps.push({ id: 'R60T_B_' + hm, cmds: ['position fen ' + M1STALE_B + ' b - - ' + hm + ' 1', 'go depth 14'], timeoutMs: 12000, gapMs: 300 });
}
if (chz.ok) {
  const rep = n => Array(n).fill(CHZ_CYCLE.join(' ')).join(' ');
  steps.push({ id: 'CHZF_R0', cmds: ['position fen ' + chz.fen, 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
  steps.push({ id: 'CHZF_R2', cmds: ['position fen ' + chz.fen + ' moves ' + rep(2), 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
  steps.push({ id: 'CHZF_R3', cmds: ['position fen ' + chz.fen + ' moves ' + rep(3), 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
} else console.log('CHZF steps skipped');
fs.writeFileSync(path.join(__dirname, 'rule12_positions.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule8.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('steps(' + steps.length + '):', steps.map(s => s.id).join(' '));
