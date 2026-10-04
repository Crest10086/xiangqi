/* chase_probe.js — 构造"长将"局面并验证循环：红车在 e 线（被"将帅对面"钉住不能离线），
 * 黑将被迫来回避将。用本项目 engine.js 校验每一手合法 + 每步的合法着法全集，
 * 并在 BFS 里找一条 4 手循环（红方每手都是将军，黑方只有王可走）。
 * 输出: bench/new_engine/chase_positions.json
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

const MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
function boardToFen(board, side) {
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
const L = (i) => String.fromCharCode(97 + (i % 9));
const N = (i) => String(9 - Math.floor(i / 9));
const uci = (f, t) => L(f) + N(f) + L(t) + N(t);
const key = (b, s) => b.join(',') + '#' + s;

// 局面 CHK1: 红车 e5 位于红帅 e0 与黑将 e9 之间 -> 车不能离开 e 线(否则将帅对面)
// 黑方只有将 + 两个被堵死的卒(不能垫将) -> 黑将只能离开 e 线避将
function buildCHK1() {
  const b = new Array(90).fill(0);
  b[0 * 9 + 4] = -1;  // 黑将 e9
  b[4 * 9 + 4] = 5;   // 红车 e5
  b[9 * 9 + 4] = 1;   // 红帅 e0
  b[9 * 9 + 3] = 7;   // 红仕 d0 -> 用仕限制红帅(仕本身可动, 见日志)
  b[9 * 9 + 5] = 2;   // 红仕 f0
  return b;
}

// 局面 CHK2: 红车 e5 钉在 e 线；黑方只有将；红方其余子全部冻结(仕被自身堵死)
// 黑将 e9 <-> d9，红车 e5 <-> d5，每一步都是将军
function buildCHK2() {
  const b = new Array(90).fill(0);
  b[0 * 9 + 4] = -1;  // 黑将 e9
  b[4 * 9 + 4] = 5;   // 红车 e5 (在红帅与黑将之间 -> 不能离线)
  b[9 * 9 + 4] = 1;   // 红帅 e0
  return b;
}

function stateKey(g) { return key(g.board, g.side); }

// BFS: 找 4 手循环 (红将军 -> 黑王避将 -> 红将军 -> 黑王避将 -> 回到起始局面)
function findCycle(board, side, maxDepth) {
  const start = new XQ.Game.fromBoard(board.slice());
  start.side = side;
  const startKey = stateKey(start);
  const frontier = [{ g: start, path: [] }];
  const seen = new Map([[startKey, 0]]);
  while (frontier.length) {
    const cur = frontier.shift();
    if (cur.path.length >= maxDepth) continue;
    const legal = cur.g.legalMoves();
    const sideToMove = cur.g.side;
    // 红方: 只考虑"走完将军"的着法; 黑方: 只考虑王的着法
    const cand = legal.filter(m => {
      if (sideToMove === 1) {
        const nb = cur.g.board.slice(); nb[m.t] = nb[m.f]; nb[m.f] = 0;
        return XQ.inCheck(nb, -1);
      }
      return Math.abs(cur.g.board[m.f]) === 1;
    });
    for (const m of cand) {
      const g2 = new XQ.Game.fromBoard(cur.g.board.slice());
      g2.side = cur.g.side;
      g2.move(m);
      const k = stateKey(g2);
      const p = cur.path.concat([{ f: m.f, t: m.t, side: sideToMove, inCheckBefore: cur.g.inCheck() }]);
      if (k === startKey && p.length % 4 === 0) {
        return { cycle: p, startFen: boardToFen(board, side) };
      }
      if (!seen.has(k)) { seen.set(k, p.length); frontier.push({ g: g2, path: p }); }
    }
  }
  return null;
}

const out = {};
for (const [id, board, side] of [['CHK2', buildCHK2(), -1]]) {
  const g = new XQ.Game.fromBoard(board.slice());
  g.side = side;
  const info = {
    fen: boardToFen(board, side),
    sideToMove: side,
    inCheck: g.inCheck(),
    legalForSide: g.legalMoves().map(m => uci(m.f, m.t) + ':' + Math.abs(board[m.f])),
  };
  const found = findCycle(board, side, 8);
  info.cycle = found ? found.cycle.map(m => uci(m.f, m.t) + (m.side === 1 ? '(red-check)' : '(black-king)')) : null;
  out[id] = info;
  console.log('===', id, '===');
  console.log('FEN:', info.fen, 'side', side, 'inCheck', info.inCheck);
  console.log('side-to-move legal:', info.legalForSide.join(' '));
  console.log('cycle found:', info.cycle ? info.cycle.join(' ') : 'NONE');
}
fs.writeFileSync(path.join(__dirname, 'chase_positions.json'), JSON.stringify(out, null, 1));
