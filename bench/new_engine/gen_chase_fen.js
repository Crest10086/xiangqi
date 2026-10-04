/* gen_chase_fen.js — 构造"长将/长捉"局面：用新引擎的 FEN→合法着法辅助(纯 JS 走子生成用 engine.js)
 * 思路: 造一个单车对单士象+将的残局，红车反复将军(长将)；用 engine.js 验证着法合法并 replay 出 FEN。
 * 输出: bench/new_engine/chase_fen.json  {perpetual_check_fen, perpetual_chase_fen, replay:[uci moves]}
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

function boardToFen(board, side) {
  const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
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
  return out + ' ' + (side === 1 ? 'w' : 'b') + ' - - 0 1';
}
function idx(letter, digit) { return (9 - digit) * 9 + (letter.charCodeAt(0) - 97); }
function uci(m) {
  const col = (i) => String.fromCharCode(97 + (i % 9));
  const row = (i) => String(9 - Math.floor(i / 9));
  return col(m.f) + row(m.f) + col(m.t) + row(m.t);
}

// 局面 A: 红车在 e 线反复将军黑将在 e0（黑有士在 d0 挡，红帅在 e9 助攻）→ 黑将来回走 = 长将
// 手工摆盘（row0=黑底线, row9=红底线）
function buildCheckBoard() {
  const b = new Array(90).fill(0);
  b[0 * 9 + 4] = -1;  // 黑将 e0
  b[0 * 9 + 3] = -2;  // 黑士 d0
  b[1 * 9 + 4] = -4;  // 黑马 e1 (被车牵制)
  b[9 * 9 + 4] = 1;   // 红帅 e9
  b[4 * 9 + 4] = 5;   // 红车 e4 -> 沿 e 线将军
  return b;
}
// 局面 B: 红车反复捉黑马（黑马无根、每次被捉就得逃）→ 长捉
function buildChaseBoard() {
  const b = new Array(90).fill(0);
  b[0 * 9 + 4] = -1;  // 黑将 e0
  b[2 * 9 + 2] = -4;  // 黑马 c2 (无根)
  b[9 * 9 + 4] = 1;   // 红帅 e9
  b[3 * 9 + 2] = 5;   // 红车 c3 -> 捉 c2 马
  b[9 * 9 + 0] = 5;   // 红车 a9 备用（避免红方只有单车导致规则判定歧义）
  return b;
}

function replayFrom(board, side, movesUci) {
  let g = XQ.Game.fromBoard(board);
  g.side = side;
  const log = [];
  for (const u of movesUci) {
    const m = /^([a-i])([0-9])([a-i])([0-9])$/.exec(u);
    if (!m) { log.push('BAD ' + u); break; }
    const mv = { f: idx(m[1], m[2]), t: idx(m[3], m[4]) };
    const legal = g.legalMoves().some(x => x.f === mv.f && x.t === mv.t);
    if (!legal) { log.push('ILLEGAL ' + u + ' side=' + g.side); break; }
    log.push(uci(mv) + (g.inCheck() ? ' (in check)' : ''));
    g.move(mv);
  }
  return { g, log };
}

const out = {};
for (const [key, board, side, moves] of [
  ['candidate_check', buildCheckBoard(), 1, ['e4e0', 'd0e0', 'e0e1', 'e1d0']],
  ['candidate_check2', buildCheckBoard(), 1, ['e4e1', 'e1d1', 'e1e0', 'e0d0']],
  ['candidate_chase', buildChaseBoard(), 1, ['c3c2', 'c2c1', 'c3c1', 'c1c2']],
  ['candidate_chase2', buildChaseBoard(), 1, ['c3c2', 'c2b2', 'c3b3', 'b2c2']],
]) {
  const { g, log } = replayFrom(board, side, moves);
  out[key] = { fenStart: boardToFen(board, side), fenAfterReplay: boardToFen(g.board, g.side), sideAfter: g.side, log };
  console.log('=== ' + key + ' ===');
  console.log('start: ' + out[key].fenStart);
  console.log(log.join('\n'));
  console.log('after: ' + out[key].fenAfterReplay);
}
fs.writeFileSync(path.join(__dirname, 'chase_fen.json'), JSON.stringify(out, null, 1));
