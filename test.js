/* Xiangqi engine unit tests — run: node test.js */
const XQ = require('./engine.js');
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log(' FAIL  ' + name); }
}

// ---- initial position invariants ----
const b0 = XQ.initialBoard();
t('initial: no side in check', !XQ.inCheck(b0, 1) && !XQ.inCheck(b0, -1));
// verified by hand: symmetric initial position, 44 each (cannons: red 12/cannon lateral+forward, black same; asymmetry in captures nets out)
t('initial: red has 44 legal moves', XQ.legalMoves(b0, 1).length === 44);
t('initial: black has 44 legal moves', XQ.legalMoves(b0, -1).length === 44);

// ---- piece-specific legality on initial board ----
const ms = XQ.legalMoves(b0, 1);
t('cannon lateral move exists (炮二平五 target)', ms.some(m => m.f === 7 * 9 + 7 && m.t === 7 * 9 + 4));
// horse at (9,1): (8,3) blocked by own elephant at (9,2); legal: (7,0),(7,2)
t('horse initial moves (7,0)&(7,2), (8,3) blocked by elephant', ms.some(m => m.f === 82 && m.t === 7 * 9 + 0) && ms.some(m => m.f === 82 && m.t === 7 * 9 + 2) && !ms.some(m => m.f === 82 && m.t === 8 * 9 + 3));
t('elephant initial moves (7,0)&(7,4)', ms.some(m => m.f === 83 && m.t === 7 * 9 + 0) && ms.some(m => m.f === 83 && m.t === 7 * 9 + 4));
t('advisor initial move only to center (8,4)', ms.filter(m => m.f === 84).length === 1 && ms.find(m => m.f === 84).t === 8 * 9 + 4);
// king at (9,4): sideways blocked by own advisors; only up to (8,4)
t('king initial move: only up to (8,4)', ms.filter(m => m.f === 85).length === 1 && ms.find(m => m.f === 85).t === 8 * 9 + 4);
t('pawn before river: forward only', ms.filter(m => m.f === 54).length === 1 && ms.find(m => m.f === 54).t === 5 * 9 + 0);
// black cannon captures red pawn across river (the asymmetry)
const msB = XQ.legalMoves(b0, -1);
t('black cannon can capture red river pawn', msB.some(m => m.f === 2 * 9 + 1 && m.t === 6 * 9 + 1));

// ---- horse leg blocking ----
{
  const bb = new Array(90).fill(0);
  bb[5 * 9 + 4] = XQ.P.N;           // red horse at (5,4)
  bb[6 * 9 + 4] = XQ.P.R;           // blocker directly below (leg for dr=+2 jumps)
  const hm = XQ.legalMoves(bb, 1).filter(m => m.f === 5 * 9 + 4);
  t('horse leg blocks downward jumps', !hm.some(m => m.t === 7 * 9 + 3) && !hm.some(m => m.t === 7 * 9 + 5));
  t('horse still jumps sideways/up', hm.some(m => m.t === 4 * 9 + 2) && hm.some(m => m.t === 3 * 9 + 3));
}

// ---- elephant eye blocking ----
{
  const bb = new Array(90).fill(0);
  bb[9 * 9 + 2] = XQ.P.B;            // red elephant at (9,2)
  bb[8 * 9 + 3] = XQ.P.R;            // eye blocks diagonal to (7,4) only
  const em = XQ.legalMoves(bb, 1).filter(m => m.f === 9 * 9 + 2);
  t('elephant eye blocks one diagonal only', !em.some(m => m.t === 7 * 9 + 4) && em.some(m => m.t === 7 * 9 + 0));
}

// ---- cannon platform rules ----
{
  const bb = new Array(90).fill(0);
  bb[5 * 9 + 0] = XQ.P.C;            // red cannon at (5,0)
  bb[3 * 9 + 0] = -XQ.P.P;           // black pawn same file above
  let cm = XQ.legalMoves(bb, 1).filter(m => m.f === 5 * 9 + 0);
  t('cannon cannot capture without platform', !cm.some(m => m.t === 3 * 9 + 0));
  // cannon moves like a rook ONLY on empty squares before the first piece: (4,0) yes, (2,0) no (beyond the pawn)
  t('cannon moves on empty line up to first piece only', cm.some(m => m.t === 4 * 9 + 0) && !cm.some(m => m.t === 2 * 9 + 0));
  bb[4 * 9 + 0] = XQ.P.P;            // own pawn becomes the platform now
  cm = XQ.legalMoves(bb, 1).filter(m => m.f === 5 * 9 + 0);
  t('cannon captures with platform', cm.some(m => m.t === 3 * 9 + 0));
  bb[4 * 9 + 0] = -XQ.P.P;           // enemy piece as platform
  cm = XQ.legalMoves(bb, 1).filter(m => m.f === 5 * 9 + 0);
  t('enemy piece also serves as platform', cm.some(m => m.t === 3 * 9 + 0));
}

// ---- flying general (face-to-face) ----
{
  const bb = new Array(90).fill(0);
  bb[9 * 9 + 4] = XQ.P.K;
  bb[0 * 9 + 4] = -XQ.P.K;
  t('flying general: face-to-face is check', XQ.inCheck(bb, 1));
  const km = XQ.legalMoves(bb, 1).filter(m => m.f === 9 * 9 + 4);
  t('flying general: king may capture through empty file', km.some(m => m.t === 0 * 9 + 4));
  bb[5 * 9 + 4] = XQ.P.R;
  t('flying general: blocked by intervening piece', !XQ.inCheck(bb, 1));
}

// ---- checkmate: three-rook ladder ----
{
  const bb = new Array(90).fill(0);
  bb[0 * 9 + 4] = -XQ.P.K;           // black king top center
  bb[2 * 9 + 4] = XQ.P.R;            // check along file 4
  bb[1 * 9 + 3] = XQ.P.R;            // covers (0,3) & (1,4)? row1: covers (1,4) yes
  bb[0 * 9 + 6] = XQ.P.R;            // covers whole row 0: (0,3),(0,5)
  t('three-rook mate: black in check', XQ.inCheck(bb, -1));
  t('three-rook mate: zero legal moves', XQ.legalMoves(bb, -1).length === 0);
}

// ---- stalemate (困毙): no check, no moves ----
{
  const bb = new Array(90).fill(0);
  bb[0 * 9 + 4] = -XQ.P.K;
  bb[1 * 9 + 3] = XQ.P.R;            // covers (0,3) via file 3, and (1,4) via row 1
  bb[1 * 9 + 5] = XQ.P.R;            // covers (0,5) via file 5
  t('stalemate: black not in check', !XQ.inCheck(bb, -1));
  t('stalemate: black has no legal moves', XQ.legalMoves(bb, -1).length === 0);
}

// ---- notation (red files: 一=col8..九=col0; black: 1=col0..9=col8) ----
{
  const g = new XQ.Game();
  t('notation 炮二平五 (cannon col7→col4)', XQ.toNotation(g.board, { f: 7 * 9 + 7, t: 7 * 9 + 4 }, 1) === '炮二平五');
  t('notation 马二进三 (horse col7→col6)', XQ.toNotation(g.board, { f: 9 * 9 + 7, t: 7 * 9 + 6 }, 1) === '马二进三');
  t('notation 兵七进一 (pawn col2 advance)', XQ.toNotation(g.board, { f: 6 * 9 + 2, t: 5 * 9 + 2 }, 1) === '兵七进一');
  t('notation black pawn arabic (卒1进1)', XQ.toNotation(g.board, { f: 3 * 9 + 0, t: 4 * 9 + 0 }, -1) === '卒1进1');
  t('notation black cannon 平 (砲8平5)', XQ.toNotation(g.board, { f: 2 * 9 + 7, t: 2 * 9 + 4 }, -1) === '砲8平5');
}

// ---- handicap application (both sides) ----
{
  const hb = XQ.applyHandicap(XQ.initialBoard(), 'pao2', -1);
  t('handicap pao2 removes both black cannons', !hb.includes(-XQ.P.C));
  t('handicap keeps black rooks/horses', hb.filter(x => x === -XQ.P.R).length === 2 && hb.filter(x => x === -XQ.P.N).length === 2);
  const hc = XQ.applyHandicap(XQ.initialBoard(), 'chepao', -1);
  t('handicap chepao removes rook+cannon', !hc.includes(-XQ.P.R) && !hc.includes(-XQ.P.C));
  const hr = XQ.applyHandicap(XQ.initialBoard(), 'ma2', 1);   // handicap given TO red (AI is black... aiSide=red means human black)
  t('handicap on red side removes red horses', !hr.includes(XQ.P.N) && hr.filter(x => x === -XQ.P.N).length === 2);
}

// ---- Game class flow ----
{
  const g = new XQ.Game();
  const m1 = g.legalMoves().find(m => m.f === 7 * 9 + 7 && m.t === 7 * 9 + 4); // 炮二平五
  t('game finds 炮二平五 as legal', !!m1);
  const r1 = g.move(m1);
  t('game move returns notation', r1 && r1.notation === '炮二平五');
  t('side switches to black', g.side === -1);
  g.undo();
  t('undo restores side & board', g.side === 1 && JSON.stringify(g.board) === JSON.stringify(XQ.initialBoard()));
}

// ---- AI self-play, all levels ----
{
  for (let L = 0; L < XQ.LEVELS.length; L++) {
    const g = new XQ.Game();
    let ok = true;
    for (let i = 0; i < 20; i++) {
      if (g.legalMoves().length === 0) break;
      const r = g.aiMove(XQ.LEVELS[L].depth, XQ.LEVELS[L].qDepth, XQ.LEVELS[L].maxNodes, XQ.LEVELS[L].randomness);
      if (!r) { ok = false; break; }
    }
    t(`AI self-play 20 plies @ ${XQ.LEVELS[L].name}`, ok);
  }
}

// ---- handicap game: AI without cannons still plays ----
{
  const g = new XQ.Game('pao2', -1);
  t('handicap game starts with black missing cannons', !g.board.includes(-XQ.P.C));
  const r = g.aiMove(2, 0, 4000, 0);
  t('handicapped AI produces a move', !!r);
}

// ---- benchmark: first-move time per level ----
console.log('\n-- benchmark (first AI move from initial position) --');
for (const L of XQ.LEVELS) {
  const g = new XQ.Game();
  const t0 = Date.now();
  const r = g.aiMove(L.depth, L.qDepth, L.maxNodes, 0);
  console.log(`  ${L.name}: ${Date.now() - t0}ms  nodes=${r.nodes}  move=${r.notation}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
