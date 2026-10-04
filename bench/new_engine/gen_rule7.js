/* gen_rule7.js — 第二轮判定探针（干净、无重复混淆）
 *
 * A) PERP 长将判定：红单马长将黑单将，但黑方有一个永远可以横向走的过河卒（a0），
 *    因此黑方永远不会困毙 → 红方绝无杀。engine.js 已断言：
 *      · 红每一手都将军；黑每步都被将且 legalMoves()>=1；
 *      · 4 步循环闭合；
 *      · engine.js depth8 全搜索 |score| < 5000（红无杀）。
 *    三档对照：history 里 0 次 / 2 次 / 3 次循环。
 *      若引擎内置「长将判负」：3 次循环档的分数应从马的物质分（约 +95~+100）塌到 0 或负分。
 *      若没有该规则：三档都保持 +95~+100。
 *
 * B) rule60 边界（无重复混淆）：用「有杀」的局面（第 1 轮已确证 CHK=mate1、HORSE=mate2），
 *    只改 FEN 的 halfmove 字段：116/117/118/119/120/121。
 *    观察 mate 分数在哪一档被「60 回合判和」压掉 → 内置上限的确切值。
 *
 * C) 复现第 1 轮被拒的那条 FEN，隔离到底是 halfmove 还是 fullmove 触发
 *    "Rule60 counter out of range."：999/999 与 999/1、以及 1000/1、10000/1。
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
const sq = (r, c) => r * 9 + c;
const L = (i) => String.fromCharCode(97 + (i % 9));
const NR = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function boardToFen(b, side, hm, fm) {
  let o = '';
  for (let r = 0; r < 10; r++) { let e = 0; for (let c = 0; c < 9; c++) { const v = b[r * 9 + c]; if (!v) { e++; continue; } if (e) { o += e; e = 0; } o += v > 0 ? MAP[v] : MAP[-v].toLowerCase(); } if (e) o += e; if (r < 9) o += '/'; }
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + (hm === undefined ? 0 : hm) + ' ' + (fm === undefined ? 1 : fm);
}
function fenRowsOk(fen) {
  const rows = fen.split(' ')[0].split('/');
  if (rows.length !== 10) return 'rows=' + rows.length;
  for (let r = 0; r < 10; r++) { let n = 0; for (const ch of rows[r]) n += /\d/.test(ch) ? +ch : 1; if (n !== 9) return 'row' + r + '=' + n; }
  return 'ok';
}
function parseFen(f) {
  const rows = f.split(' ')[0].split('/'); const b = new Array(90).fill(0);
  rows.forEach((row, r) => { let i = 0; for (const ch of row) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } });
  return b;
}

const out = { positions: {} };

/* ---------- A) 找「马长将 + 黑有过河卒可永远横走 → 红无杀」的形 ---------- */
const palaceB = [], palaceR = [];
for (let r = 0; r <= 2; r++) for (let c = 3; c <= 5; c++) palaceB.push(sq(r, c));
for (let r = 7; r <= 9; r++) for (let c = 3; c <= 5; c++) palaceR.push(sq(r, c));

const candidates = [];
for (const rk of palaceR) for (let h = 0; h < 90; h++) for (const bk of palaceB) {
  if (bk === h || rk === h) continue;
  const base = new Array(90).fill(0); base[h] = 4; base[bk] = -1; base[rk] = 1;
  if (XQ.inCheck(base, 1) || XQ.inCheck(base, -1)) continue;
  const startKey = base.join(',');
  const g0 = XQ.Game.fromBoard(base.slice()); g0.side = 1;
  if (g0.legalMoves().length === 0) continue;
  const dfs = (board, moves, depth) => {
    if (depth >= 3) return false;
    const g = XQ.Game.fromBoard(board.slice()); g.side = 1;
    for (const m of g.legalMoves()) {
      const b1 = board.slice(); b1[m.t] = b1[m.f]; b1[m.f] = 0;
      if (!XQ.inCheck(b1, -1)) continue;                       // 红必须将军
      const g1 = XQ.Game.fromBoard(b1.slice()); g1.side = -1;
      const replies = g1.legalMoves();
      if (replies.length === 0) continue;                      // 黑不能被将死/困毙
      for (const rm of replies) {
        const b2 = b1.slice(); b2[rm.t] = b2[rm.f]; b2[rm.f] = 0;
        if (XQ.inCheck(b2, 1)) continue;
        const nm = moves.concat([uci(m.f, m.t), uci(rm.f, rm.t)]);
        if (b2.join(',') === startKey && nm.length === 4) { candidates.push({ fen: boardToFen(base, 1), cycle: nm }); return true; }
        if (b2.join(',') === startKey) continue;
        const nm2 = nm;
        void nm2;
        const saved = base.join(',');
        if (b2.join(',') === saved) continue;
        const dfs2 = () => {
          const g2 = XQ.Game.fromBoard(b2.slice()); g2.side = 1;
          for (const m2 of g2.legalMoves()) {
            const c1 = b2.slice(); c1[m2.t] = c2(m2).f; c1[m2.f] = 0;
            function c2(mm) { return { f: mm.t }; }
            if (!XQ.inCheck(c1, -1)) continue;
            const g3 = XQ.Game.fromBoard(c1.slice()); g3.side = -1;
            const rs = g3.legalMoves();
            if (rs.length === 0) continue;
            for (const r2 of rs) {
              const c2b = c1.slice(); c2b[r2.t] = c2b[r2.f]; c2b[r2.f] = 0;
              if (XQ.inCheck(c2b, 1)) continue;
              const nm3 = nm.concat([uci(m2.f, m2.t), uci(r2.f, r2.t)]);
              if (c2b.join(',') === startKey && nm3.length === 4) { candidates.push({ fen: boardToFen(base, 1), cycle: nm3 }); return true; }
            }
          }
          return false;
        };
        if (dfs2()) return true;
      }
    }
    return false;
  };
  dfs(base, [], 0);
  if (candidates.length > 400) break;
}
console.log('horse perpetual-check cycles found:', candidates.length);

/* 加一个黑过河卒 a0（row 9 col 0）：它永远能 a0<->b0 横走 → 黑永不困毙 → 红绝无杀 */
function addBlackPawn(fen) {
  const b = parseFen(fen);
  if (b[sq(9, 0)] !== 0 || b[sq(9, 1)] !== 0) return null;
  b[sq(9, 0)] = -7;
  return b;
}
let perp = null;
for (const c of candidates) {
  const b2 = addBlackPawn(c.fen);
  if (!b2) continue;
  if (XQ.inCheck(b2, 1) || XQ.inCheck(b2, -1)) continue;
  const g = XQ.Game.fromBoard(b2.slice()); g.side = 1;
  if (g.legalMoves().length === 0) continue;
  /* 重跑同一个 4 步循环（在新盘上），断言每步合法、红每步将军、黑每步被将且有应将 */
  let ok = true; const log = [];
  const gg = XQ.Game.fromBoard(b2.slice()); gg.side = 1;
  const startKey = b2.join(',');
  for (let p = 0; p < 12; p++) {
    const want = c.cycle[p % c.cycle.length];
    const legal = gg.legalMoves();
    const mv = legal.find(m => uci(m.f, m.t) === want);
    if (!mv) { ok = false; log.push({ ply: p, fail: 'illegal ' + want, legalCount: legal.length }); break; }
    if (gg.side === -1 && (!gg.inCheck() || legal.length === 0)) { ok = false; log.push({ ply: p, fail: 'black not in forced check' }); break; }
    gg.move(mv);
    log.push({ ply: p, side: -gg.side, play: want, legalBefore: legal.length, inCheckBefore: gg.inCheck() });
  }
  if (!ok) continue;
  if (gg.board.join(',') !== startKey || gg.side !== 1) continue;
  /* 红方 depth8 全搜索：必须无杀（|score| < 5000） */
  const t = XQ.think(b2, 1, 8, 4, 400000, 0, null);
  if (!t || Math.abs(t.score) > 5000) continue;
  /* 黑方每一步都要有合法着法（含卒的横向走法）——逐 ply 检查整个循环 */
  let blackAlwaysMoves = true;
  const gq = XQ.Game.fromBoard(b2.slice()); gq.side = 1;
  for (let p = 0; p < 4; p++) {
    const want = c.cycle[p];
    const legal = gq.legalMoves();
    const mv = legal.find(m => uci(m.f, m.t) === want);
    if (!mv) { blackAlwaysMoves = false; break; }
    gq.move(mv);
    if (gq.legalMoves().length === 0) { blackAlwaysMoves = false; break; }
  }
  if (!blackAlwaysMoves) continue;
  perp = { fen: boardToFen(b2, 1), cycle: c.cycle, depth8ScoreNoMate: t.score, log, baseFen: c.fen };
  break;
}
if (perp) {
  out.positions.PERP = Object.assign({ label: '长将判定：红单马长将 + 黑有过河卒可永远横走（红绝无杀）', fenCheck: fenRowsOk(perp.fen), selfCheckOk: true }, perp);
  console.log('PERP', perp.fen, perp.cycle.join(' '), 'engine.js depth8 score(no mate)=', perp.depth8ScoreNoMate);
} else console.log('PERP: none found');

/* ---------- B) rule60 边界：有杀局面 + 改 halfmove ---------- */
const MATE1 = '4k4/3P5/9/9/5R3/9/9/9/9/3K5';       // 第 1 轮/本轮已确证：新引擎报 mate 1 (pv f5f8)
const MATE2 = '2N1k4/9/9/9/9/9/9/3K5/9/9';          // 新引擎报 mate 2 (pv d2d1 e9f9 c9d7，engine.js 判定为困毙)
out.positions.R60 = { mate1fen: MATE1, mate2fen: MATE2, mate1Rows: fenRowsOk(MATE1), mate2Rows: fenRowsOk(MATE2) };
console.log('R60 mate1 fen rows', fenRowsOk(MATE1), ' mate2 fen rows', fenRowsOk(MATE2));

/* ---------- 任务 ---------- */
const steps = [];
if (out.positions.PERP) {
  const P = out.positions.PERP;
  for (const [tier, n] of [['R0', 0], ['R2', 2], ['R3', 3]]) {
    const mv = n ? ' moves ' + Array(n).fill(P.cycle.join(' ')).join(' ') : '';
    steps.push({ id: 'PERP_' + tier, cmds: ['position fen ' + P.fen + mv, 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
  }
  /* 对照：同一局面但不循环（红不将军的闲着历史）——检验是否只对「重复」敏感 */
  steps.push({ id: 'PERP_NOCHK3', cmds: ['position fen ' + P.fen + ' moves a0b0 c3c4 b0a0 c4c3 a0b0 c3c4 b0a0 c4c3', 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
}
for (const [tag, fen] of [['M1', MATE1], ['M2', MATE2]]) {
  for (const hm of [116, 117, 118, 119, 120, 121, 125]) {
    steps.push({ id: 'B60_' + tag + '_' + hm, cmds: ['position fen ' + fen + ' w - - ' + hm + ' 1', 'go depth 14'], timeoutMs: 12000, gapMs: 300 });
  }
}
for (const [hm, fm] of [[999, 999], [999, 1], [1000, 1], [10000, 1], [120, 999], [121, 999]]) {
  steps.push({ id: 'RNG_' + hm + '_' + fm, cmds: ['position fen ' + MATE1 + ' w - - ' + hm + ' ' + fm, 'go depth 10'], timeoutMs: 10000, gapMs: 300 });
}
fs.writeFileSync(path.join(__dirname, 'rule7_positions.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule5.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('\nsteps(' + steps.length + '):', steps.map(s => s.id).join(' '));
console.log('written -> rule7_positions.json, task_rule5.json');
