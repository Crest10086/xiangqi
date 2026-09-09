const XQ = require('./engine.js');
const V = [0, 10000, 30, 45, 85, 400, 100, 10];
function mat(b){let r=0,k=0;for(const c of b){if(c>0)r+=V[Math.abs(c)];else if(c<0)k+=V[Math.abs(c)];}return{r,k};}

// 1) determinism: same opening position, run 高手 12 times, count distinct moves
console.log('=== determinism: 高手, same position x12 ===');
{
  const g = new XQ.Game();
  const L = XQ.LEVELS[3];
  const seen = {};
  for (let i = 0; i < 12; i++) {
    const r = g.aiMove(L.depth, L.qDepth, L.maxNodes, L.randomness);
    seen[r.notation] = (seen[r.notation] || 0) + 1;
    g.undo(); // back to same position
  }
  const distinct = Object.keys(seen).length;
  console.log('  distinct moves:', distinct, '/ 12  ->', JSON.stringify(seen));
  console.log(distinct > 1 ? '  -> NOT deterministic (good)' : '  -> still deterministic (bad)');
}

// 2) strength: 高手(red) vs 大师(black) self-play 30 plies, who holds material
console.log('\n=== strength: 高手(red) vs 大师(black), 30 plies ===');
{
  const g = new XQ.Game();
  const Lr = XQ.LEVELS[3], Lb = XQ.LEVELS[4];
  for (let ply = 0; ply < 30; ply++) {
    if (g.legalMoves().length === 0) break;
    const L = g.side === 1 ? Lr : Lb;
    const r = g.aiMove(L.depth, L.qDepth, L.maxNodes, L.randomness);
    if (!r) { console.log('  ended ply ' + ply); break; }
  }
  const m = mat(g.board);
  console.log('  plies: ' + g.history.length + '  material 高手=' + m.r + ' 大师=' + m.k);
  console.log('  checkmate: ' + g.checkmate() + ' stalemate: ' + g.stalemate());
}

// 3) 大师 vs 入门: 大师 should win or hold advantage
console.log('\n=== strength: 大师(black) vs 入门(red), 30 plies ===');
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
  console.log('  plies: ' + g.history.length + '  material 入门=' + m.r + ' 大师=' + m.k);
  console.log(m.k > m.r ? '  -> 大师 ahead (good)' : m.k === m.r ? '  -> parity' : '  -> 入门 ahead (suspicious)');
}