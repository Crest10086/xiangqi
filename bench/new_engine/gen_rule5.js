/* gen_rule5.js — 判例判定探针生成器（全部局面由本生成器产出，并用项目自身 engine.js 自检）
 *
 * CHK   长将形 A：红车 e5/f5 交替将军黑将 e9/f9（红兵 d8 封住 d9/e8）。
 *       断言：黑方每一手 inCheck==true 且 legalMoves().length==1（应将被迫），
 *             红方每一手都 gaveCheck，4 步循环回到同一局面。红多车兵。
 * HORSE 长将形 B：红马单马长将黑将（理论上单马不能将死单将 → 根局面不该有杀）。
 *       由搜索器枚举（黑将/红帅/红马位置）找到"黑方每步被将且只有 1 个合法应将"的 4 步被迫循环。
 * CHASE 长捉形：红车 c4/e4 交替捉黑象 e5/c7（象无根、不能被车吃、也不是将军）。
 *       断言：每手合法；红方落子后黑象确实被攻击（捉成立）；黑方不被将军；4 步循环闭合。
 * SEQ   rule60 边界：用"红车 a5<->b5 + 黑将 e9<->f9"的无吃子无兵循环，
 *       用 engine.js 生成 118/119/120/121/149/150 目的合法长着法串（引擎自己计数）。
 * R60F  rule60 字段边界：同一 FEN 直接写 halfmove = 119/120/121/149/150/199/200/299/300/499/500/998/999。
 *
 * 输出：rule5_positions.json + task_rule4.json
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
function boardToFen(board, side, halfmove) {
  let out = '';
  for (let r = 0; r < 10; r++) {
    let empty = 0;
    for (let c = 0; c < 9; c++) {
      const v = board[r * 9 + c];
      if (v === 0) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      out += v > 0 ? MAP[v] : MAP[-v].toLowerCase();
    }
    if (empty) out += empty;
    if (r < 9) out += '/';
  }
  const hm = halfmove === undefined ? 0 : halfmove;
  return out + ' ' + (side === 1 ? 'w' : 'b') + ' - - ' + hm + ' 1';
}
function fenRowsOk(fen) {
  const rows = fen.split(' ')[0].split('/');
  if (rows.length !== 10) return 'rows=' + rows.length;
  for (let r = 0; r < 10; r++) {
    let n = 0;
    for (const ch of rows[r]) n += /\d/.test(ch) ? +ch : 1;
    if (n !== 9) return 'row' + r + '=' + n;
  }
  return 'ok';
}
const L = (i) => String.fromCharCode(97 + (i % 9));
const NN = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + NN(f) + L(t) + NN(t);
const sq = (row, col) => row * 9 + col;
const NAME = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
const key = (b, s) => b.join(',') + '|' + s;

/* ---------- generic forced-cycle verifier ---------- */
function verifyCycle(board, side, cycle, plies, opts) {
  const g = XQ.Game.fromBoard(board.slice());
  g.side = side;
  const startKey = key(g.board, g.side);
  const log = [], fens = [];
  let ok = true;
  for (let p = 0; p < plies; p++) {
    const legal = g.legalMoves();
    const want = cycle[p % cycle.length];
    const mv = legal.find(m => uci(m.f, m.t) === want);
    const chk = g.inCheck();
    const entry = { ply: p, side: g.side, inCheck: chk, play: want, legalMove: !!mv, legalCount: legal.length };
    if (!mv) { entry.assertFail = 'cycle move illegal'; ok = false; }
    if (opts.checkedSide !== null && g.side === opts.checkedSide) {
      if (!chk) { entry.assertFail = 'not in check'; ok = false; }
      if (legal.length < 1) { entry.assertFail = 'no legal reply (mate/stalemate)'; ok = false; }
      if (opts.requireUnique && legal.length !== 1) { entry.assertFail = 'reply not forced (' + legal.length + ')'; ok = false; }
    }
    log.push(entry);
    fens.push(boardToFen(g.board, g.side));
    if (!mv) break;
    g.move(mv);
    if (opts.afterMove) {
      const info = opts.afterMove(g.board, g.side);
      Object.assign(entry, info);
      if (info.assertFail) ok = false;
    }
  }
  const closed = ok && key(g.board, g.side) === startKey;
  return { ok, closed, log, fens, startFen: boardToFen(board, side) };
}

const out = { positions: {} };

/* ============ 1) CHK 长将形（红车+兵 vs 单将） ============ */
function chkBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 4)] = -1;  // 黑将 e9
  b[sq(1, 3)] = 7;   // 红兵 d8（守 d9 / e8 / c8）
  b[sq(4, 5)] = 5;   // 红车 f5
  b[sq(9, 3)] = 1;   // 红帅 d0
  return b;
}
const CHK_CYCLE = ['f5e5', 'e9f9', 'e5f5', 'f9e9'];
{
  const r = verifyCycle(chkBoard(), 1, CHK_CYCLE, 12, {
    checkedSide: -1, requireUnique: true,
    afterMove: (b, side) => (side === 1 ? {} : (XQ.inCheck(b, -1) ? {} : { assertFail: 'red move did not give check' })),
  });
  out.positions.CHK = {
    fen: r.startFen, fenCheck: fenRowsOk(r.startFen), cycle: CHK_CYCLE,
    selfCheckOk: r.ok && r.closed, material: '红车+兵 vs 单将（红大优）',
    log: r.log, fenAfter: { x1: r.fens[4], x2: r.fens[8], x3: r.fens[12] },
  };
  console.log('CHK  ', r.startFen, 'rows', fenRowsOk(r.startFen), 'selfCheckOk=', r.ok && r.closed);
}

/* ============ 2) HORSE 长将形（红单马 vs 单将；理论上不可能将死） ============ */
function findHorseCycle() {
  const palaceR = [], palaceB = [];
  for (let r = 7; r <= 9; r++) for (let c = 3; c <= 5; c++) palaceR.push(sq(r, c));
  for (let r = 0; r <= 2; r++) for (let c = 3; c <= 5; c++) palaceB.push(sq(r, c));
  const results = [];
  const seenRoot = new Set();
  for (const bk of palaceB) for (const rk of palaceR) for (let h = 0; h < 90; h++) {
    if (h === bk || h === rk) continue;
    const b0 = new Array(90).fill(0); b0[bk] = -1; b0[rk] = 1; b0[h] = 4;
    if (XQ.inCheck(b0, 1) || XQ.inCheck(b0, -1)) continue;   // 起始面：谁都不被将
    const g0 = XQ.Game.fromBoard(b0.slice());
    if (g0.legalMoves().length === 0) continue;
    // DFS: 红走 -> 必须将军 -> 黑只有 1 个合法应将 -> 回到同一 (board,side) 即被迫循环
    const path = [{ b: b0, side: 1, moves: [] }];
    const visited = new Set([key(b0, 1)]);
    const dfs = (node, depth) => {
      if (depth >= 8) return;
      const g = XQ.Game.fromBoard(node.b.slice()); g.side = 1;
      for (const m of g.legalMoves()) {
        const nb = g.board.slice(); nb[m.t] = nb[m.f]; nb[m.f] = 0;
        if (!XQ.inCheck(nb, -1)) continue;                    // 红这手必须将军
        const g2 = XQ.Game.fromBoard(nb.slice()); g2.side = -1;
        const replies = g2.legalMoves();
        if (replies.length !== 1) continue;                   // 应将被迫
        const rm = replies[0];
        const nb2 = nb.slice(); nb2[rm.t] = nb2[rm.f]; nb2[rm.f] = 0;
        if (XQ.inCheck(nb2, 1)) continue;                     // 红不能被将（否则红要应将，不是长将方）
        const mv = node.moves.concat([uci(m.f, m.t), uci(rm.f, rm.t)]);
        const k = key(nb2, 1);
        if (k === key(b0, 1) && mv.length >= 4) { results.push({ fen: boardToFen(b0, 1), cycle: mv, startSquares: { bk, rk, h } }); return true; }
        if (visited.has(k)) continue;
        visited.add(k);
        if (dfs({ b: nb2, side: 1, moves: mv }, depth + 2)) return true;
        visited.delete(k);
      }
      return false;
    };
    dfs(path[0], 0);
    if (results.length >= 6) break;
  }
  return results;
}
{
  const t0 = Date.now();
  const found = findHorseCycle();
  console.log('HORSE search: found', found.length, 'cycles in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  const good = [];
  for (const f of found) {
    const half = f.cycle.length / 2;                     // [red, black, red, black]
    const cycle = f.cycle.slice(0, f.cycle.length);
    const b0 = new Array(90).fill(0);
    // rebuild board from FEN to verify with the same verifier
    const rows = f.fen.split(' ')[0].split('/');
    const b = new Array(90).fill(0);
    for (let r = 0; r < 10; r++) { let i = 0; for (const ch of rows[r]) { if (/\d/.test(ch)) i += +ch; else { const up = ch === ch.toUpperCase(); const v = 'KABNRPC'.indexOf(ch.toUpperCase()) + 1; b[r * 9 + i] = up ? v : -v; i++; } } }
    const r = verifyCycle(b, 1, cycle, 12, {
      checkedSide: -1, requireUnique: true,
      afterMove: (bb, side) => (side === 1 ? {} : (XQ.inCheck(bb, -1) ? {} : { assertFail: 'no check' })),
    });
    console.log('  candidate', f.fen, 'cycle', cycle.join(' '), 'selfCheckOk=', r.ok && r.closed);
    if (r.ok && r.closed) good.push({ fen: f.fen, cycle, selfCheckOk: true, log: r.log, fenAfter: { x1: r.fens[4], x2: r.fens[8], x3: r.fens[12] } });
  }
  if (good.length) out.positions.HORSE = Object.assign({ material: '红单马 vs 单将（红多子但单马理论上不能将死单将）' }, good[0]);
  console.log('HORSE chosen:', good.length ? out.positions.HORSE.fen + ' ' + out.positions.HORSE.cycle.join(' ') : 'NONE');
}

/* ============ 3) CHASE 长捉形（红车长捉无根黑象） ============ */
function chaseBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 3)] = -1;  // 黑将 d9
  b[sq(4, 4)] = -3;  // 黑象 e5（无根）
  b[sq(5, 2)] = 5;   // 红车 c4（捉 c7 位）
  b[sq(9, 5)] = 1;   // 红帅 f0
  return b;
}
const CHASE_CYCLE = ['c4e4', 'e5c7', 'e4c4', 'c7e5'];
{
  const r = verifyCycle(chaseBoard(), 1, CHASE_CYCLE, 12, {
    checkedSide: null,
    afterMove: (b, side) => {
      if (side === 1) return {};
      let at = -1; for (let i = 0; i < 90; i++) if (b[i] === -3) at = i;
      if (at < 0) return { assertFail: 'chased piece gone' };
      if (XQ.inCheck(b, -1)) return { assertFail: 'position became a check, not a chase' };
      if (!XQ.isAttacked(b, at, 1)) return { assertFail: 'chased piece not attacked' };
      return { chasedAt: uci(at, at), attacked: true };
    },
  });
  out.positions.CHASE = {
    fen: r.startFen, fenCheck: fenRowsOk(r.startFen), cycle: CHASE_CYCLE,
    selfCheckOk: r.ok && r.closed, material: '红车 vs 黑单象（红大优）',
    log: r.log, fenAfter: { x1: r.fens[4], x2: r.fens[8], x3: r.fens[12] },
  };
  console.log('CHASE', r.startFen, 'rows', fenRowsOk(r.startFen), 'selfCheckOk=', r.ok && r.closed);
  for (const e of r.log) console.log('   ply', e.ply, 'side', e.side, e.play, e.legalCount, e.attacked === true ? 'CHASED-ATTACKED' : '', e.assertFail || '');
}

/* ============ 4) SEQ rule60：无吃子无兵长循环（引擎自己计数） ============ */
function seqBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 4)] = -1;  // 黑将 e9
  b[sq(4, 0)] = 5;   // 红车 a5
  b[sq(9, 3)] = 1;   // 红帅 d0
  return b;
}
const SEQ_CYCLE = ['a5b5', 'e9f9', 'b5a5', 'f9e9'];
{
  const r = verifyCycle(seqBoard(), 1, SEQ_CYCLE, 152, { checkedSide: null });
  out.positions.SEQ = { fen: r.startFen, cycle: SEQ_CYCLE, selfCheckOk: r.ok && r.closed, pliesVerified: r.log.length };
  console.log('SEQ  ', r.startFen, 'selfCheckOk=', r.ok && r.closed, 'pliesVerified=', r.log.length);
}

/* ============ 任务文件 ============ */
const P = out.positions;
const steps = [];
const cycleStr = (c, n) => Array(n).fill(c.join(' ')).join(' ').trim();

for (const [tag, pos] of [['CHK', P.CHK], ['HORSE', P.HORSE], ['CHZ', P.CHASE]]) {
  if (!pos || !pos.selfCheckOk) { console.log('SKIP', tag, '(self-check failed)'); continue; }
  for (const [tier, n] of [['R0', 0], ['R2', 2], ['R3', 3]]) {
    const mv = n ? ' moves ' + cycleStr(pos.cycle, n) : '';
    steps.push({ id: tag + '_' + tier, cmds: ['position fen ' + pos.fen + mv, 'go depth 14'], timeoutMs: 15000, gapMs: 300 });
  }
}
/* rule60 由着法串自然计数：长着法串由 engine.js 逐步生成并断言每步合法 */
if (P.SEQ && P.SEQ.selfCheckOk) {
  const full = verifyCycle(seqBoard(), 1, SEQ_CYCLE, 160, { checkedSide: null });
  const seqMoves = full.log.filter(e => e.legalMove).map(e => e.play);
  out.positions.SEQ.movesGenerated = seqMoves.length;
  for (const plies of [118, 119, 120, 121, 149, 150]) {
    if (seqMoves.length < plies) { console.log('SKIP SEQ', plies, 'generated only', seqMoves.length); continue; }
    const ms = seqMoves.slice(0, plies).join(' ');
    steps.push({ id: 'SEQR_' + plies, cmds: ['position fen ' + P.SEQ.fen + ' moves ' + ms, 'go depth 12'], timeoutMs: 10000, gapMs: 400 });
  }
}
/* rule60 字段直接边界 */
if (P.SEQ && P.SEQ.selfCheckOk) {
  for (const hm of [119, 120, 121, 149, 150, 199, 200, 299, 300, 499, 500, 998, 999]) {
    steps.push({ id: 'R60F_' + hm, cmds: ['position fen ' + P.SEQ.fen.replace(/ - - 0 1$/, ' - - ' + hm + ' 1'), 'go depth 10'], timeoutMs: 8000, gapMs: 300 });
  }
}

fs.writeFileSync(path.join(__dirname, 'rule5_positions.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule4.json'), JSON.stringify({ pre: ['setoption name Threads value 4', 'setoption name Hash value 64'], steps }, null, 1));
console.log('\nsteps(' + steps.length + '):', steps.map(s => s.id).join(' '));
console.log('written -> rule5_positions.json, task_rule4.json');
