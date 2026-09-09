/* Xiangqi (Chinese Chess) engine — zero dependencies, works in browser & Node */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XQ = factory();
})(this, function () {
  'use strict';

  // piece codes: positive = red, negative = black
  const P = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 };
  const NAME_RED = { 1: '帅', 2: '仕', 3: '相', 4: '马', 5: '车', 6: '炮', 7: '兵' };
  const NAME_BLK = { '-1': '将', '-2': '士', '-3': '象', '-4': '马', '-5': '车', '-6': '砲', '-7': '卒' };
  const pieceName = (c) => (c > 0 ? NAME_RED[c] : NAME_BLK['-' + Math.abs(c)]);
  const sideOf = (c) => (c > 0 ? 1 : -1);

  function initialBoard() {
    const b = new Array(90).fill(0);
    const back = [P.R, P.N, P.B, P.A, P.K, P.A, P.B, P.N, P.R];
    for (let i = 0; i < 9; i++) {
      b[0 * 9 + i] = -back[i];
      b[9 * 9 + i] = back[i];
    }
    b[2 * 9 + 1] = -P.C; b[2 * 9 + 7] = -P.C;
    b[7 * 9 + 1] = P.C; b[7 * 9 + 7] = P.C;
    for (let i = 0; i < 9; i += 2) { b[3 * 9 + i] = -P.P; b[6 * 9 + i] = P.P; }
    return b;
  }

  const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
  const inPalace = (r, c, red) => c >= 3 && c <= 5 && (red ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2));

  // ---------- move generation ----------
  function genPseudo(b, side) {
    const ms = [];
    for (let i = 0; i < 90; i++) {
      const c = b[i];
      if (sideOf(c) !== side) continue;
      const r = (i / 9) | 0, col = i % 9;
      const red = side === 1;
      switch (Math.abs(c)) {
        case P.K: {
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = r + dr, nc = col + dc;
            if (!inPalace(nr, nc, red)) continue;
            const t = b[nr * 9 + nc];
            if (t === 0 || sideOf(t) !== side) ms.push({ f: i, t: nr * 9 + nc });
          }
          for (let j = r - 1; j >= 0; j--) {           // flying general up
            const p = b[j * 9 + col];
            if (p !== 0) { if (Math.abs(p) === P.K && sideOf(p) !== side) ms.push({ f: i, t: j * 9 + col }); break; }
          }
          for (let j = r + 1; j < 10; j++) {           // flying general down
            const p = b[j * 9 + col];
            if (p !== 0) { if (Math.abs(p) === P.K && sideOf(p) !== side) ms.push({ f: i, t: j * 9 + col }); break; }
          }
          break;
        }
        case P.A: {
          for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            const nr = r + dr, nc = col + dc;
            if (!inPalace(nr, nc, red)) continue;
            const t = b[nr * 9 + nc];
            if (t === 0 || sideOf(t) !== side) ms.push({ f: i, t: nr * 9 + nc });
          }
          break;
        }
        case P.B: {
          for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
            const nr = r + dr, nc = col + dc;
            if (!inBoard(nr, nc) || !((red ? nr >= 5 : nr <= 4))) continue;
            const t = b[nr * 9 + nc];
            if (t === 0 || sideOf(t) !== side) {
              if (b[(r + dr / 2) * 9 + (col + dc / 2)] === 0) ms.push({ f: i, t: nr * 9 + nc });
            }
          }
          break;
        }
        case P.N: {
          for (const [dr, dc] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2]]) {
            const nr = r + dr, nc = col + dc;
            if (!inBoard(nr, nc)) continue;
            const lr = Math.abs(dr) === 2 ? r + (dr > 0 ? 1 : -1) : r;   // horse leg
            const lc = Math.abs(dc) === 2 ? col + (dc > 0 ? 1 : -1) : col;
            if (b[lr * 9 + lc] !== 0) continue;
            const t = b[nr * 9 + nc];
            if (t === 0 || sideOf(t) !== side) ms.push({ f: i, t: nr * 9 + nc });
          }
          break;
        }
        case P.R: {
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            let nr = r + dr, nc = col + dc;
            while (inBoard(nr, nc)) {
              const t = b[nr * 9 + nc];
              if (t === 0) ms.push({ f: i, t: nr * 9 + nc });
              else { if (sideOf(t) !== side) ms.push({ f: i, t: nr * 9 + nc }); break; }
              nr += dr; nc += dc;
            }
          }
          break;
        }
        case P.C: {
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            let nr = r + dr, nc = col + dc;
            // moving: like a rook, empty squares until the first piece
            while (inBoard(nr, nc) && b[nr * 9 + nc] === 0) { ms.push({ f: i, t: nr * 9 + nc }); nr += dr; nc += dc; }
            if (!inBoard(nr, nc)) continue; // first piece = platform; capture = next piece beyond it
            let tr = nr + dr, tc = nc + dc;
            while (inBoard(tr, tc)) {
              const t = b[tr * 9 + tc];
              if (t !== 0) { if (sideOf(t) !== side) ms.push({ f: i, t: tr * 9 + tc }); break; }
              tr += dr; tc += dc;
            }
          }
          break;
        }
        case P.P: {
          const fwd = red ? -1 : 1;
          const crossed = red ? r <= 4 : r >= 5;
          if (inBoard(r + fwd, col)) {
            const t = b[(r + fwd) * 9 + col];
            if (t === 0 || sideOf(t) !== side) ms.push({ f: i, t: (r + fwd) * 9 + col });
          }
          if (crossed) for (const dc of [-1, 1]) {
            const nc = col + dc;
            if (!inBoard(r, nc)) continue;
            const t = b[r * 9 + nc];
            if (t === 0 || sideOf(t) !== side) ms.push({ f: i, t: r * 9 + nc });
          }
          break;
        }
      }
    }
    return ms;
  }

  function isAttacked(b, idx, bySide) {
    const r = (idx / 9) | 0, c = idx % 9;
    for (let i = 0; i < 90; i++) {
      if (i === idx) continue;
      const p = b[i];
      if (sideOf(p) !== bySide) continue;
      const pr = (i / 9) | 0, pc = i % 9;
      switch (Math.abs(p)) {
        case P.P: {
          const fwd = p > 0 ? -1 : 1;
          if (pr + fwd === r && pc === c) return true;                       // forward bite
          if (pr === r && Math.abs(pc - c) === 1) {                          // sideways (crossed only)
            const crossed = p > 0 ? pr <= 4 : pr >= 5;
            if (crossed) return true;
          }
          break;
        }
        case P.N: {
          const dr = r - pr, dc = c - pc;
          if ((Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2)) {
            const lr = Math.abs(dr) === 2 ? pr + (dr > 0 ? 1 : -1) : pr;
            const lc = Math.abs(dc) === 2 ? pc + (dc > 0 ? 1 : -1) : pc;
            if (b[lr * 9 + lc] === 0) return true;
          }
          break;
        }
        case P.R: {
          if (r === pr && c !== pc) {
            const step = c > pc ? 1 : -1;
            let clear = true;
            for (let x = pc + step; x !== c; x += step) if (b[r * 9 + x] !== 0) { clear = false; break; }
            if (clear) return true;
          } else if (c === pc && r !== pr) {
            const step = r > pr ? 1 : -1;
            let clear = true;
            for (let y = pr + step; y !== r; y += step) if (b[y * 9 + c] !== 0) { clear = false; break; }
            if (clear) return true;
          }
          break;
        }
        case P.C: {
          let onRow = r === pr && c !== pc, onCol = c === pc && r !== pr;
          if (!onRow && !onCol) break;
          let pieces = 0, found = false;
          if (onRow) {
            const step = c > pc ? 1 : -1;
            for (let x = pc + step; x !== c; x += step) if (b[r * 9 + x] !== 0) pieces++;
          } else {
            const step = r > pr ? 1 : -1;
            for (let y = pr + step; y !== r; y += step) if (b[y * 9 + c] !== 0) pieces++;
          }
          if (pieces === 1) return true;
          break;
        }
        case P.K: {
          if (Math.abs(r - pr) + Math.abs(c - pc) === 1) return true;
          if (c === pc && r !== pr) { // flying general
            const step = r > pr ? 1 : -1;
            let empty = true;
            for (let y = pr + step; y !== r; y += step) if (b[y * 9 + c] !== 0) { empty = false; break; }
            if (empty) return true;
          }
          break;
        }
      }
    }
    return false;
  }

  function findKing(b, side) {
    for (let i = 0; i < 90; i++) if (b[i] === side * P.K) return i;
    return -1;
  }

  function legalMoves(b, side) {
    const out = [];
    for (const m of genPseudo(b, side)) {
      const nb = b.slice();
      nb[m.t] = nb[m.f]; nb[m.f] = 0;
      const k = findKing(nb, side);
      if (k < 0 || !isAttacked(nb, k, -side)) out.push(m);
    }
    return out;
  }

  function inCheck(b, side) {
    const k = findKing(b, side);
    return k >= 0 && isAttacked(b, k, -side);
  }

  // ---------- evaluation (red positive) ----------
  const VAL = [0, 10000, 30, 45, 85, 400, 100, 10];
  const CENTER = [0, 1, 2, 3, 4, 3, 2, 1, 0]; // file centrality (mid-file highest)
  function pst(type, r, c, red) {
    const adv = red ? (9 - r) : r;            // advancement into enemy camp (0..9)
    switch (type) {
      case P.P: {                             // pawn
        if (adv < 5) return [0, 0, 1, 1, 2, 2, 1, 1, 0][c] * 0; // pre-river ≈ 0
        let v = 4 + adv * 2;                  // crossed river: deeper is better
        v += [3, 2, 1, 1, 0, 1, 1, 2, 3][c];  // central files preferred
        if (adv >= 8) v += 5;                 // near enemy palace
        return v;
      }
      case P.N: {                             // horse
        let v = CENTER[c] + Math.min(adv, 6);
        if ((c === 0 || c === 8) && adv <= 2) v -= 3;   // cornered at home rank
        return v;
      }
      case P.R: {                             // rook
        let v = adv * 2 + Math.floor(CENTER[c] / 2);
        if (adv >= 5) v += 6;                 // deep in enemy camp
        if (adv <= 1) v -= 4;                 // still on home rank (undeveloped)
        return v;
      }
      case P.C: {                             // cannon
        let v = (c === 4 ? 6 : (c === 3 || c === 5 ? 3 : 0)) + Math.min(adv, 4);
        if (adv >= 7) v -= 2;                 // too deep is awkward for a cannon
        return v;
      }
      case P.B: return CENTER[c] * 0.5;       // elephant stays central-ish
      case P.A: return c === 4 ? 2 : 0;       // advisor near king
      case P.K: return (c === 4 && adv <= 1) ? 3 : 0; // king safe at home center
      default: return 0;
    }
  }
  const CHECK_PEN = 45; // being in check (discourages leaving the king exposed)
  function evaluate(b) {
    let s = 0;
    for (let i = 0; i < 90; i++) {
      const c = b[i];
      if (c === 0) continue;
      const r = (i / 9) | 0, col = i % 9;
      const red = c > 0;
      const v = VAL[Math.abs(c)] + pst(Math.abs(c), r, col, red);
      s += red ? v : -v;
    }
    if (inCheck(b, 1)) s -= CHECK_PEN;
    if (inCheck(b, -1)) s += CHECK_PEN;
    return s;
  }

  // ---------- search ----------
  const REP_PEN = 30;   // per extra occurrence beyond 2, charged to the repeating side

  function boardKey(b) { return b.join(''); }
  function makeRepMap(histBoards) {
    const m = new Map();
    for (const bb of histBoards) { const k = boardKey(bb); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }
  function setRep(b, rep) { if (!rep) return; const k = boardKey(b); rep.set(k, (rep.get(k) || 0) + 1); }
  function unsetRep(b, rep) { if (!rep) return; const k = boardKey(b); const c = rep.get(k); if (c <= 1) rep.delete(k); else rep.set(k, c - 1); }

  function moveScore(b, m) {
    let s = VAL[Math.abs(b[m.t])] * 10;
    const pf = Math.abs(b[m.f]);
    if (pf === P.R || pf === P.N || pf === P.C) {
      const fr = (m.f / 9) | 0, fc = m.f % 9, tr = (m.t / 9) | 0, tc = m.t % 9;
      s += Math.abs(tr - fr) + Math.abs(tc - fc);
    }
    return s;
  }
  function orderMoves(b, ms) {
    return ms.map(m => ({ m, s: moveScore(b, m) })).sort((a, z) => z.s - a.s).map(x => x.m);
  }

  function quiesce(b, side, qd, nodes, rep) {
    nodes.n++;
    const stand = evaluate(b);
    if (qd <= 0 || nodes.n > nodes.max) return stand;
    const chk = inCheck(b, side);
    let best = side === 1 ? -Infinity : Infinity;
    let any = false;
    for (const m of legalMoves(b, side)) {
      const cap = b[m.t] !== 0;
      if (!cap && !chk) continue; // extend captures, and checks (when in check)
      any = true;
      const nb = b.slice();
      nb[m.t] = nb[m.f]; nb[m.f] = 0;
      setRep(nb, rep);
      const v = quiesce(nb, -side, qd - 1, nodes, rep);
      unsetRep(nb, rep);
      if (side === 1 ? v > best : v < best) best = v;
    }
    if (!any) return stand;
    return side === 1 ? Math.max(best, stand) : Math.min(best, stand);
  }

  function search(b, side, depth, alpha, beta, qDepth, nodes, rep) {
    nodes.n++;
    if (nodes.n > nodes.max) return evaluate(b);
    if (depth <= 0) return quiesce(b, side, qDepth, nodes, rep);
    const legal = legalMoves(b, side);
    if (legal.length === 0) return inCheck(b, side) ? (side === 1 ? -99999 + depth : 99999 - depth) : 0;
    let best = side === 1 ? -Infinity : Infinity;
    for (const m of orderMoves(b, legal)) {
      const nb = b.slice();
      nb[m.t] = nb[m.f]; nb[m.f] = 0;
      setRep(nb, rep);
      const v = search(nb, -side, depth - 1, alpha, beta, qDepth, nodes, rep);
      const cnt = rep ? (rep.get(boardKey(nb)) || 0) : 2;
      unsetRep(nb, rep);
      let adj = v;
      if (cnt >= 3) {                       // this move recreates a known position: charge the mover
        const pen = REP_PEN * (cnt - 2);
        adj = side === 1 ? v - pen : v + pen;
      }
      if (side === 1) { if (adj > best) best = adj; if (best > alpha) alpha = best; }
      else { if (adj < best) best = adj; if (best < beta) beta = best; }
      if (beta <= alpha) break;
    }
    return best;
  }

  // Iterative deepening: each depth gets a fresh node budget; only the DEEPEST
  // fully-completed iteration is trusted. Deeper levels therefore always play at
  // least as well as shallower ones (no more "harder level hits its node cap and
  // degrades to static-eval noise").
  function think(b, side, depth, qDepth, maxNodes, randomness, repMap) {
    const legal = legalMoves(b, side);
    if (legal.length === 0) return null;
    const ordered = orderMoves(b, legal);
    let bestCands = null, totalNodes = 0;
    for (let d = 1; d <= depth; d++) {
      const nodes = { n: 0, max: maxNodes };
      const cands = [];
      let aborted = false;
      for (const m of ordered) {
        if (nodes.n > nodes.max) { aborted = true; break; }
        const nb = b.slice();
        nb[m.t] = nb[m.f]; nb[m.f] = 0;
        setRep(nb, repMap);
        const v = search(nb, -side, d - 1, -Infinity, Infinity, qDepth, nodes, repMap);
        unsetRep(nb, repMap);
        cands.push({ m, v });
      }
      totalNodes = nodes.n;
      if (aborted) break;                  // keep previous completed iteration
      bestCands = cands;
    }
    let cands = bestCands;
    if (!cands) {                          // even depth 1 didn't complete: fall back to static eval
      cands = ordered.map(m => {
        const nb = b.slice(); nb[m.t] = nb[m.f]; nb[m.f] = 0;
        return { m, v: evaluate(nb) };
      });
    }
    const bestV = side === 1 ? Math.max(...cands.map(x => x.v)) : Math.min(...cands.map(x => x.v));
    // pick among near-best moves: randomness=0 still breaks ties randomly so the
    // same position never yields the same move twice (kills the "AI plays identically
    // every game" predictability). Higher randomness widens the pool.
    const tol = Math.max(randomness, 3);
    const near = cands.filter(x => Math.abs(x.v - bestV) <= tol);
    const pick = near[(Math.random() * near.length) | 0];
    return { move: pick.m, score: bestV, nodes: totalNodes };
  }

  // ---------- handicap (let pieces — removed from the AI's side at start) ----------
  const HANDICAPS = {
    none:   { label: '不让子', remove: [] },
    pao2:   { label: '让双炮', remove: [P.C, P.C] },
    ma2:    { label: '让双马', remove: [P.N, P.N] },
    che1:   { label: '让单车', remove: [P.R] },
    chepao: { label: '让车+炮', remove: [P.R, P.C] },
  };

  function applyHandicap(b, key, aiSide) {
    const nb = b.slice();
    const spec = HANDICAPS[key];
    if (!spec || key === 'none') return nb;
    for (const p of spec.remove) {
      let removed = 0;
      for (let i = 0; i < 90 && removed < 2; i++) {
        if (nb[i] === aiSide * p) { nb[i] = 0; removed++; }
      }
    }
    return nb;
  }

  function removeAt(b, idxs) {
    const nb = b.slice();
    for (const i of idxs) nb[i] = 0;
    return nb;
  }

  // ---------- notation (Chinese standard: 炮二平五 / 马8进7) ----------
  // file numbering: each side numbers files from its OWN right to left.
  //   red sits at bottom: col8=一 ... col0=九  => fileNo(c)=CN[8-c]
  //   black sits at top:  col0=1 ... col8=9    => fileNo(c)=c+1
  function toNotation(b, m, side) {
    const fr = (m.f / 9) | 0, fc = m.f % 9;
    const tr = (m.t / 9) | 0, tc = m.t % 9;
    const red = side === 1;
    const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const fileNo = (c) => (red ? CN[8 - c] : String(c + 1));
    // advance/retreat word: red advancing = moving up-board, black advancing = down-board
    const dirWord = () => ((tr - fr) * (red ? -1 : 1) > 0 ? '进' : '退');
    // disambiguation 前/后 when another same-type piece shares the file
    let prefix = '';
    for (let i = 0; i < 90; i++) {
      if (i === m.f) continue;
      const p = b[i];
      if (p !== 0 && sideOf(p) === side && Math.abs(p) === Math.abs(b[m.f]) && i % 9 === fc) {
        prefix = ((i / 9) | 0) < fr ? '前' : '后'; // our piece is ahead of it => 前
        break;
      }
    }
    const piece = pieceName(b[m.f]);
    if (fc === tc) {
      // vertical move — straight-line pieces: 进/退 + number of squares
      const n = Math.abs(tr - fr);
      return prefix + piece + fileNo(fc) + dirWord() + (red ? CN[n - 1] : String(n));
    } else if (tr === fr) {
      // purely lateral: 平 + target file
      return prefix + piece + fileNo(fc) + '平' + fileNo(tc);
    } else {
      // diagonal / L-shape (horse, elephant, advisor): 进/退 + target file
      return prefix + piece + fileNo(fc) + dirWord() + fileNo(tc);
    }
  }

  // ---------- game state ----------
  class Game {
    constructor(handicap = 'none', aiSide = -1) {
      this.board = initialBoard();
      if (handicap && handicap !== 'none') this.board = applyHandicap(this.board, handicap, aiSide);
      this.side = 1; // red always moves first
      this.history = [];
    }
    static fromBoard(board) { const g = new Game(); g.board = board.slice(); return g; }
    legalMoves() { return legalMoves(this.board, this.side); }
    inCheck() { return inCheck(this.board, this.side); }
    checkmate() { return this.legalMoves().length === 0 && this.inCheck(); }
    stalemate() { return this.legalMoves().length === 0 && !this.inCheck(); }
    move(m) {
      const mv = this.legalMoves().find(x => x.f === m.f && x.t === m.t);
      if (!mv) return null;
      const notation = toNotation(this.board, mv, this.side);
      const captured = this.board[mv.t];
      const nb = this.board.slice();
      nb[mv.t] = nb[mv.f]; nb[mv.f] = 0;
      this.history.push({ board: this.board, side: this.side, move: mv, notation });
      this.board = nb;
      this.side = -this.side;
      return { ok: true, notation, captured };
    }
    undo() {
      const h = this.history.pop();
      if (!h) return null;
      this.board = h.board;
      this.side = h.side;
      return h;
    }
    aiMove(depth, qDepth, maxNodes, randomness) {
      const repMap = makeRepMap(this.history.map(h => h.board));
      const t = think(this.board, this.side, depth, qDepth, maxNodes, randomness, repMap);
      if (!t) return null;
      const notation = toNotation(this.board, t.move, this.side);
      const captured = this.board[t.move.t];
      const nb = this.board.slice();
      nb[t.move.t] = nb[t.move.f]; nb[t.move.f] = 0;
      this.history.push({ board: this.board, side: this.side, move: t.move, notation });
      this.board = nb;
      this.side = -this.side;
      return { notation, score: t.score, nodes: t.nodes };
    }
  }

  const LEVELS = [
    { name: '入门', depth: 2, qDepth: 0, maxNodes: 1500,  randomness: 45 },
    { name: '业余', depth: 3, qDepth: 1, maxNodes: 6000,  randomness: 18 },
    { name: '进阶', depth: 4, qDepth: 2, maxNodes: 25000, randomness: 0 },
    { name: '高手', depth: 6, qDepth: 3, maxNodes: 120000, randomness: 0 },
    { name: '大师', depth: 7, qDepth: 3, maxNodes: 400000, randomness: 0 },
  ];

  return { P, NAME_RED, NAME_BLK, initialBoard, genPseudo, legalMoves, inCheck, isAttacked, findKing, evaluate, think, Game, LEVELS, HANDICAPS, pieceName, toNotation, applyHandicap, removeAt, sideOf };
});
