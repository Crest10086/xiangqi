/* bench/tactics_worker.js — 一档的新/旧配置在同一测验集上各答一遍
 * 用法: node tactics_worker.js <taskFile> <resultFile>
 * task: {level, levelName, neu, old, testsFile}
 * hit 判定: 被测落子后的局面 == 参考最佳着法落子后的局面 (等价着法视为命中)
 * 评分: hit=1.0; 否则按走方物质增益: >=-20→0.8, >=-150→0.5, >=-450→0.2, 否则0
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'engine.js'));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function loadBook() {
  const bookSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'book.js'), 'utf8');
  let xqSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'xqbook.js'), 'utf8');
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
const VAL = { 1: 0, 2: 200, 3: 200, 4: 450, 5: 900, 6: 450, 7: 100 };
function materialRed(board) {
  let s = 0;
  for (const v of board) { if (v > 0) s += VAL[v]; else if (v < 0) s -= VAL[-v]; }
  return s;
}
function replay(startMoves) {
  const g = new XQ.Game('none', -1);
  for (const mv of startMoves) { if (!g.move(mv)) throw new Error('replay illegal'); }
  return g;
}
function refBoardKey(test) {
  const g = replay(test.startMoves);
  if (!g.move(test.bestMove)) throw new Error('reference move illegal ' + test.id);
  return g.board.join(',');
}

async function answer(cfg, test, refKey, deps) {
  const g = replay(test.startMoves);
  const side = g.side;
  const legal = g.legalMoves();
  let mv = null, via = 'none', beforeBoard = null;

  if (cfg.book && deps.XQBook) {
    const bm = deps.XQBook.pick(g.board, side, legal);
    if (bm && legal.some(m => m.f === bm.f && m.t === bm.t)) { mv = bm; via = 'book'; }
  }
  if (!mv && cfg.kind === 'builtin') {
    const hLen = g.history.length;
    const t = g.aiMove(cfg.depth, cfg.qDepth, cfg.maxNodes, cfg.randomness);
    if (!t) return null;
    // history[i].board 是走子后的局面; 走子前局面 = 上一项 (测验局面 startMoves>=10, hLen>=1)
    beforeBoard = g.history[hLen - 1].board;
    via = 'builtin';
  } else if (!mv) {
    beforeBoard = g.board.slice();
    const r = await deps.pf.search(boardToFen(g.board, side), cfg.movetime);
    const pm = parseMove(typeof r === 'string' ? r : r.move);
    if (!pm || !legal.some(m => m.f === pm.f && m.t === pm.t)) return null;
    mv = pm; via = 'pf';
  }
  if (via === 'book') { beforeBoard = g.board.slice(); }
  if (via !== 'builtin' && !g.move(mv)) return null;

  const hit = g.board.join(',') === refKey;
  const gain = (materialRed(g.board) - materialRed(beforeBoard)) * (side === 1 ? 1 : -1);
  let score;
  if (hit) score = 1.0;
  else if (gain >= -20) score = 0.8;
  else if (gain >= -150) score = 0.5;
  else if (gain >= -450) score = 0.2;
  else score = 0;
  return { testId: test.id, hit, gain, score, via };
}

async function main() {
  const task = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const outPath = process.argv[3];
  const tests = JSON.parse(fs.readFileSync(task.testsFile, 'utf8')).tests;
  Math.random = mulberry32(987654321 + task.level * 7919); // 固定种子: 内置随机+库随机可复现
  const XQBook = (task.neu.book || task.old.book) ? loadBook() : null;
  let pf = null;
  if (task.neu.kind === 'pf' || task.old.kind === 'pf') pf = await require('./pf.js').createEngine();
  const deps = { XQBook, pf };
  const refKeys = {};
  for (const t of tests) refKeys[t.id] = refBoardKey(t);

  async function runCfg(cfg) {
    const answers = [];
    for (const t of tests) {
      const a = await answer(cfg, t, refKeys[t.id], deps);
      if (!a) { answers.push({ testId: t.id, hit: false, gain: 0, score: 0, via: 'fail' }); continue; }
      answers.push(a);
    }
    const n = answers.length;
    const tactical = new Set(tests.filter(t => t.isTactical).map(t => t.id));
    const sum = answers.reduce((s, a) => s + a.score, 0);
    const hits = answers.filter(a => a.hit).length;
    const tAns = answers.filter(a => tactical.has(a.testId));
    const tHits = tAns.filter(a => a.hit).length;
    return {
      n, score: sum / n, hitRate: hits / n,
      tacticalN: tAns.length, tacticalHitRate: tAns.length ? tHits / tAns.length : null,
      avgGain: answers.reduce((s, a) => s + a.gain, 0) / n,
      viaBook: answers.filter(a => a.via === 'book').length,
      answers,
    };
  }
  const neu = await runCfg(task.neu);
  const old = await runCfg(task.old);
  fs.writeFileSync(outPath, JSON.stringify({ level: task.level, levelName: task.levelName, neu, old }));
  console.log('TACTICS L' + task.level + ' ' + task.levelName +
    ' | new score=' + (neu.score * 100).toFixed(1) + '% hit=' + (neu.hitRate * 100).toFixed(1) + '% tacticalHit=' + (neu.tacticalHitRate === null ? '-' : (neu.tacticalHitRate * 100).toFixed(1)) + '%' +
    ' | old score=' + (old.score * 100).toFixed(1) + '% hit=' + (old.hitRate * 100).toFixed(1) + '% tacticalHit=' + (old.tacticalHitRate === null ? '-' : (old.tacticalHitRate * 100).toFixed(1)) + '%');
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1); });