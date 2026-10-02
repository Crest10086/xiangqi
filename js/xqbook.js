/* xqbook.js — 中国象棋开局库查询模块
 * 数据源: book.js (XiangQi Wizard Light, Copyright (C) 2004-2012 www.xqbase.com, GPL-3.0)
 * 功能: 用 XQWLight 同款 ZobristLock 对当前局面查开局谱, 加权随机返回着法。
 * 已实证 (book_probe):
 *   坐标映射 x=col+3, y=3+row, sq = x + (y<<4)
 *   lock 规则: 黑先(side=-1) XOR player key, 红先不 XOR
 *   镜像 = col→8-col (mirror 命中时着法同样做 col→8-col)
 *   初始局面命中 16 个谱着法, 炮八平五后命中, 不 XOR 必 miss
 * 接口: XQBook.pick(board, side, legalList) -> {f,t} | null
 *   board: 90 元素数组 (row0=黑底线), side: 1=红先 / -1=黑先
 *   legalList: [{f,t}...] 当前合法着法 (用于过滤谱着法)
 */
(function (root) {
  'use strict';

  // ---- RC4 (照抄 XQWLight position.js) ----
  function RC4(key) {
    this.x = this.y = 0;
    this.state = [];
    for (var i = 0; i < 256; i++) this.state.push(i);
    var j = 0;
    for (var i = 0; i < 256; i++) {
      j = (j + this.state[i] + key[i % key.length]) & 0xff;
      var t = this.state[i]; this.state[i] = this.state[j]; this.state[j] = t;
    }
  }
  RC4.prototype.nextByte = function () {
    this.x = (this.x + 1) & 0xff;
    this.y = (this.y + this.state[this.x]) & 0xff;
    var t = this.state[this.x]; this.state[this.x] = this.state[this.y]; this.state[this.y] = t;
    return this.state[(this.state[this.x] + this.state[this.y]) & 0xff];
  };
  RC4.prototype.nextLong = function () {
    var n0 = this.nextByte(), n1 = this.nextByte(), n2 = this.nextByte(), n3 = this.nextByte();
    return n0 + (n1 << 8) + (n2 << 16) + ((n3 << 24) & 0xffffffff);
  };

  // ---- Zobrist Lock 表初始化 (顺序与 position.js 完全一致, 已实证命中) ----
  var rc4 = new RC4([0]);
  rc4.nextLong();                 // keyPlayer (不使用)
  rc4.nextLong();                 // skip
  var LOCK_PLAYER = rc4.nextLong();
  var LockTable = [];
  for (var i = 0; i < 14; i++) {
    var locks = [];
    for (var j = 0; j < 256; j++) {
      rc4.nextLong();             // key (不使用)
      rc4.nextLong();             // skip
      locks.push(rc4.nextLong()); // lock
    }
    LockTable.push(locks);
  }

  // ---- 局面 lock 计算 ----
  // pcAdjust: 红=T-1 (0..6), 黑=T+6 (7..13);  T: 1将2士3象4马5车6炮7兵
  function lockOf(board, mirrored, xorPlayer) {
    var lock = 0;
    for (var i = 0; i < 90; i++) {
      var v = board[i];
      if (v === 0) continue;
      var T = v > 0 ? v : -v;
      var pa = v > 0 ? T - 1 : T + 6;
      var col = i % 9, row = (i / 9) | 0;
      if (mirrored) col = 8 - col;
      lock ^= LockTable[pa][(col + 3) + ((3 + row) << 4)];
    }
    if (xorPlayer) lock ^= LOCK_PLAYER;
    return lock >>> 1;
  }

  // ---- 二分查找 (照抄) ----
  function binarySearch(vlss, vl) {
    var low = 0, high = vlss.length - 1;
    while (low <= high) {
      var mid = (low + high) >> 1;
      if (vlss[mid][0] < vl) low = mid + 1;
      else if (vlss[mid][0] > vl) high = mid - 1;
      else return mid;
    }
    return -1;
  }

  // ---- XQWLight mv -> 我的 {f,t} ----
  // mv = src + (dst<<8), src/dst = x + (y<<4), x=col+3, y=3+row
  function mvToMine(mv, mirror) {
    var src = mv & 255, dst = mv >> 8;
    var sc = (src & 15) - 3, sr = (src >> 4) - 3;
    var dc = (dst & 15) - 3, dr = (dst >> 4) - 3;
    if (sc < 0 || sc > 8 || dc < 0 || dc > 8 || sr < 0 || sr > 9 || dr < 0 || dr > 9) return null;
    if (mirror) { sc = 8 - sc; dc = 8 - dc; }
    return { f: sr * 9 + sc, t: dr * 9 + dc };
  }

  function pick(board, side, legalList) {
    if (typeof root.BOOK_DAT !== 'object' || !root.BOOK_DAT || !root.BOOK_DAT.length) return null;
    var book = root.BOOK_DAT;
    var xorPlayer = (side === -1); // 黑先 XOR (已实证)
    var mirror = false;
    var key = lockOf(board, false, xorPlayer);
    var idx = binarySearch(book, key);
    if (idx < 0) {
      mirror = true;
      key = lockOf(board, true, xorPlayer);
      idx = binarySearch(book, key);
      if (idx < 0) return null;
    }
    // 收集同 key 的全部条目
    var start = idx;
    while (start > 0 && book[start - 1][0] === key) start--;
    var mvs = [], vls = [], value = 0;
    for (var k = start; k < book.length && book[k][0] === key; k++) {
      var conv = mvToMine(book[k][1], mirror);
      if (!conv) continue;
      if (!legalList.some(function (m) { return m.f === conv.f && m.t === conv.t; })) continue;
      mvs.push(conv);
      var vl = book[k][2];
      vls.push(vl);
      value += vl;
    }
    if (value <= 0 || mvs.length === 0) return null;
    var r = Math.floor(Math.random() * value);
    for (var i2 = 0; i2 < mvs.length; i2++) {
      r -= vls[i2];
      if (r < 0) return mvs[i2];
    }
    return mvs[mvs.length - 1];
  }

  root.XQBook = { pick: pick };
})(typeof window !== 'undefined' ? window : this);