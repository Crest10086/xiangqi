/* bench/gen_diverge.js — 筛选"浅搜误判/深搜纠正"的局面
 * 对每个候选: 800ms 与 6000ms 分别搜索; 保留评估分歧 >=150cp 的题 -> diverge800.json
 * 同理 2500ms 与 6000ms 分歧 -> diverge2500.json
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'engine.js'));
const { createEngine } = require('./pf.js');

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
async function searchAt(eng, fen, ms) {
  const r = await eng.search(fen, ms);
  return { move: parseMove(typeof r === 'string' ? r : r.move), score: (typeof r === 'object' && typeof r.score === 'number') ? r.score : null };
}

(async () => {
  const eng = await createEngine();
  const tests = JSON.parse(fs.readFileSync(path.join(__dirname, 'quality_tests.json'), 'utf8')).tests;
  console.log('candidates =', tests.length);
  const d800 = [], d2500 = [];
  for (const t of tests) {
    const g = replay(t.startMoves);
    if (!g) continue;
    const fen = boardToFen(g.board, g.side);
    const deep = await searchAt(eng, fen, 6000);
    if (!deep.move || deep.score === null) continue;
    const s8 = await searchAt(eng, fen, 800);
    if (s8.move && s8.score !== null) {
      const d = Math.abs(s8.score - deep.score);
      if (d >= 150) d800.push({ id: 'D8' + (d800.length + 1), startMoves: t.startMoves, side: t.side, shallowScore: s8.score, deepScore: deep.score, diverge: d });
    }
    const s25 = await searchAt(eng, fen, 2500);
    if (s25.move && s25.score !== null) {
      const d = Math.abs(s25.score - deep.score);
      if (d >= 150) d2500.push({ id: 'D25' + (d2500.length + 1), startMoves: t.startMoves, side: t.side, shallowScore: s25.score, deepScore: deep.score, diverge: d });
    }
    if ((d800.length + d2500.length) % 10 === 0) console.log('diverge800=' + d800.length + ' diverge2500=' + d2500.length);
  }
  fs.writeFileSync(path.join(__dirname, 'diverge800.json'), JSON.stringify({ tests: d800 }, null, 1));
  fs.writeFileSync(path.join(__dirname, 'diverge2500.json'), JSON.stringify({ tests: d2500 }, null, 1));
  console.log('DIVERGE_DONE diverge800=' + d800.length + ' diverge2500=' + d2500.length);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });