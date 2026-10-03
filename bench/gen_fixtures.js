/* bench/gen_fixtures.js — 生成固定局面集: Pikafish 自对弈录制真实着法序列
 * 用法: node gen_fixtures.js  → bench/fixtures.json
 * 局面集: P0 初始 / P1 第8步后 / P2 第20步后 / P3 第40步后
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

(async () => {
  const eng = await createEngine();
  const game = new XQ.Game('none', -1);
  const moves = [];
  const TARGET = 60, MS = 1500;
  for (let i = 0; i < TARGET; i++) {
    const fen = boardToFen(game.board, game.side);
    const raw = await eng.search(fen, MS);
    const mv = parseMove(typeof raw === 'string' ? raw : raw.move);
    if (!mv) { console.log('parse fail', raw); break; }
    const res = game.move(mv);
    if (!res) { console.log('illegal at ply', i, raw); break; }
    moves.push({ f: mv.f, t: mv.t });
    if (game.legalMoves().length === 0) { console.log('game over at ply', i, game.inCheck() ? 'mate' : 'stalemate'); break; }
    if (i % 10 === 9) console.log('ply', i + 1, game.history.slice(-1)[0].notation);
  }
  const fixtures = {
    generated: 'Pikafish 1500ms self-play x' + TARGET,
    positions: [
      { id: 'P0', label: '初始局面', startMoves: [] },
      { id: 'P1', label: '第8步后(开局)', startMoves: moves.slice(0, 8) },
      { id: 'P2', label: '第20步后(中局)', startMoves: moves.slice(0, 20) },
      { id: 'P3', label: '第40步后(中后盘)', startMoves: moves.slice(0, 40) },
    ],
    fullGame: moves,
  };
  fs.writeFileSync(path.join(__dirname, 'fixtures.json'), JSON.stringify(fixtures, null, 1));
  console.log('FIXTURES_DONE totalMoves=' + moves.length + ' -> fixtures.json');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });