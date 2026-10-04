/* new_engine/gen_fens.js — 把 bench/quality_tests.json 的 66 个中局题 replay 成 FEN
 * 输出: bench/new_engine/testset_fens.json  [{id, fen, side, startMoves}]
 * 与 run_quality.js / tactics_worker2.js 同一 replay 路径（engine.js Game），保证题集一致。
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

const tests = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'quality_tests.json'), 'utf8')).tests;
const out = [];
const seen = new Set();
for (const t of tests) {
  const g = new XQ.Game('none', -1);
  let ok = true;
  for (const mv of t.startMoves) { if (!g.move(mv)) { ok = false; break; } }
  if (!ok) { console.log('SKIP ' + t.id); continue; }
  const fen = boardToFen(g.board, g.side);
  const key = fen;
  if (seen.has(key)) { console.log('DUP ' + t.id); continue; }
  seen.add(key);
  out.push({ id: t.id, fen, side: g.side, nLegal: g.legalMoves().length, startMoves: t.startMoves });
}
fs.writeFileSync(path.join(__dirname, 'testset_fens.json'), JSON.stringify(out, null, 1));
console.log('FENs written =', out.length, 'of', tests.length);
console.log('sample:', JSON.stringify(out[0]).slice(0, 200));
