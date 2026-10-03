/* bench/lowgrad_worker.js — 在固定题集上对比多个配置的质量得分（用于低区间梯度设计）
 * 用法: node lowgrad_worker.js <taskFile> <resultFile>
 * task: { testsFile, testsSlice:[from,to), configs:[{label, kind, movetime|depth..., book}], refMs }
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
  const allTests = JSON.parse(fs.readFileSync(task.testsFile, 'utf8')).tests;
  const tests = allTests.slice(task.testsSlice[0], task.testsSlice[1]);
  Math.random = mulberry32(313000 + task.testsSlice[0]);
  const XQBook = loadBook();
  const pf = await require('./pf.js').createEngine();
  const refMs = task.refMs || 3000;
  const scoreOf = (g) => pf.search(boardToFen(g.board, g.side), refMs).then(r => (typeof r === 'object' && typeof r.score === 'number') ? r.score : null);

  const refScore = {};
  for (const t of tests) { const g = replay(t.startMoves); if (g) refScore[t.id] = await scoreOf(g); }

  const out = [];
  for (const cfg of task.configs) {
    const ans = [];
    for (const t of tests) {
      const g = replay(t.startMoves);
      if (!g) continue;
      const side = g.side, legal = g.legalMoves();
      let mv = null, via = 'none';
      if (cfg.book) {
        const bm = XQBook.pick(g.board, side, legal);
        if (bm && legal.some(m => m.f === bm.f && m.t === bm.t)) { mv = bm; via = 'book'; }
      }
      if (!mv && cfg.kind === 'builtin') {
        const ok = g.aiMove(cfg.depth, cfg.qDepth, cfg.maxNodes, cfg.randomness);
        if (!ok) { ans.push({ loss: 99999, score: 0 }); continue; }
        via = 'builtin';
      } else if (!mv) {
        const r = await pf.search(boardToFen(g.board, side), cfg.movetime, cfg.uciOptions ? { options: cfg.uciOptions } : undefined);
        const pm = parseMove(typeof r === 'string' ? r : r.move);
        if (!pm || !legal.some(m => m.f === pm.f && m.t === pm.t)) { ans.push({ loss: 99999, score: 0 }); continue; }
        mv = pm; via = 'pf';
        if (!g.move(mv)) { ans.push({ loss: 99999, score: 0 }); continue; }
      }
      const after = await scoreOf(g);
      const loss = (after === null || refScore[t.id] === null) ? 99999 : refScore[t.id] - (-after);
      ans.push({ loss, score: gradeLoss(loss), via });
    }
    const n = ans.length;
    const losses = ans.map(a => a.loss).filter(x => x < 90000);
    out.push({
      label: cfg.label, n,
      score: ans.reduce((s, a) => s + a.score, 0) / n,
      avgLoss: losses.reduce((s, x) => s + x, 0) / (losses.length || 1),
      bigMistakes: ans.filter(a => a.loss > 200).length,
      viaBook: ans.filter(a => a.via === 'book').length,
    });
    console.log('CFG ' + cfg.label + ' score=' + (out[out.length - 1].score * 100).toFixed(1) + '% avgLoss=' + out[out.length - 1].avgLoss.toFixed(0) + ' big=' + out[out.length - 1].bigMistakes);
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1); });