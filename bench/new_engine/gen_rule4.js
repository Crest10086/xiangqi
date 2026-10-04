/* gen_rule4.js — 判例判定探针：造出「engine.js 自检通过」的长将形与长捉形 + rule60 边界
 *
 * CHK  长将形：红车在 e5/f5 交替将军黑将（黑将在 e9/f9 被迫往返），
 *      红兵 d8 封住 d9/e8（红兵同时是黑将不能落 d9 的原因）。
 *      断言：黑方每一步 inCheck()==true 且 legalMoves().length==1（应将被迫），
 *            红方每一手都 gaveCheck，4 步循环回到同一局面。
 * CHASE 长捉形：红车 e4/c4 交替捉黑象（象 e5/c7 往返），断言每步合法、
 *      红车落点后黑象确实被攻击（捉成立）、4 步循环回到同一局面。
 * R60  rule60 边界：用 CHASE 局面（无子可吃、无杀）改 halfmove 计数。
 *
 * 输出：rule4_positions.json + task_rule4.json
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
  const board = fen.split(' ')[0].split('/');
  if (board.length !== 10) return 'rows=' + board.length;
  for (let r = 0; r < 10; r++) {
    let n = 0;
    for (const ch of board[r]) n += /\d/.test(ch) ? +ch : 1;
    if (n !== 9) return 'row' + r + ' has ' + n + ' cells';
  }
  return 'ok';
}
const L = (i) => String.fromCharCode(97 + (i % 9));
const N = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + N(f) + L(t) + N(t);
const sq = (row, col) => row * 9 + col;
const NAME = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };

/* ---------- generic cycle verifier using the project's own engine.js ---------- */
function verifyCycle(board, side, cycle, plies, opts) {
  const g = XQ.Game.fromBoard(board.slice());
  g.side = side;
  const startKey = g.board.join(',');
  const log = [], fens = [];
  let ok = true;
  for (let p = 0; p < plies; p++) {
    const legal = g.legalMoves();
    const want = cycle[p % cycle.length];
    const mv = legal.find(m => uci(m.f, m.t) === want);
    const chk = g.inCheck();
    const entry = {
      ply: p, side: g.side, inCheck: chk, play: want, legalMove: !!mv,
      legalCount: legal.length,
      legal: legal.map(m => uci(m.f, m.t) + ':' + NAME[Math.abs(g.board[m.f])]),
      fen: boardToFen(g.board, g.side),
    };
    if (opts.checkedSide && g.side === opts.checkedSide) {
      if (!chk) { entry.assertFail = 'side to move is NOT in check'; ok = false; }
      if (legal.length < 1) { entry.assertFail = 'no legal reply (mate/stalemate)'; ok = false; }
      if (opts.requireUnique && legal.length !== 1) { entry.assertFail = 'reply not forced: ' + legal.length + ' legal'; ok = false; }
    }
    if (!mv) { entry.assertFail = 'cycle move illegal'; ok = false; }
    log.push(entry);
    fens.push(entry.fen);
    if (!mv) break;
    g.move(mv);
    if (opts.givesCheck && g.side === -opts.moverSide) {
      if (!g.inCheck()) { entry.checkAfter = false; if (opts.requireCheck) { entry.assertFail = 'mover did not give check'; ok = false; } }
      else entry.checkAfter = true;
    }
    if (opts.attackedPiece) {
      const info = opts.attackedPiece(g.board);
      entry.attacked = info.attacked;
      entry.attackedPiece = info.at;
      if (opts.requireAttacked && g.side === -opts.moverSide && !info.attacked) {
        entry.assertFail = 'chased piece not attacked'; ok = false;
      }
    }
  }
  const closed = ok && g.board.join(',') === startKey && g.side === side;
  return { ok, closed, log, fens, startFen: boardToFen(board, side) };
}

/* ================= CHK: 长将形 ================= */
function chkBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 4)] = -1;  // 黑将 e9
  b[sq(1, 3)] = 7;   // 红兵 d8  (守 d9 / e8 / c8)
  b[sq(4, 5)] = 5;   // 红车 f5
  b[sq(9, 3)] = 1;   // 红帅 d0  (不在 d/e 以外的黑将落点上，且被 d8 兵挡住 d 线飞将)
  return b;
}
const CHK_CYCLE = ['f5e5', 'e9f9', 'e5f5', 'f9e9'];

/* ================= CHASE: 长捉形（红车长捉黑象） ================= */
function chaseBoard() {
  const b = new Array(90).fill(0);
  b[sq(0, 4)] = -1;  // 黑将 e9
  b[sq(4, 4)] = -3;  // 黑象 e5
  b[sq(5, 4)] = 5;   // 红车 e4
  b[sq(9, 3)] = 1;   // 红帅 d0
  b[sq(1, 3)] = -2;  // 黑士 d8 (给黑方一点防守，避免红车立刻杀)
  return b;
}
const CHASE_CYCLE = ['e4c4', 'e5c7', 'c4e4', 'c7e5'];

const out = { generated: new Date().toISOString(), positions: {} };

/* ---- CHK ---- */
{
  const r = verifyCycle(chkBoard(), 1, CHK_CYCLE, 12, {
    checkedSide: -1, requireUnique: true, givesCheck: true, moverSide: 1, requireCheck: true,
  });
  out.positions.CHK = {
    fen: r.startFen, fenLenCheck: fenRowsOk(r.startFen), cycle: CHK_CYCLE,
    selfCheckOk: r.ok && r.closed, log: r.log,
    fenAfterCycle: { x1: r.fens[4], x2: r.fens[8], x3: r.fens[12] },
  };
  console.log('===== CHK', r.startFen, 'rows', fenRowsOk(r.startFen), 'selfCheckOk=', r.ok && r.closed, '=====');
  for (const e of r.log) console.log('ply', e.ply, 'side', e.side, 'inCheck', e.inCheck, e.play, e.legalMove ? 'OK' : 'ILLEGAL', 'legal(' + e.legalCount + '):', e.legal.join(' '), e.checkAfter === true ? 'GAVECHECK' : '', e.assertFail || '');
}

/* ---- CHASE ---- */
{
  const r = verifyCycle(chaseBoard(), 1, CHASE_CYCLE, 12, {
    checkedSide: null, givesCheck: false, moverSide: 1,
    attackedPiece: (b) => {
      // 黑象所在格
      let at = -1;
      for (let i = 0; i < 90; i++) if (b[i] === -3) at = i;
      return { at, attacked: at >= 0 && XQ.isAttacked(b, at, 1) };
    },
    requireAttacked: true,
  });
  out.positions.CHASE = {
    fen: r.startFen, fenLenCheck: fenRowsOk(r.startFen), cycle: CHASE_CYCLE,
    selfCheckOk: r.ok && r.closed, log: r.log,
    fenAfterCycle: { x1: r.fens[4], x2: r.fens[8], x3: r.fens[12] },
  };
  console.log('===== CHASE', r.startFen, 'rows', fenRowsOk(r.startFen), 'selfCheckOk=', r.ok && r.closed, '=====');
  for (const e of r.log) console.log('ply', e.ply, 'side', e.side, e.play, e.legalMove ? 'OK' : 'ILLEGAL', 'legal(' + e.legalCount + ')', 'chasedAttacked=' + e.attacked, e.assertFail || '');
}

/* ================= task_rule4.json ================= */
const CHK_FEN = out.positions.CHK.fen;
const CHASE_FEN = out.positions.CHASE.fen;
const okChk = out.positions.CHK.selfCheckOk;
const okChase = out.positions.CHASE.selfCheckOk;
const steps = [];
const cycleStr = (c, n) => Array(n).fill(c.join(' ')).join(' ').trim();

if (okChk) {
  for (const [tag, n] of [['R0', 0], ['R2', 2], ['R3', 3]]) {
    const mv = n ? ' moves ' + cycleStr(CHK_CYCLE, n) : '';
    steps.push({ id: 'CHK_' + tag, cmds: ['position fen ' + CHK_FEN + mv, 'go depth 14'], timeoutMs: 15000, gapMs: 250 });
  }
}
if (okChase) {
  for (const [tag, n] of [['R0', 0], ['R2', 2], ['R3', 3]]) {
    const mv = n ? ' moves ' + cycleStr(CHASE_CYCLE, n) : '';
    steps.push({ id: 'CHZ_' + tag, cmds: ['position fen ' + CHASE_FEN + mv, 'go depth 14'], timeoutMs: 15000, gapMs: 250 });
  }
  for (const hm of [119, 120, 121, 149, 150, 200, 300, 999]) {
    steps.push({ id: 'R60_' + hm, cmds: ['position fen ' + CHASE_FEN.replace(/ - - 0 1$/, ' - - ' + hm + ' 1'), 'go depth 12'], timeoutMs: 8000, gapMs: 250 });
  }
}

const task = {
  pre: ['setoption name Threads value 4', 'setoption name Hash value 64'],
  steps,
};
fs.writeFileSync(path.join(__dirname, 'rule4_positions.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'task_rule4.json'), JSON.stringify(task, null, 1));
console.log('\nCHK selfCheckOk=', okChk, ' CHASE selfCheckOk=', okChase);
console.log('CHK   fen:', CHK_FEN);
console.log('CHASE fen:', CHASE_FEN);
console.log('steps:', steps.map(s => s.id).join(' '));
console.log('written -> rule4_positions.json, task_rule4.json');
