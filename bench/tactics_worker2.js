/* bench/tactics_worker2.js — 质量评估版测验 worker
 * 用法: node tactics_worker2.js <taskFile> <resultFile>
 * 评分: 参考引擎(3000ms)评估当前局面得 score_ref; 被测着法走完后再评估得 score_after(对方视角);
 *       loss = score_ref - (-score_after); 按损失分级打分。测的是着法质量, 不要求与特定着法相同。
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
function replay(startMoves) {
  const g = new XQ.Game('none', -1);
  for (const mv of startMoves) { if (!g.move(mv)) return null; }
  return g;
}
const REF_MS = 3000;
function scoreOf(eng, g, refMs) { // 当前走方视角的评估(cp)
  return eng.search(boardToFen(g.board, g.side), refMs || REF_MS).then(r => (typeof r === 'object' && typeof r.score === 'number') ? r.score : null);
}
function gradeLoss(loss) {
  if (loss <= 10) return 1.0;
  if (loss <= 50) return 0.9;
  if (loss <= 100) return 0.7;
  if (loss <= 200) return 0.4;
  if (loss <= 400) return 0.15;
  return 0;
}

async function main() {
  const task = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const outPath = process.argv[3];
  const tests = JSON.parse(fs.readFileSync(task.testsFile, 'utf8')).tests;
  Math.random = mulberry32(555000 + task.level * 104729);
  const XQBook = (task.neu.book || task.old.book) ? loadBook() : null;
  const pf = await require('./pf.js').createEngine(); // 参考引擎与搜索引擎同一个实例(不同 movetime)
  const refMs = task.refMs || REF_MS;
  const deps = { XQBook, pf };

  // 预计算参考评估(两配置共用, 保证同标准)
  const refScore = {};
  for (const t of tests) {
    const g = replay(t.startMoves);
    if (!g) continue;
    refScore[t.id] = await scoreOf(pf, g, refMs);
  }

  async function runCfg(cfg) {
    const answers = [];
    for (const t of tests) {
      const g = replay(t.startMoves);
      if (!g) continue;
      const side = g.side;
      const legal = g.legalMoves();
      let mv = null, via = 'none';
      if (cfg.book && XQBook) {
        const bm = XQBook.pick(g.board, side, legal);
        if (bm && legal.some(m => m.f === bm.f && m.t === bm.t)) { mv = bm; via = 'book'; }
      }
      if (!mv && cfg.kind === 'builtin') {
        const hLen = g.history.length;
        const t2 = g.aiMove(cfg.depth, cfg.qDepth, cfg.maxNodes, cfg.randomness);
        if (!t2) { answers.push({ testId: t.id, loss: 99999, score: 0, via: 'fail' }); continue; }
        const prevBoard = g.history[hLen - 1].board;
        void prevBoard;
        via = 'builtin';
      } else if (!mv) {
        const r = await pf.search(boardToFen(g.board, side), cfg.movetime, cfg.uciOptions ? { options: cfg.uciOptions } : undefined);
        const pm = parseMove(typeof r === 'string' ? r : r.move);
        if (!pm || !legal.some(m => m.f === pm.f && m.t === pm.t)) { answers.push({ testId: t.id, loss: 99999, score: 0, via: 'fail' }); continue; }
        mv = pm; via = 'pf';
      }
      if (via !== 'builtin' && !g.move(mv)) { answers.push({ testId: t.id, loss: 99999, score: 0, via: 'fail' }); continue; }
      const after = await scoreOf(pf, g, refMs); // 对方视角
      const evalPlayed = (after === null || refScore[t.id] === null) ? null : -after;
      const loss = evalPlayed === null ? 99999 : refScore[t.id] - evalPlayed;
      answers.push({ testId: t.id, loss, score: gradeLoss(loss), via });
    }
    const n = answers.length;
    const sum = answers.reduce((s, a) => s + a.score, 0);
    const losses = answers.map(a => a.loss).filter(x => typeof x === 'number' && x < 90000);
    return {
      n, score: sum / n,
      avgLoss: losses.reduce((s, x) => s + x, 0) / (losses.length || 1),
      bigMistakes: answers.filter(a => a.loss > 200).length,
      answers,
    };
  }
  const neu = await runCfg(task.neu);
  const old = await runCfg(task.old);
  fs.writeFileSync(outPath, JSON.stringify({ level: task.level, levelName: task.levelName, neu, old }));
  console.log('QUALITY L' + task.level + ' ' + task.levelName +
    ' | new score=' + (neu.score * 100).toFixed(1) + '% avgLoss=' + neu.avgLoss.toFixed(0) + ' big=' + neu.bigMistakes +
    ' | old score=' + (old.score * 100).toFixed(1) + '% avgLoss=' + old.avgLoss.toFixed(0) + ' big=' + old.bigMistakes);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1); });