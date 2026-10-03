/* bench/tactics_gen.js — 生成固定战术测验集
 * 来源: fixtures.fullGame 重放 + 第二局自对弈(3000ms, 增加多样性)
 * 每题: 局面(startMoves) + 参考解(皮卡鱼 8000ms 最佳着法/评分/物质增益) + 分类
 * 输出: bench/tactics.json
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
const VAL = { 1: 0, 2: 200, 3: 200, 4: 450, 5: 900, 6: 450, 7: 100 };
function materialRed(board) {
  let s = 0;
  for (const v of board) { if (v > 0) s += VAL[v]; else if (v < 0) s -= VAL[-v]; }
  return s; // 红视角
}

async function selfPlay(eng, target, ms) {
  const g = new XQ.Game('none', -1);
  const mv = [];
  for (let i = 0; i < target; i++) {
    const r = await eng.search(boardToFen(g.board, g.side), ms);
    const m = parseMove(typeof r === 'string' ? r : r.move);
    if (!m || !g.move(m)) break;
    mv.push(m);
    if (g.legalMoves().length === 0) break;
  }
  return mv;
}

(async () => {
  const eng = await createEngine();
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
  const games = [fixtures.fullGame];
  console.log('self-play #2 (3000ms x40)...');
  games.push(await selfPlay(eng, 40, 3000));

  // 收集局面: 每局从第10步起, 每隔2步取一个
  const positions = [];
  games.forEach((gm, gi) => {
    const g = new XQ.Game('none', -1);
    for (let i = 0; i < gm.length; i++) {
      if (!g.move(gm[i])) break;
      if (i >= 10 && i % 2 === 0) {
        positions.push({ game: gi, ply: i + 1, startMoves: gm.slice(0, i + 1).map(m => ({ f: m.f, t: m.t })) });
      }
    }
  });
  console.log('raw positions =', positions.length);

  const tests = [];
  for (let pi = 0; pi < positions.length && tests.length < 40; pi++) {
    const p = positions[pi];
    const g = new XQ.Game('none', -1);
    let ok = true;
    for (const mv of p.startMoves) if (!g.move(mv)) { ok = false; break; }
    if (!ok) continue;
    const side = g.side;
    const r = await eng.search(boardToFen(g.board, side), 8000);
    const bm = parseMove(typeof r === 'string' ? r : r.move);
    if (!bm) continue;
    const legal = g.legalMoves();
    if (!legal.some(m => m.f === bm.f && m.t === bm.t)) continue;
    const before = materialRed(g.board);
    g.move(bm);
    const after = materialRed(g.board);
    const gain = (after - before) * (side === 1 ? 1 : -1); // 走方视角物质增益
    const refScore = (typeof r === 'object' && typeof r.score === 'number') ? r.score : null;
    const isTactical = gain >= 150 || (refScore !== null && refScore >= 400);
    tests.push({
      id: 'T' + String(tests.length + 1).padStart(2, '0'),
      src: 'game' + p.game + ' ply' + p.ply,
      startMoves: p.startMoves,
      side,
      bestMove: bm,
      refScore, refDepth: (typeof r === 'object' ? r.depth : 0),
      materialGain: gain,
      isTactical,
    });
    if (tests.length % 5 === 0) console.log('reference solutions: ' + tests.length);
  }
  const tacticalCount = tests.filter(t => t.isTactical).length;
  fs.writeFileSync(path.join(__dirname, 'tactics.json'), JSON.stringify({ tests }, null, 1));
  console.log('TACTICS_DONE tests=' + tests.length + ' tactical=' + tacticalCount + ' -> tactics.json');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });