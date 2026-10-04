/* gen_rule6.js — 判例判定探针（唯一生成器；所有 FEN/长着法串都在此产出并用项目自身 engine.js 自检）
 *
 * CHK   长将形 A：红车+兵 vs 单将。红每手将军，黑每步被将且 legalMoves()==1（应将被迫）。
 * HORSE 长将形 B：红单马 vs 单将（单马例和，理论上无杀）。红每手将军，黑每步被将且有合法应将。
 * CHZ   长捉形：红车沿第4横线追捉黑炮，黑炮始终被黑将保护（红吃炮=车换炮，亏 300cp），
 *        红每手都在捉炮、全程不将军。
 * SEQR  rule60 边界（自然计数）：红车 a5<->b5 + 黑将 e9<->f9 的无吃子循环，
 *        长着法串由 engine.js 逐步生成并断言每步合法，走到 halfmove 118/119/120/121/149/150。
 * R60F  rule60 字段边界：同一合法 FEN 直接写 halfmove 119..999。
 *
 * 输出：rule6_positions.json + task_rule4.json
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
const sq = (r, c) => r * 9 + c;
const L = (i) => String.fromCharCode(97 + (i % 9));
const NR = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NR(f) + L(t) + NR(t);
function boardToFen(b, side, hm) {
  let o = '';
  for (let r = 0; r < 10; r++) {
    let e = 0;
    for (let c = 0; c < 9; c++) { const v = b[r * 9 + c]; if (!v) { e++; continue; } if (e) { o += e; e = 0; } o += v > 0 ? MAP[v] : MAP[-v].toLowerCase(); }
    if (e) o += e; if (r < 9) o += '/';
  }
  return o + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + (hm || 0) + ' 1';
}
function fenRowsOk(fen) {
  const rows = fen.split(' ')[0].split('/');
  if (rows.length !== 10) return 'rows=' + rows.length;
  for (let r = 0; r < 10; r++) { let n = 0; for (const ch of rows[r]) n += /\d/.test(ch) ? +ch : 1; if (n !== 9) return 'row' + r + '=' + n; }
  return 'ok';
}
const keyOf = (b, s) => b.join(',') + '|' + s;

/* ---------- shared cycle verifier ----------
 * opts: { checkedSide, requireUnique, afterMove(board, sideJustMoved) -> {assertFail?} }
 */
function verifyCycle(board, side, cycle, plies, opts) {
  const g = XQ.Game.fromBoard(board.slice()); g.side = side;
  const startKey = keyOf(g.board, g.side);
  const log = [], fens = [];
  let ok = true;
  for (let p = 0; p < plies; p++) {
    const legal = g.legalMoves();
    const want = cycle[p % cycle.length];
    const mv = legal.find(m => uci(m.f, m.t) === want);
    const chk = g.inCheck();
    const entry = { ply: p, side: g.side, inCheck: chk, play: want, legalMove: !!mv, legalCount: legal.length };
    if (!mv) { entry.assertFail = 'cycle move illegal'; ok = false; }
    if (opts.checkedSide !== null && opts.checkedSide !== undefined && g.side === opts.checkedSide) {
      if (!chk) { entry.assertFail = 'side to move not in check'; ok = false; }
      if (legal.length < 1) { entry.assertFail = 'no legal reply (mate/stalemate)'; ok = false; }
      if (opts.requireUnique && legal.length !== 1) { entry.assertFail = 'reply not forced (' + legal.length + ')'; ok = false; }
    }
    if (opts.forbidCheckSide !== undefined && g.side === opts.forbidCheckSide && chk) { entry.assertFail = 'side must never be in check'; ok = false; }
    log.push(entry);
    fens.push(boardToFen(g.board, g.side));
    if (!mv) break;
    g.move(mv);
    if (opts.afterMove) { const info = opts.afterMove(g.board, -g.side); Object.assign(entry, info); if (info.assertFail) ok = false; }
  }
  return { ok, closed: ok && keyOf(g.board, g.side) === startKey, log, fens, startFen: boardToFen(board, side) };
}

const out = { generated: 'gen_rule6.js', positions: {} };
const giveCheckAssert = (b, justMoved) => (justMoved !== 1 ? {} : (XQ.inCheck(b, -1) ? {} : { assertFail: 'red move gave no check' }));

/* ================= 1) CHK 长将形（红车+兵 vs 单将） ================= */
function chkBoard() { const b = new Array(90).fill(0); b[sq(0, 4)] = -1; b[sq(1, 3)] = 7; b[sq(4, 5)] = 5; b[sq(9, 3)] = 1; return b; }
const CHK_CYCLE = ['f5e5', 'e9f9', 'e5f5', 'f9e9'];
{
  const r = verifyCycle(chkBoard(), 1, CHK_CYCLE, 12, { checkedSide: -1, requireUnique: true, afterMove: giveCheckAssert });
  out.positions.CHK = { label: '长将形A 红车+兵长将单将（应将被迫）', fen: r.startFen, fenCheck: fenRowsOk(r.startFen), cycle: CHK_CYCLE, selfCheckOk: r.ok && r.closed, uniqueReply: r.log.every(e => e.side !== -1 || e.legalCount === 1), log: r.log };
  console.log('CHK  ', r.startFen, 'rows', fenRowsOk(r.startFen), 'selfCheckOk=', r.ok && r.closed);
}

/* ================= 2) HORSE 长将形（红单马 vs 单将；例和形） ================= */
const palaceB = [], palaceR = [];
for (let r = 0; r <= 2; r++) for (let c = 3; c <= 5; c++) palaceB.push(sq(r, c));
for (let r = 7; r <= 9; r++) for (let c = 3; c <= 5; c++) palaceR.push(sq(r, c));
function searchHorseCycles() {
  const found = [];
  for (const rk of palaceR) for (let h1 = 0; h1 < 90; h1++) for (const bk1 of palaceB) {
    if (bk1 === h1 || rk === h1) continue;
    const s0 = new Array(90).fill(0); s0[h1] = 4; s0[bk1] = -1; s0[rk] = 1;
    if (XQ.inCheck(s0, 1) || XQ.inCheck(s0, -1)) continue;
    if (XQ.Game.fromBoard(s0.slice()).legalMoves().length === 0) continue;
    const startKey = keyOf(s0, 1);
    const visited = new Set([startKey]);
    const dfs = (board, moves, depth) => {
      if (depth >= 4) return false;
      const g = XQ.Game.fromBoard(board.slice()); g.side = 1;
      for (const m of g.legalMoves()) {
        const b1 = board.slice(); b1[m.t] = b1[m.f]; b1[m.f] = 0;
        if (!XQ.inCheck(b1, -1)) continue;
        const g1 = XQ.Game.fromBoard(b1.slice()); g1.side = -1;
        const replies = g1.legalMoves();
        if (replies.length === 0) continue;
        for (const rm of replies) {
          const b2 = b1.slice(); b2[rm.t] = b2[rm.f]; b2[rm.f] = 0;
          if (XQ.inCheck(b2, 1)) continue;
          const nm = moves.concat([uci(m.f, m.t), uci(rm.f, rm.t)]);
          if (keyOf(b2, 1) === startKey && nm.length >= 4) { found.push({ fen: boardToFen(s0, 1), cycle: nm }); return true; }
          if (visited.has(keyOf(b2, 1))) continue;
          visited.add(keyOf(b2, 1));
          if (dfs(b2, nm, depth + 1)) return true;
          visited.delete(keyOf(b2, 1));
        }
      }
      return false;
    };
    dfs(s0, [], 0);
    if (found.length >= 8) return found;
  }
  return found;
}
{
  const cands = searchHorseCycles();
  let best = null;
  for (const c of cands) {
    const rows = c.fen.split(' ')[0].split('/');
    const b = new Array(90).fill(0);
    for (let r = 0; r < 10; r++) { let i = 0; for (const ch of rows[r]) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } }
    const r = verifyCycle(b, 1, c.cycle, 12, { checkedSide: -1, requireUnique: false, afterMove: giveCheckAssert });
    const uniq = r.log.every(e => e.side !== -1 || e.legalCount === 1);
    const t = XQ.think(b, 1, 6, 3, 300000, 0, null);   // 红方 depth6 全搜索：应无杀，只有子力分
    const noMate = t && Math.abs(t.score) < 5000;
    console.log('HORSE cand', c.fen, c.cycle.join(' '), 'ok=', r.ok && r.closed, 'uniqueReply=', uniq, 'depth6score=', t ? t.score : 'n/a');
    if (r.ok && r.closed && noMate && (!best || uniq)) best = { fen: c.fen, cycle: c.cycle, selfCheckOk: true, uniqueReply: uniq, depth6ScoreNoMate: t ? t.score : null, log: r.log };
    if (best && best.uniqueReply) break;
  }
  if (best) out.positions.HORSE = Object.assign({ label: '长将形B 红单马长将单将（单马例和，无杀）', fenCheck: fenRowsOk(best.fen) }, best);
  console.log('HORSE chosen:', best ? best.fen + ' ' + best.cycle.join(' ') + ' uniqueReply=' + best.uniqueReply : 'NONE');
}

/* ================= 3) 长捉形（两版）=================
 * 象棋规则里「捉」要求被捉子是无根子；若被捉子有根，吃子要亏子力，严格说不构成「捉」。
 * 两个构造无法同时满足「无根」和「循环被迫」，所以两版都跑，各自只能回答一半：
 *   CHZ1 车捉无根象（符合「捉」的定义；红方可以直接吃子，循环不被迫）
 *   CHZ2 车捉有根炮（吃炮=车换炮亏 300cp，红方只能持续捉；严格按定义不构成「捉」）
 */
function chaseAssertFor(piece) {
  return (b, justMoved) => {
    if (justMoved !== 1) return {};
    let at = -1; for (let i = 0; i < 90; i++) if (b[i] === piece) at = i;
    if (at < 0) return { assertFail: 'chased piece gone' };
    if (XQ.inCheck(b, -1)) return { assertFail: 'became a check, not a chase' };
    if (!XQ.isAttacked(b, at, 1)) return { assertFail: 'chased piece not attacked' };
    return { chasedAt: uci(at, at), attacked: true, guardedByEnemy: XQ.isAttacked(b, at, -1) };
  };
}
/* CHZ1: 黑将 d9 + 黑象 e5(无根)；红车 c4/e4 交替捉 e5 / c7 的象；红帅 f0 */
function chz1Board() { const b = new Array(90).fill(0); b[sq(0, 3)] = -1; b[sq(4, 4)] = -3; b[sq(5, 2)] = 5; b[sq(9, 5)] = 1; return b; }
const CHZ1_CYCLE = ['c4e4', 'e5c7', 'e4c4', 'c7e5'];
/* CHZ2: 黑将 e9 + 黑炮 e5（被黑车 i5 保护）；红车 c5/d5 沿第5横线交替捉 e5/f5 的炮；红帅 d0。
 * 红若吃炮则黑车吃回红车 = 车换炮（红亏 300cp），红只能持续捉 → 循环在实战上被迫；
 * 但严格按亚洲规则「捉」须得子，此形严格说不构成捉 —— 与 CHZ1 互为上下界。 */
function chz2Board() { const b = new Array(90).fill(0); b[sq(0, 4)] = -1; b[sq(4, 8)] = -5; b[sq(4, 4)] = -6; b[sq(4, 2)] = 5; b[sq(9, 3)] = 1; return b; }
const CHZ2_CYCLE = ['c5d5', 'e5f5', 'd5c5', 'f5e5'];
for (const [tag, board, cycle, piece, label] of [
  ['CHZ1', chz1Board, CHZ1_CYCLE, -3, '长捉形1 红车长捉无根黑象（符合捉定义，循环非被迫：红可直接吃象）'],
  ['CHZ2', chz2Board, CHZ2_CYCLE, -6, '长捉形2 红车长捉有根黑炮（吃炮=车换炮亏300cp，只能持续捉；严格按定义不构成捉）'],
]) {
  const r = verifyCycle(board(), 1, cycle, 12, { checkedSide: null, forbidCheckSide: -1, afterMove: chaseAssertFor(piece) });
  out.positions[tag] = { label, fen: r.startFen, fenCheck: fenRowsOk(r.startFen), cycle, selfCheckOk: r.ok && r.closed, log: r.log };
  console.log(tag, r.startFen, 'rows', fenRowsOk(r.startFen), 'selfCheckOk=', r.ok && r.closed);
  for (const e of r.log) console.log('   ply', e.ply, 'side', e.side, e.play, 'legal=' + e.legalCount, e.attacked ? ('CHASED attacked guarded=' + e.guardedByEnemy) : '', e.assertFail || '');
}

/* ================= 4) SEQR rule60 自然计数（无吃子无兵循环） ================= */
function seqBoard() { const b = new Array(90).fill(0); b[sq(0, 4)] = -1; b[sq(4, 0)] = 5; b[sq(9, 3)] = 1; return b; }
const SEQ_CYCLE = ['a5b5', 'e9f9', 'b5a5', 'f9e9'];
{
  const r = verifyCycle(seqBoard(), 1, SEQ_CYCLE, 160, { checkedSide: null });
  const moves = r.log.filter(e => e.legalMove).map(e => e.play);
  out.positions.SEQ = { label: 'rule60 探针：无吃子无兵循环（红车 a5<->b5 / 黑将 e9<->f9）', fen: r.startFen, cycle: SEQ_CYCLE, selfCheckOk: r.ok && r.closed, movesGenerated: moves.length };
  console.log('SEQ  ', r.startFen, 'selfCheckOk=', r.ok && r.closed, 'movesGenerated=', moves.length);

  for (const plies of [118, 119, 120, 121, 149, 150]) {
    if (moves.length < plies) { console.log('SKIP SEQR', plies); continue; }
    out.positions.SEQ['moves' + plies] = moves.slice(0, plies).join(' ');
  }
}

/* ================= 任务文件 ================= */
const P = out.positions;
const steps = [];
const cycleStr = (c, n) => Array(n).fill(c.join(' ')).join(' ').trim();
for (const [tag, pos] of [['CHK', P.CHK], ['HORSE', P.HORSE], ['CHZ1', P.CHZ1], ['CHZ2', P.CHZ2]]) {
  if (!pos || !pos.selfCheckOk) { console.log('SKIP step', tag, '(self-check failed)'); continue; }
  for (const [tier, n] of [['R0', 0], ['R2', 2], ['R3', 3]]) {
    const mv = n ? ' moves ' + cycleStr(pos.cycle, n) : '';
    steps.push({ id: tag + '_' + tier, cmds: ['position fen ' + pos.fen + mv, 'go depth 14'], timeoutMs: 15000, gapMs: 300 });
  }
}
if (P.SEQ && P.SEQ.selfCheckOk) {
  for (const plies of [118, 119, 120, 121, 149, 150]) {
    const ms = P.SEQ['moves' + plies]; if (!ms) continue;
    steps.push({ id: 'SEQR_' + plies, cmds: ['position fen ' + P.SEQ.fen + ' moves ' + ms, 'go depth 12'], timeoutMs: 12000, gapMs: 400 });
  }
  for (const hm of [119, 120, 121, 149, 150, 199, 200, 299, 300, 499, 500, 998, 999]) {
    steps.push({ id: 'R60F_' + hm, cmds: ['position fen ' + P.SEQ.fen.replace(/ - - 0 1$/, ' - - ' + hm + ' 1'), 'go depth 10'], timeoutMs: 8000, gapMs: 300 });
  }
}
fs.writeFileSync(path.join(__dirname, 'rule6_positions.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule4.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('\nsteps(' + steps.length + '):', steps.map(s => s.id).join(' '));
console.log('written -> rule6_positions.json, task_rule4.json');
