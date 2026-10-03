/* bench/opening.js — 开局质量测量（大师 vs 高手的唯一实质差异: 独占开局库）
 * 从初始局面起，被测方连走 N 步；对手固定用参考引擎(3000ms)最佳应着，保证只测被测方。
 * 每步损失 = 走子前参考评估 - 走子后参考评估（正数=走差了）。
 * 输出: bench/opening_report.md + .json
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'engine.js'));
const pfMod = require('./pf.js');

const REF_MS = 3000;
const PLIES = 12; // 被测方走 12 手（约开局前 6 回合）
const CONFIGS = [
  { label: '大师(开局库+6000ms)', movetime: 6000, book: true },
  { label: '高手(无库 500ms)', movetime: 500, book: false },
  { label: '基线大师(无库 2500ms)', movetime: 2500, book: false },
];

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
  const m = /^\s*([a-i])([0-9])-?([a-i])([0-9])\s*$/.exec(String(s || ''));
  if (!m) return null;
  return { f: (9 - (+m[2])) * 9 + (m[1].charCodeAt(0) - 97), t: (9 - (+m[4])) * 9 + (m[3].charCodeAt(0) - 97) };
}

(async () => {
  const XQBook = loadBook();
  const pf = await pfMod.createEngine();
  const scoreOf = (fen) => pf.search(fen, REF_MS).then(r => (r && typeof r.score === 'number') ? r.score : null);
  const rows = [];
  for (const cfg of CONFIGS) {
    for (const side of [1, -1]) { // 执红 / 执黑 各测一次
      const game = new XQ.Game('none', -1);
      if (side === -1) { /* 黑方先走: 先让参考引擎替红方走第一手 */ }
      const losses = []; const bookHits = []; const notes = [];
      for (let i = 0; i < PLIES; i++) {
        if (game.side !== side) { // 轮到对手: 用参考引擎最佳应着
          const fen = boardToFen(game.board, game.side);
          const r = await pf.search(fen, REF_MS);
          const om = parseMove(r && r.move);
          if (!om) break;
          if (!game.move(om)) break;
          continue;
        }
        const legal = game.legalMoves();
        if (!legal.length) break;
        const fen = boardToFen(game.board, game.side);
        const before = await scoreOf(fen);
        let mv = null, fromBook = false;
        if (cfg.book) {
          const bm = XQBook.pick(game.board, game.side, legal);
          if (bm && legal.some(m => m.f === bm.f && m.t === bm.t)) { mv = bm; fromBook = true; }
        }
        if (!mv) {
          const r = await pf.search(fen, cfg.movetime);
          mv = parseMove(r && r.move);
        }
        if (!mv || !legal.some(m => m.f === mv.f && m.t === mv.t)) break;
        const notation = game.history[game.history.length - 1];
        game.move(mv);
        const after = await scoreOf(boardToFen(game.board, game.side));
        if (before !== null && after !== null) losses.push(before - after);
        bookHits.push(fromBook ? 1 : 0);
        notes.push((notation && notation.red ? notation.red : notation && notation.black ? notation.black : '?') + (fromBook ? '(库)' : ''));
      }
      const n = losses.length;
      const avg = n ? losses.reduce((a, b) => a + b, 0) / n : null;
      const worst = n ? Math.max.apply(null, losses) : null;
      const bad = losses.filter(l => l > 100).length;
      rows.push({ label: cfg.label, side: side === 1 ? '执红' : '执黑', n, avg, worst, bad, bookHits: bookHits.reduce((a, b) => a + b, 0), notes });
      console.log('MEASURE ' + cfg.label + ' ' + (side === 1 ? '红' : '黑') + ' moves=' + n + ' avgLoss=' + (avg === null ? '?' : avg.toFixed(1)) + ' worst=' + worst + ' >100cp=' + bad + ' 库命中=' + rows[rows.length - 1].bookHits);
    }
  }
  fs.writeFileSync(path.join(__dirname, 'opening_report.json'), JSON.stringify(rows, null, 1));
  const lines = [];
  lines.push('# 开局质量测量（被测方连走 12 手，对手固定为参考引擎最佳应着）');
  lines.push('');
  lines.push('- 参考评估 = 皮卡鱼 3000ms；损失 = 走子前评估 - 走子后评估（正数=走差了）');
  lines.push('');
  lines.push('| 配置 | 执子 | 步数 | 平均损失cp | 最大损失cp | >100cp步数 | 开局库命中 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of rows) lines.push('| ' + r.label + ' | ' + r.side + ' | ' + r.n + ' | ' + (r.avg === null ? '?' : r.avg.toFixed(1)) + ' | ' + r.worst + ' | ' + r.bad + ' | ' + r.bookHits + ' |');
  fs.writeFileSync(path.join(__dirname, 'opening_report.md'), lines.join('\n'));
  console.log('\n' + lines.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('OPENING_FAIL', e); process.exit(1); });