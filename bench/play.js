/* bench/play.js — 执行一局基准对局
 * 用法: node play.js <taskFile> <resultFile>
 * task: {gameId, startMoves, newPlaysFirst, neu:{kind,...,book}, old:{...}, seed}
 * 结果: resultFile = JSON {gameId, winner:'new'|'old'|'draw', reason, plies, elapsedMs, moves, valid}
 * 规则: 与 index.html checkEnd 完全一致(三次重复严格判罚/将死/困毙) + 250步兜底判和
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'engine.js'));

// ---- 可复现随机: mulberry32 种子化 Math.random (内置引擎 randomness + 开局库权重都走它) ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 开局库 (book.js + xqbook.js 拼进共享作用域) ----
function loadBook() {
  const bookSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'book.js'), 'utf8');
  let xqSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'xqbook.js'), 'utf8');
  // book.js 顶部有 "use strict", 使整个 new Function body 严格化 -> 顶层 this=undefined,
  // xqbook IIFE 的 root 兜底分支必须改为显式 globalThis
  xqSrc = xqSrc.replace("typeof window !== 'undefined' ? window : this", 'globalThis');
  return new Function(bookSrc + '\n;globalThis.BOOK_DAT = BOOK_DAT;\n' + xqSrc + '\n;return globalThis.XQBook;')();
}

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
function parseMove(s) {
  const m = /^\s*([a-i])([0-9])-?([a-i])([0-9])\s*$/.exec(s);
  if (!m) return null;
  return { f: (9 - (+m[2])) * 9 + (m[1].charCodeAt(0) - 97), t: (9 - (+m[4])) * 9 + (m[3].charCodeAt(0) - 97) };
}

// ---- 判罚: 逐行复刻 index.html checkEnd (winner: 1红胜 -1黑胜 0和) ----
function checkEnd(game, seenPos) {
  const s = game.board.join('') + '#' + game.side;
  seenPos[s] = (seenPos[s] || 0) + 1;
  if (seenPos[s] >= 3) {
    const last4 = game.history.slice(-4);
    const allCheck = (arr) => arr.length > 0 && arr.every(h => h.gaveCheck);
    const redAll = allCheck(last4.filter(h => h.side === 1));
    const blkAll = allCheck(last4.filter(h => h.side === -1));
    if (redAll && blkAll) return { winner: 0, reason: '双方循环将军判和' };
    if (redAll) return { winner: -1, reason: '红方长将红方负' };
    if (blkAll) return { winner: 1, reason: '黑方长将黑方负' };
    return { winner: 0, reason: '三次重复判和' };
  }
  const lm = game.legalMoves().length;
  if (lm === 0) {
    if (game.inCheck()) return { winner: -game.side, reason: '将死' };
    return { winner: 0, reason: '困毙判和' };
  }
  return null;
}

async function main() {
  const task = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const outPath = process.argv[3] || process.argv[2] + '.out';
  const t0 = Date.now();
  Math.random = mulberry32(task.seed);           // 双方共用同一种子流, 可复现

  const XQBook = task.neu.book || task.old.book ? loadBook() : null;
  const needPf = (c) => c.kind === 'pf';
  let pf = null;
  if (needPf(task.neu) || needPf(task.old)) pf = await require('./pf.js').createEngine();

  // 复原固定局面 (replay), 与网页 rebuildSeen 一致: 历史局面各计1次
  const game = new XQ.Game('none', -1);
  for (const mv of (task.startMoves || [])) {
    if (!game.move(mv)) throw new Error('fixture replay illegal at ' + JSON.stringify(mv));
  }
  const seenPos = {};
  for (const h of game.history) {
    const s = h.board.join('') + '#' + h.side;
    seenPos[s] = (seenPos[s] || 0) + 1;
  }
  const firstSide = game.side;
  const cfgFor = (side) => (((side === firstSide) === task.newPlaysFirst) ? task.neu : task.old);

  const moves = [];
  const pfStats = { neu: [], old: [] };
  let result = null;
  const MAX_PLIES = 250;

  while (!result) {
    if (game.history.length - (task.startMoves ? task.startMoves.length : 0) >= MAX_PLIES) {
      result = { winner: 0, reason: '250步上限判和' };
      break;
    }
    const which = cfgFor(game.side) === task.neu ? 'neu' : 'old';
    const cfg = cfgFor(game.side);
    const legal = game.legalMoves();
    let mv = null;

    if (cfg.book && XQBook) {
      const bm = XQBook.pick(game.board, game.side, legal);
      if (bm && legal.some(m => m.f === bm.f && m.t === bm.t)) mv = bm;
    }
    if (!mv) {
      if (cfg.kind === 'builtin') {
        const t = game.aiMove(cfg.depth, cfg.qDepth, cfg.maxNodes, cfg.randomness);
        if (!t) { result = { winner: 0, reason: '内置引擎无解(异常)' }; break; }
        moves.push(game.history[game.history.length - 1].notation);
        result = checkEnd(game, seenPos);
        continue;
      }
      // pikafish
      const fen = boardToFen(game.board, game.side);
      const r = await pf.search(fen, cfg.movetime);
      const raw = typeof r === 'string' ? r : r.move;
      if (typeof r === 'object' && r.depth) pfStats[which].push(r.depth);
      const pm = parseMove(raw);
      if (!pm || !legal.some(m => m.f === pm.f && m.t === pm.t)) {
        result = { winner: 0, reason: 'INVALID', invalid: true, rawMove: String(raw) };
        break;
      }
      mv = pm;
    }
    const res = game.move(mv);
    if (!res) { result = { winner: 0, reason: 'INVALID', invalid: true }; break; }
    moves.push(res.notation);
    result = checkEnd(game, seenPos);
  }

  const winnerSide = result.winner; // 1红 -1黑 0和
  const winner = winnerSide === 0 ? 'draw'
    : ((winnerSide === firstSide) === task.newPlaysFirst ? 'new' : 'old');
  const out = {
    gameId: task.gameId, level: task.level, posId: task.posId,
    winner: result.invalid ? 'invalid' : winner,
    reason: result.reason, winnerSide,
    plies: game.history.length,
    newPlaysFirst: task.newPlaysFirst,
    elapsedMs: Date.now() - t0,
    moves,
    pfDepths: pfStats,
    invalid: !!result.invalid,
  };
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log('DONE ' + task.gameId + ' winner=' + out.winner + ' reason=' + out.reason + ' plies=' + out.plies + ' ' + (out.elapsedMs / 1000).toFixed(0) + 's');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL ' + process.argv[2] + ' ' + (e && e.stack || e));
  try {
    let gid = process.argv[2];
    try { gid = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).gameId || gid; } catch (_) {}
    fs.writeFileSync(process.argv[3] || (process.argv[2] + '.out'),
      JSON.stringify({ gameId: gid, winner: 'error', reason: String(e && e.message || e), invalid: true }));
  } catch (_) {}
  process.exit(1);
});