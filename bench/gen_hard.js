/* bench/gen_hard.js — 构造有区分度的测验集
 * 1) 从开局库取 4 个不同首着(中炮/进兵/上马等分支) -> 各自自对弈 30 步(1000ms)
 * 2) 候选局面 = 新对局(第10步起) + tactics.json 已有局面
 * 3) 参考解 3000ms; 预筛: 200ms 答 -> 只保留 200ms 未命中的题(天然可区分 800ms+)
 * 输出: bench/hard.json
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'engine.js'));
const { createEngine } = require('./pf.js');

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
function materialRed(board) { let s = 0; for (const v of board) { if (v > 0) s += VAL[v]; else if (v < 0) s -= VAL[-v]; } return s; }
function replay(startMoves) {
  const g = new XQ.Game('none', -1);
  for (const mv of startMoves) { if (!g.move(mv)) return null; }
  return g;
}
async function pfMove(eng, g, ms) {
  const r = await eng.search(boardToFen(g.board, g.side), ms);
  return parseMove(typeof r === 'string' ? r : r.move);
}

(async () => {
  const eng = await createEngine();
  const XQBook = loadBook();

  // 1) 4 个不同开局首着(库中不同着法)
  const g0 = new XQ.Game('none', -1);
  const legal0 = g0.legalMoves();
  const openings = [];
  const seen = new Set();
  for (let i = 0; i < 400 && openings.length < 4; i++) {
    const bm = XQBook.pick(g0.board, 1, legal0);
    if (bm && legal0.some(m => m.f === bm.f && m.t === bm.t)) {
      const k = bm.f + '-' + bm.t;
      if (!seen.has(k)) { seen.add(k); openings.push(bm); }
    }
  }
  console.log('openings =', openings.length);

  // 2) 每个开局自对弈 30 步, 取第10步起每隔1步的局面
  const candidates = [];
  for (let oi = 0; oi < openings.length; oi++) {
    const g = new XQ.Game('none', -1);
    const hist = [openings[oi]];
    if (!g.move(openings[oi])) continue;
    for (let i = 1; i < 30; i++) {
      const m = await pfMove(eng, g, 1000);
      if (!m || !g.move(m)) break;
      hist.push(m);
      if (g.legalMoves().length === 0) break;
      if (i >= 10) candidates.push({ src: 'open' + oi + ' ply' + (i + 1), startMoves: hist.map(x => ({ f: x.f, t: x.t })) });
    }
    console.log('opening', oi, 'selfplay done, candidates so far =', candidates.length);
  }
  // 并入已有 tactics.json 的局面
  const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'tactics.json'), 'utf8')).tests;
  for (const t of old) candidates.push({ src: 'old ' + t.id, startMoves: t.startMoves });
  console.log('total candidates =', candidates.length);

  // 3) 参考解 3000ms + 200ms 预筛
  const kept = [];
  for (let ci = 0; ci < candidates.length; ci++) {
    const c = candidates[ci];
    const g = replay(c.startMoves);
    if (!g) continue;
    const side = g.side;
    const legal = g.legalMoves();
    if (legal.length === 0) continue;
    const ref = await pfMove(eng, g, 3000);
    if (!ref || !legal.some(m => m.f === ref.f && m.t === ref.t)) continue;
    const gRef = replay(c.startMoves); gRef.move(ref);
    const refKey = gRef.board.join(',');
    const weak = await pfMove(eng, g, 200);   // 预筛: 200ms
    if (!weak) continue;
    const gW = replay(c.startMoves);
    if (!gW.move(weak)) continue;
    if (gW.board.join(',') === refKey) continue;  // 200ms 也能答对 -> 无区分度, 剔除
    const before = materialRed(g.board);
    const gain = (materialRed(gRef.board) - before) * (side === 1 ? 1 : -1);
    kept.push({
      id: 'H' + String(kept.length + 1).padStart(2, '0'),
      src: c.src, startMoves: c.startMoves, side,
      bestMove: ref, materialGain: gain,
    });
    if (kept.length % 10 === 0) console.log('kept(discriminative) =', kept.length);
  }
  fs.writeFileSync(path.join(__dirname, 'hard.json'), JSON.stringify({ tests: kept }, null, 1));
  console.log('HARD_DONE kept=' + kept.length + ' of ' + candidates.length + ' -> hard.json');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });