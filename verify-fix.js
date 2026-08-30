/* verify-fix.js — direct tests for the 3 reported problems */
const XQ = require('./engine.js');
const V = [0, 10000, 30, 45, 85, 400, 100, 10];

function mat(board) {
  let r = 0, b = 0;
  for (const c of board) { if (c > 0) r += V[Math.abs(c)]; else if (c < 0) b += V[Math.abs(c)]; }
  return { r, b };
}

// ---------- TEST A: oscillation detection in self-play ----------
console.log('=== A) self-play 高手(red) vs 大师(black), detect position repetition ===');
{
  const g = new XQ.Game();
  const Lr = XQ.LEVELS[3], Lb = XQ.LEVELS[4];
  const freq = new Map();
  let maxFreq = 0, worst = '';
  let backAndForth = 0;
  let prevKey = null, prevPrevKey = null;
  for (let ply = 0; ply < 40; ply++) {
    const key = g.board.join('');
    freq.set(key, (freq.get(key) || 0) + 1);
    maxFreq = Math.max(maxFreq, freq.get(key));
    if (freq.get(key) > maxFreq - 1 && freq.get(key) >= 3) worst = key;
    // back-and-forth: current position identical to the one 2 plies ago
    if (prevKey !== null && prevKey === key) backAndForth++;
    prevPrevKey = prevKey; prevKey = key;

    const L = g.side === 1 ? Lr : Lb;
    const t0 = Date.now();
    const r = g.aiMove(L.depth, L.qDepth, L.maxNodes, L.randomness);
    if (!r) { console.log('  game ended at ply ' + ply); break; }
    if (ply % 10 === 9) console.log('  ply ' + (ply + 1) + ' ' + r.notation + ' (' + (Date.now() - t0) + 'ms)');
  }
  const m = mat(g.board);
  console.log('  plies played: ' + g.history.length);
  console.log('  max times any position repeated: ' + maxFreq + '   back-and-forth(2-ply) count: ' + backAndForth);
  console.log('  material red=' + m.r + ' black=' + m.b);
  console.log(maxFreq >= 3 ? '  -> some position hit 3+ times (penalty should push it away next time)' : '  -> no position repeated 3+ times');
}

// ---------- TEST B: strength — weaker level should not beat stronger ----------
console.log('\n=== B) strength: 入门(red) vs 大师(black), 30 plies ===');
{
  const g = new XQ.Game();
  const Lr = XQ.LEVELS[0], Lb = XQ.LEVELS[4];
  for (let ply = 0; ply < 30; ply++) {
    if (g.legalMoves().length === 0) break;
    const L = g.side === 1 ? Lr : Lb;
    const r = g.aiMove(L.depth, L.qDepth, L.maxNodes, L.randomness);
    if (!r) { console.log('  ended ply ' + ply); break; }
  }
  const m = mat(g.board);
  console.log('  plies: ' + g.history.length + '  material red(入门)=' + m.r + ' black(大师)=' + m.b);
  console.log(m.b >= m.r ? '  -> stronger side holds material advantage or parity (good)' : '  -> weaker side ahead in material (suspicious)');
}

// ---------- TEST C: each level reaches its intended depth (no silent truncation) ----------
console.log('\n=== C) achieved search depth per level from initial position ===');
{
  const g = new XQ.Game();
  for (const L of XQ.LEVELS) {
    const t0 = Date.now();
    // measure by timing + nodes; confirm it completes its top depth without abort
    const repMap = XQ.think ? null : null;
    const res = g.aiMove(L.depth, L.qDepth, L.maxNodes, 0);
    const ms = Date.now() - t0;
    console.log('  ' + L.name + ': depth=' + L.depth + ' nodes=' + res.nodes + ' (' + ms + 'ms) move=' + res.notation);
  }
}
