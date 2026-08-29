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
  const VAL = [0, 10000, 25, 45, 80, 350, 110, 10];
  function evaluate(b) {
    let s = 0;
    for (let i = 0; i < 90; i++) {
      const c = b[i];
      if (c === 0) continue;
      const r = (i / 9) | 0, col = i % 9;
      let v = VAL[Math.abs(c)];
      switch (Math.abs(c)) {
        case P.P: {
          const crossed = c > 0 ? r <= 4 : r >= 5;
          if (crossed) v += Math.min((c > 0 ? 9 - r : r) * 3, 15) + [2, 1, 1, 0, 0, 0, 1, 1, 2][col];
          break;
        }
        case P.R: v += c > 0 ? (r <= 2 ? 8 : 0) : (r >= 7 ? 8 : 0); break;
        case P.N: v += [1, 0, 0, 0, 0, 0, 0, 0, 1][col] * 2 + (c > 0 ? (r <= 3 ? 4 : 0) : (r >= 6 ? 4 : 0)); break;
        case P.C: v += (c > 0 ? (r <= 1 ? 6 : 0) : (r >= 8 ? 6 : 0)) + ([2, 7].includes(col) ? 3 : 0); break;
        case P.K: v += c > 0 ? (r === 9 ? 4 : r === 8 ? 2 : 0) : (r === 0 ? 4 : r === 1 ? 2 : 0); break;
      }
      s += c > 0 ? v : -v;
    }
    return s;
  }

  // ---------- search ----------
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

  function quiesce(b, side, qd, nodes) {
    nodes.n++;
    const stand = evaluate(b);
    if (qd <= 0) return stand;
    let best = side === 1 ? -Infinity : Infinity;
    let any = false;
    for (const m of legalMoves(b, side)) {
      if (b[m.t] === 0) continue; // captures only
      any = true;
      const nb = b.slice();
      nb[m.t] = nb[m.f]; nb[m.f] = 0;
      const v = quiesce(nb, -side, qd - 1, nodes);
      if (side === 1 ? v > best : v < best) best = v;
    }
    if (!any) return stand;
    return side === 1 ? Math.max(best, stand) : Math.min(best, stand);
  }

  function search(b, side, depth, alpha, beta, qDepth, nodes) {
    nodes.n++;
    if (nodes.n > nodes.max) return evaluate(b);
    if (depth <= 0) return quiesce(b, side, qDepth, nodes);
    const legal = legalMoves(b, side);
    if (legal.length === 0) return inCheck(b, side) ? (side === 1 ? -99999 + depth : 99999 - depth) : 0;
    let best = side === 1 ? -Infinity : Infinity;
    for (const m of orderMoves(b, legal)) {
      const nb = b.slice();
      nb[m.t] = nb[m.f]; nb[m.f] = 0;
      const v = search(nb, -side, depth - 1, alpha, beta, qDepth, nodes);
      if (side === 1) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (beta <= alpha) break;
    }
    return best;
  }

  function think(b, side, depth, qDepth, maxNodes, randomness) {
    const nodes = { n: 0, max: maxNodes };
    const legal = legalMoves(b, side);
    if (legal.length === 0) return null;
    let alpha = -Infinity, beta = Infinity;
    let bestV = side === 1 ? -Infinity : Infinity;
    const cands = [];
    for (const m of orderMoves(b, legal)) {
      const nb = b.slice();
      nb[m.t] = nb[m.f]; nb[m.f] = 0;
      const v = search(nb, -side, depth - 1, alpha, beta, qDepth, nodes);
      cands.push({ m, v });
      if (side === 1) { if (v > bestV) bestV = v; if (bestV > alpha) alpha = bestV; }
      else { if (v < bestV) bestV = v; if (bestV < beta) beta = bestV; }
    }
    let pick;
    if (randomness > 0) {
      const near = cands.filter(x => Math.abs(x.v - bestV) <= randomness);
      pick = near[(Math.random() * near.length) | 0];
    } else {
      pick = cands.reduce((a, x) => (side === 1 ? (x.v > a.v ? x : a) : (x.v < a.v ? x : a)), cands[0]);
    }
    return { move: pick.m, score: bestV, nodes: nodes.n };
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
      const t = think(this.board, this.side, depth, qDepth, maxNodes, randomness);
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
    { name: '入门', depth: 1, qDepth: 0, maxNodes: 500,   randomness: 40 },
    { name: '业余', depth: 2, qDepth: 0, maxNodes: 3000,  randomness: 15 },
    { name: '进阶', depth: 3, qDepth: 1, maxNodes: 8000,  randomness: 0 },
    { name: '高手', depth: 4, qDepth: 2, maxNodes: 25000, randomness: 0 },
    { name: '大师', depth: 5, qDepth: 2, maxNodes: 60000, randomness: 0 },
  ];

  return { P, NAME_RED, NAME_BLK, initialBoard, genPseudo, legalMoves, inCheck, isAttacked, findKing, evaluate, think, Game, LEVELS, HANDICAPS, pieceName, toNotation, applyHandicap, removeAt, sideOf };
});
