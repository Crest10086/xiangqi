/* gen_rule8.js — 第二轮判定探针（干净、无重复混淆）
 *
 * A) PERP 长将判定：红单马长将黑单将，且黑方有一个永远可以横向走的过河卒（a0），
 *    所以黑方永远不会困毙 → 红方绝无杀。生成器用项目自身 engine.js 断言：
 *      · 4 步循环闭合；红每一手都将军；黑每步都被将且 legalMoves()>=1；
 *      · engine.js depth8 全搜索 |score| < 5000（红无杀）。
 *    三档对照：history 里 0 次 / 2 次 / 3 次循环。
 *      若引擎内置「长将判负」：3 次循环档的分数应从马的物质分（约 +95~+100）塌到 0 或负分。
 *      若没有该规则：三档都保持 +95~+100。
 *
 * B) rule60 边界（无重复混淆）：用已确证「有杀」的局面（M1 = 新引擎报 mate 1；M2 = 报 mate 2），
 *    只改 FEN 的 halfmove 字段：116..125。观察 mate 分数在哪一档被「60 回合判和」压掉。
 *
 * C) 隔离第 1 轮被拒的那条 FEN：999/999 与 999/1、1000/1、10000/1、120/999 —— 判定
 *    是 halfmove 还是 fullmove 触发 "Rule60 counter out of range."。
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
const palaceB = [], palaceR = [];
for (let r = 0; r <= 2; r++) for (let c = 3; c <= 5; c++) palaceB.push(sq(r, c));
for (let r = 7; r <= 9; r++) for (let c = 3; c <= 5; c++) palaceR.push(sq(r, c));

/* ---------- 1) 枚举「红马每步将军 / 黑每步被将且有应将」的 4 步闭合循环 ---------- */
const cycles = [];
outer:
for (const rk of palaceR) for (let h = 0; h < 90; h++) for (const bk of palaceB) {
  if (bk === h || rk === h) continue;
  const base = new Array(90).fill(0); base[h] = 4; base[bk] = -1; base[rk] = 1;
  if (XQ.inCheck(base, 1) || XQ.inCheck(base, -1)) continue;
  if (XQ.Game.fromBoard(base.slice()).legalMoves().length === 0) continue;
  const startKey = base.join(',');
  const visited = new Set([startKey]);
  const dfs = (board, moves, depth) => {
    if (depth >= 3) return false;
    const g = XQ.Game.fromBoard(board.slice()); g.side = 1;
    for (const m of g.legalMoves()) {
      const b1 = board.slice(); b1[m.t] = b1[m.f]; b1[m.f] = 0;
      if (!XQ.inCheck(b1, -1)) continue;                        // 红这手必须将军
      const g1 = XQ.Game.fromBoard(b1.slice()); g1.side = -1;
      const replies = g1.legalMoves();
      if (replies.length === 0) continue;                       // 黑不能被将死/困毙
      for (const rm of replies) {
        const b2 = b1.slice(); b2[rm.t] = b2[rm.f]; b2[rm.f] = 0;
        if (XQ.inCheck(b2, 1)) continue;                        // 黑不能反将
        const nm = moves.concat([uci(m.f, m.t), uci(rm.f, rm.t)]);
        if (b2.join(',') === startKey) { if (nm.length === 4) { cycles.push({ fen: boardToFen(base, 1), cycle: nm }); return true; } continue; }
        if (visited.has(b2.join(',') + '|1')) continue;
        visited.add(b2.join(',') + '|1');
        if (dfs(b2, nm, depth + 1)) return true;
        visited.delete(b2.join(',') + '|1');
      }
    }
    return false;
  };
  dfs(base, [], 0);
  if (cycles.length > 300) break outer;
}
console.log('horse perpetual-check 4-ply cycles:', cycles.length);

/* ---------- 2) 加黑过河卒 a0（永远能 a0<->b0 横走 → 黑永不困毙 → 红绝无杀）+ 全量断言 ---------- */
function validatePerp(baseFen, cycle) {
  const b = parseFen(baseFen);
  if (b[sq(9, 0)] !== 0 || b[sq(9, 1)] !== 0) return null;
  b[sq(9, 0)] = -7;                                  // 黑过河卒 a0
  if (XQ.inCheck(b, 1) || XQ.inCheck(b, -1)) return null;
  const startKey = b.join(',');
  const log = [];
  const g = XQ.Game.fromBoard(b.slice()); g.side = 1;
  for (let p = 0; p < 12; p++) {
    const want = cycle[p % cycle.length];
    const legal = g.legalMoves();
    const mv = legal.find(m => uci(m.f, m.t) === want);
    const wasCheck = g.inCheck();
    if (!mv) return { fail: 'ply' + p + ' cycle move ' + want + ' illegal (legal=' + legal.length + ')' };
    if (g.side === -1 && (!wasCheck || legal.length === 0)) return { fail: 'ply' + p + ' black not in a forced check' };
    log.push({ ply: p, mover: g.side, play: want, wasInCheck: wasCheck, legalBefore: legal.length });
    g.move(mv);
    if (g.legalMoves().length === 0) return { fail: 'ply' + p + ' side to move has no legal move (mate/stalemate)' };
  }
  if (g.board.join(',') !== startKey || g.side !== 1) return { fail: 'cycle not closed' };
  const t = XQ.think(b, 1, 8, 4, 400000, 0, null);
  if (!t || Math.abs(t.score) > 5000) return { fail: 'engine.js depth8 finds a mate for red (score ' + (t && t.score) + ')' };
  return { fen: boardToFen(b, 1), cycle, log, depth8ScoreNoMate: t.score, nodes8: t.nodes };
}
let perp = null;
for (const c of cycles) {
  const r = validatePerp(c.fen, c.cycle);
  if (r) { perp = r; break; }
}
const out = { positions: {} };
if (perp) {
  out.positions.PERP = Object.assign({ label: '长将判定：红单马长将 + 黑有过河卒可永远横走（红绝无杀）', fenCheck: fenRowsOk(perp.fen), selfCheckOk: true }, perp);
  console.log('PERP', perp.fen, perp.cycle.join(' '), 'engine.js depth8 score (no mate) =', perp.depth8ScoreNoMate, 'nodes', perp.nodes8);
  for (const e of perp.log.slice(0, 4)) console.log('   ply', e.ply, 'mover', e.mover, e.play, 'wasInCheck=' + e.wasInCheck, 'legalBefore=' + e.legalBefore);
} else console.log('PERP: none found');

/* ---------- 3) rule60 边界：已确证有杀的局面 + 只改 halfmove ---------- */
const M1 = '4k4/3P5/9/9/5R3/9/9/9/9/3K5';   // 新引擎报 mate 1 (pv f5f8)
const M2 = '2N1k4/9/9/9/9/9/9/3K5/9/9';      // 新引擎报 mate 2 (pv d2d1 e9f9 c9d7)
out.positions.R60 = { M1, M2, M1rows: fenRowsOk(M1), M2rows: fenRowsOk(M2) };
console.log('R60 probe fens rows:', fenRowsOk(M1), fenRowsOk(M2));

/* ---------- 4) 任务文件 ---------- */
const steps = [];
if (out.positions.PERP) {
  const P = out.positions.PERP;
  for (const [tier, n] of [['R0', 0], ['R2', 2], ['R3', 3]]) {
    const mv = n ? ' moves ' + Array(n).fill(P.cycle.join(' ')).join(' ') : '';
    steps.push({ id: 'PERP_' + tier, cmds: ['position fen ' + P.fen + mv, 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
  }
  /* 对照：同一局面，history 里是「双方都不将军」的 4 步重复循环（由 engine.js 搜索并闭合），
   * 用来区分「引擎对重复本身敏感」和「引擎只对长将敏感」。 */
  {
    const b = parseFen(P.fen);
    const startKey = b.join(',');
    let idle = null;
    const dfs = (board, moves, depth) => {
      if (depth >= 3) return false;
      const g = XQ.Game.fromBoard(board.slice()); g.side = 1;
      for (const m of g.legalMoves()) {
        const b1 = board.slice(); b1[m.t] = b1[m.f]; b1[m.f] = 0;
        if (XQ.inCheck(b1, -1)) continue;                       // 红不将军
        const g1 = XQ.Game.fromBoard(b1.slice()); g1.side = -1;
        for (const rm of g1.legalMoves()) {
          const b2 = b1.slice(); b2[rm.t] = b2[rm.f]; b2[rm.f] = 0;
          if (XQ.inCheck(b2, 1)) continue;                     // 黑不将军
          const nm = moves.concat([uci(m.f, m.t), uci(rm.f, rm.t)]);
          if (b2.join(',') === startKey && nm.length === 4) { idle = nm; return true; }
        }
      }
      return false;
    };
    dfs(b, [], 0);
    if (idle) {
      out.positions.PERP.idleCycle = idle;
      steps.push({ id: 'PERP_IDLE3', cmds: ['position fen ' + P.fen + ' moves ' + Array(3).fill(idle.join(' ')).join(' '), 'go depth 15'], timeoutMs: 20000, gapMs: 300 });
    } else console.log('PERP_IDLE3 skipped (no closed non-checking 4-ply cycle)');
  }
}
for (const [tag, fen] of [['M1', M1], ['M2', M2]]) {
  for (const hm of [116, 117, 118, 119, 120, 121, 125]) {
    steps.push({ id: 'B60_' + tag + '_' + hm, cmds: ['position fen ' + fen + ' w - - ' + hm + ' 1', 'go depth 14'], timeoutMs: 12000, gapMs: 300 });
  }
}
for (const [hm, fm] of [[999, 999], [999, 1], [1000, 1], [10000, 1], [120, 999], [121, 999], [0, 999]]) {
  steps.push({ id: 'RNG_' + hm + '_' + fm, cmds: ['position fen ' + M1 + ' w - - ' + hm + ' ' + fm, 'go depth 10'], timeoutMs: 10000, gapMs: 300 });
}
fs.writeFileSync(path.join(__dirname, 'rule8_positions.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule5.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('\nsteps(' + steps.length + '):', steps.map(s => s.id).join(' '));
console.log('written -> rule8_positions.json, task_rule5.json');
