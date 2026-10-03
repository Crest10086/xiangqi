/* bench/gen_hard2.js — 混乱局面 + 定制预筛, 生成两个有区分度的题集
 * 局面来源: 随机走法(random) + 引擎前半随机后半(mixed) —— 制造真实战术张力
 * 预筛: 800ms 答错 -> hard800.json ; 2500ms 答错 -> hard2500.json
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'engine.js'));
const { createEngine } = require('./pf.js');

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
  const rand = mulberry32(777001);

  // 4 个不同开局首着
  const g0 = new XQ.Game('none', -1);
  const legal0 = g0.legalMoves();
  const openings = []; const seen = new Set();
  for (let i = 0; i < 400 && openings.length < 4; i++) {
    const bm = XQBook.pick(g0.board, 1, legal0);
    if (bm && legal0.some(m => m.f === bm.f && m.t === bm.t)) {
      const k = bm.f + '-' + bm.t;
      if (!seen.has(k)) { seen.add(k); openings.push(bm); }
    }
  }

  // 候选: random / mixed 两种走法, 每局取第9步起
  const candidates = [];
  for (let oi = 0; oi < openings.length; oi++) {
    for (const mode of ['random', 'mixed', 'random']) {
      const g = new XQ.Game('none', -1);
      const hist = [openings[oi]];
      if (!g.move(openings[oi])) continue;
      for (let i = 1; i < 24; i++) {
        let m = null;
        const legal = g.legalMoves();
        if (!legal.length) break;
        if (mode === 'random' || i > 8) {
          m = legal[Math.floor(rand() * legal.length)];   // 随机走法 -> 混乱局面
        } else {
          m = await pfMove(eng, g, 1000);
        }
        if (!m || !g.move(m)) break;
        hist.push(m);
        if (g.legalMoves().length === 0) break;
        if (i >= 9) candidates.push({ src: 'open' + oi + '-' + mode + '-p' + (i + 1), startMoves: hist.map(x => ({ f: x.f, t: x.t })) });
      }
    }
    console.log('opening', oi, 'done, candidates =', candidates.length);
  }
  // 去重(按局面)
  const uniq = new Map();
  for (const c of candidates) {
    const g = replay(c.startMoves); if (!g) continue;
    const k = g.board.join(',') + '#' + g.side;
    if (!uniq.has(k)) uniq.set(k, c);
  }
  const cand = [...uniq.values()];
  console.log('unique candidates =', cand.length);

  const hard800 = [], hard2500 = [];
  for (const c of cand) {
    const g = replay(c.startMoves);
    if (!g) continue;
    const side = g.side;
    const legal = g.legalMoves();
    if (!legal.length) continue;
    const ref = await pfMove(eng, g, 3000);
    if (!ref || !legal.some(m => m.f === ref.f && m.t === ref.t)) continue;
    const gRef = replay(c.startMoves); gRef.move(ref);
    const refKey = gRef.board.join(',');
    const before = materialRed(g.board);
    const gain = (materialRed(gRef.board) - before) * (side === 1 ? 1 : -1);
    const entry = { id: null, src: c.src, startMoves: c.startMoves, side, bestMove: ref, materialGain: gain };
    const w8 = await pfMove(eng, g, 800);
    if (w8) { const gw = replay(c.startMoves); if (gw.move(w8) && gw.board.join(',') !== refKey) { entry.id = 'A' + (hard800.length + 1); hard800.push(entry); } }
    const w25 = await pfMove(eng, g, 2500);
    if (w25) { const gw = replay(c.startMoves); if (gw.move(w25) && gw.board.join(',') !== refKey) { entry.id = 'B' + (hard2500.length + 1); hard2500.push(entry); } }
    if ((hard800.length + hard2500.length) % 20 === 0) console.log('kept800=' + hard800.length + ' kept2500=' + hard2500.length);
  }
  fs.writeFileSync(path.join(__dirname, 'hard800.json'), JSON.stringify({ tests: hard800 }, null, 1));
  fs.writeFileSync(path.join(__dirname, 'hard2500.json'), JSON.stringify({ tests: hard2500 }, null, 1));
  console.log('HARD2_DONE candidates=' + cand.length + ' hard800=' + hard800.length + ' hard2500=' + hard2500.length);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });