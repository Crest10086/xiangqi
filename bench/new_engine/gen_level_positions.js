/* new_engine/gen_level_positions.js — TEST-ONLY generator for card t_ef6e93b8.
 * Builds bench/new_engine/level_positions.json:
 *   group "opening": start position + positions after 2/4/6/8 legal plies (seeded replay through engine.js)
 *   group "midgame": deterministic sample of bench/new_engine/testset_fens.json (midgame/tactical, incl. QT01
 *                    so results are cross-checkable against NEW_ENGINE_OPTIONS.md 2.2)
 * All FENs are produced by replaying through the project's own engine.js so they are legal positions.
 */
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', '..', 'engine.js'));

const ROOT = __dirname;

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
  return out + ' w - - 0 1'.replace('w', side === 1 ? 'w' : 'b');
}

// deterministic PRNG (mulberry32) so the opening line is reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uciOf(m) {
  const fc = m.f % 9, fr = Math.floor(m.f / 9), tc = m.t % 9, tr = Math.floor(m.t / 9);
  const L = 'abcdefghi';
  return L[fc] + (9 - fr) + L[tc] + (9 - tr);
}

const out = [];
const seen = new Set();

// ---- opening group: seeded legal replay from the standard start position ----
const rnd = mulberry32(20261004);
const g = new XQ.Game('none', -1);
const line = [];
function record(label) {
  const fen = boardToFen(g.board, g.side);
  if (seen.has(fen)) return;
  seen.add(fen);
  out.push({
    id: 'OP' + label,
    group: 'opening',
    fen: fen,
    side: g.side,
    ply: line.length,
    lineUci: line.map(uciOf).join(' '),
    nLegal: g.legalMoves().length,
  });
}
record('00');                       // ply 0, 开局初始局面
for (let ply = 1; ply <= 8; ply++) {
  const legal = g.legalMoves();
  if (!legal.length) break;
  const mv = legal[Math.floor(rnd() * legal.length)];
  if (!g.move(mv)) { console.log('OPENING replay failed at ply ' + ply); break; }
  line.push(mv);
  if (ply % 2 === 0) record(String(ply).padStart(2, '0'));   // record at even plies (red to move)
}

// ---- midgame group: deterministic sample of the existing midgame/tactical test set ----
const ts = JSON.parse(fs.readFileSync(path.join(ROOT, 'testset_fens.json'), 'utf8'));
console.log('source midgame pool:', ts.length);
const wanted = ['QT01', 'QT05', 'QT10', 'QT14', 'QT19', 'QT24', 'QT29', 'QT34', 'QT39', 'QH01', 'QB3', 'QB9'];
for (const id of wanted) {
  const t = ts.find((x) => x.id === id);
  if (!t) { console.log('MISSING ' + id); continue; }
  if (seen.has(t.fen)) { console.log('DUP ' + id); continue; }
  seen.add(t.fen);
  out.push({ id: 'MG_' + t.id, group: 'midgame', fen: t.fen, side: t.side, nLegal: t.nLegal });
}

fs.writeFileSync(path.join(ROOT, 'level_positions.json'), JSON.stringify(out, null, 1));
console.log('wrote level_positions.json count=' + out.length);
for (const p of out) console.log(p.id, p.group, 'nLegal=' + p.nLegal, p.fen);
