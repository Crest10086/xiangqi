/* pikafish_bridge.js — 把预编译 Pikafish WASM 引擎接入本页面的桥接层
 * 高手/大师档用它（NNUE 神经网络，远强于内置 JS 引擎），入门~进阶档用内置引擎保持快。
 * 两条加载路径：
 *   - 原生 Worker（http(s)/Pages 部署）：直接 new Worker('js/engines/pikafish/pikafish.worker.js')
 *   - Blob Worker（file:// 单文件）：wasm/data/胶水以 base64 内嵌（PF_WASM_B64 等全局），
 *     运行时构造自包含 Blob，绕开 file:// 的 Worker/文件访问限制。
 * 对外接口：PF_HEAVY_LEVELS / PF_MILLIS / PF.isHeavyLevel / PF.load / PF.whenReady / PF.search / PF.stop
 */
(function (root) {
  'use strict';
  // 业余/进阶/高手/大师(idx1-4) 用 Pikafish（入门 idx0 用内置引擎），movetime 越大越强
  var HEAVY = [1, 2, 3, 4];
  // 强度梯度靠"思考时间 + 候选随机"两旋钮；开局库只给大师档（见 index.html）
  var MILLIS = { 1: 50, 2: 150, 3: 200, 4: 6000 };
  // MultiPV 在这个 WASM 构建里只产出 1 条 PV(实测), 拿不到候选池 -> 失误率改用引擎原生 UCI_Elo 限制
  var MULTIPV = {};
  var UCI_EXTRA = {
    1: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1400 }],
    2: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1800 }],
    3: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 2400 }]
  };
  var WORKER_PATH = 'js/engines/pikafish/pikafish.worker.js';

  var worker = null, ready = false, seq = 0, curSeq = 0, curCb = null, curReject = null, loadPromise = null, curCandidates = null;

  // ---- board[] -> XQWLight FEN（row0=黑底线在上，大写=红/小写=黑）----
  function boardToFen(board, side) {
    var MAP = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
    var out = '';
    for (var r = 0; r < 10; r++) {
      var empty = 0;
      for (var c = 0; c < 9; c++) {
        var v = board[r * 9 + c];
        if (v === 0) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += (v > 0 ? MAP[v] : MAP[-v].toLowerCase());
      }
      if (empty) out += empty;
      if (r < 9) out += '/';
    }
    return out + ' ' + (side === 1 ? 'w' : 'b') + ' - - 0 1';
  }

  // ---- 着法 "h2e2" -> {f,t}（字母 a-i=col0-8，数字 0-9=row9-0）----
  function parseMove(s) {
    var m = /^\s*([a-i])([0-9])-?([a-i])([0-9])\s*$/.exec(s);
    if (!m) return null;
    var fc = m[1].charCodeAt(0) - 97, fr = 9 - (+m[2]);
    var tc = m[3].charCodeAt(0) - 97, tr = 9 - (+m[4]);
    return { f: fr * 9 + fc, t: tr * 9 + tc };
  }

  // ---- 原生 Worker（部署版）----
  function spawnNative() {
    worker = new Worker(WORKER_PATH);
    attach(worker);
    worker.postMessage({ type: 'INIT' });
  }

  // ---- Blob Worker（单文件版，base64 内嵌）----
  function spawnBlob() {
    var b64ToU8 = "function b64ToU8(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}";
    var src = [
      "var WASM_B64='" + PF_WASM_B64 + "';",
      "var DATA_B64='" + PF_DATA_B64 + "';",
      "var ENGINE_SRC=" + JSON.stringify(PF_ENGINE_JS) + ";",
      b64ToU8,
      "var __dataBuf=b64ToU8(DATA_B64).buffer;",
      "(0,eval)(ENGINE_SRC);",
      "var engine=null,lastSeq=0,pendingSearch=null,stopPending=false,engineSearching=false;",
      "function postErr(m){self.postMessage({type:'ERROR',message:m});}",
      "function runSearch(d){if(!engine||!d||!d.fen)return;engineSearching=true;lastSeq=d.seq||lastSeq;",
      " try{var fen=(d.fen.indexOf(' - ')<0)?d.fen+' - - 0 1':d.fen;",
      "  engine.sendCommand('setoption name Repetition Rule value AsianRule');",
      "  engine.sendCommand('setoption name Draw Rule value None');",
      "  engine.sendCommand('setoption name Sixty Move Rule value false');",
      "  engine.sendCommand('setoption name MultiPV value ' + (d.multipv > 1 ? d.multipv : 1));",
      "  if(d.extra&&d.extra.length){for(var oi=0;oi<d.extra.length;oi++)engine.sendCommand('setoption name '+d.extra[oi].name+' value '+d.extra[oi].value);}else engine.sendCommand('setoption name UCI_LimitStrength value false');",
      "  engine.sendCommand('position fen '+fen);engine.sendCommand('go movetime '+(d.movetime||500));}",
      " catch(err){engineSearching=false;postErr('皮卡鱼搜索失败: '+err);}}",
      "function drainPending(){if(pendingSearch&&engine&&!engineSearching){var q=pendingSearch;pendingSearch=null;runSearch(q);}}",
      "function onOut(line){line=String(line||'').replace(/[\\r\\n]+$/,'');if(!line)return;",
      " if(line.indexOf('uciok')>=0){self.postMessage({type:'READY'});drainPending();}",
      " else if(line.indexOf('bestmove')===0){engineSearching=false;",
      "  if(stopPending){stopPending=false;drainPending();return;}",
      "  var p=line.split(/\\s+/);self.postMessage({type:'BEST_MOVE',move:(p.length>1?p[1]:''),seq:lastSeq});drainPending();}}",
      "self.onmessage=function(e){var d=e.data||{};",
      " if(d.type==='STOP'){pendingSearch=null;if(engineSearching){stopPending=true;}try{if(engine){engine.sendCommand('stop');}}catch(e0){}return;}",
      " if(d.type==='SEARCH'){var req={fen:d.fen,movetime:d.movetime||500,seq:d.seq,multipv:d.multipv,extra:d.extra};",
      "  if(!engine){pendingSearch=req;return;}",
      "  if(engineSearching){pendingSearch=req;stopPending=true;try{engine.sendCommand('stop');}catch(e1){}return;}",
      "  runSearch(req);}}",
      "try{",
      " var cfg={locateFile:function(p){return p;},wasmBinary:b64ToU8(WASM_B64),",
      "  getPreloadedPackage:function(n,s){return __dataBuf;},",
      "  onReceiveStdout:onOut,onReceiveStderr:function(){},onExit:function(){}};",
      " Pikafish(cfg).then(function(mod){engine=mod;try{mod.sendCommand('setoption name Hash value 256');mod.sendCommand('uci');}catch(e2){postErr('皮卡鱼初始化失败: '+e2);}})",
      "  .catch(function(err){postErr('皮卡鱼加载失败: '+err);});",
      "}catch(err){postErr('皮卡鱼加载失败: '+err);}"
    ].join("\n");
    var blob = new Blob([src], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
    attach(worker);
    worker.postMessage({ type: 'INIT' });
  }

  function attach(w) {
    w.onmessage = function (ev) {
      var d = ev.data || {};
      if (d.type === 'READY') { ready = true; }
      else if (d.type === 'INFO') {
        // 捕获搜索 INFO 行：depth / score cp|mate（供基准测试读取）
        var s = String(d.info || '');
        root.PF.lastRawLine = s; // 诊断用: 最近一条 UCI info 原文
        if (s.indexOf('depth ') >= 0) {
          var md = /depth (\d+)/.exec(s);
          var ms = /score (cp|mate) (-?\d+)/.exec(s);
          var mn = /nodes (\d+)/.exec(s);
          if (md) { root.PF.lastInfo = { depth: +md[1], score: ms ? (ms[1] === 'cp' ? (+ms[2]) + 'cp' : '#' + ms[2]) : '', nodes: mn ? +mn[1] : 0 }; }
        }
        if (curCandidates) {
          // MultiPV 候选收集: multipv K + 该层最新 score/pv
          var mp = /multipv (\d+)/.exec(s), pv = / pv (\S+)/.exec(s), dp = /depth (\d+)/.exec(s), sc = /score (cp|mate) (-?\d+)/.exec(s);
          if (mp && pv) {
            var kk = +mp[1], scv = sc ? (sc[1] === 'mate' ? (sc[2] > 0 ? 99999 : -99999) : +sc[2]) : 0, dpv = dp ? +dp[1] : 0;
            if (!curCandidates[kk] || curCandidates[kk].depth <= dpv) curCandidates[kk] = { move: pv[1], score: scv, depth: dpv };
          }
        }
      } else if (d.type === 'CMD') {
        root.PF.lastCommands = d.cmds; // 诊断: 本次搜索实际下发的强度选项
      } else if (d.type === 'ERROR') {
        if (curReject && curSeq) { var r = curReject; curReject = null; curCb = null; r(new Error(d.message)); }
      } else if (d.type === 'BEST_MOVE') {
        // seq 校验：丢弃过期着法（防止旧搜索的迟到响应劫持新搜索）
        if (curCb && (d.seq === undefined || d.seq === curSeq)) {
          var cb = curCb; curCb = null; curReject = null;
          var cands = null;
          if (curCandidates) { cands = []; for (var k = 1; k <= 64; k++) { if (curCandidates[k]) cands.push(curCandidates[k]); } }
          curCandidates = null;
          cb({ move: d.move, candidates: cands });
        }
      }
    };
    w.onerror = function (ev) {
      if (curReject) { var r = curReject; curReject = null; curCb = null; r(new Error((ev && ev.message) || '引擎线程异常')); }
    };
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      if (ready) { resolve(); return; }
      if (worker) {
        // worker 已创建但尚未 READY：轮询等待
        var iv = setInterval(function () { if (ready) { clearInterval(iv); resolve(); } }, 50);
        setTimeout(function () { clearInterval(iv); reject(new Error('皮卡鱼加载超时')); }, 45000);
        return;
      }
      try {
        if (location.protocol === 'file:' || root.PF_FORCE_BLOB) {
          if (typeof PF_WASM_B64 === 'string' && PF_WASM_B64.length) spawnBlob();
          else reject(new Error('单文件版缺少内嵌引擎数据'));
        } else {
          spawnNative();
        }
      } catch (e) { reject(e); return; }
      var t = setTimeout(function () { reject(new Error('皮卡鱼加载超时')); }, 45000);
      var prev = worker.onmessage;
      worker.onmessage = function (ev) {
        if (ev.data && ev.data.type === 'READY') { clearTimeout(t); worker.onmessage = prev; ready = true; resolve(); }
        else prev(ev);
      };
    });
    return loadPromise;
  }

  function whenReady() {
    return load().then(function () { return true; }).catch(function () { return false; });
  }

  function search(fen, movetime, multipv, extra) {
    return new Promise(function (resolve, reject) {
      if (!worker || !ready) { reject(new Error("not-ready")); return; }
      var mySeq = ++seq;
      curSeq = mySeq;
      var done = false; // 每次搜索独立的完成标志（修复：残留超时误杀后续搜索）
      curCandidates = multipv > 1 ? {} : null;
      curCb = function (val) { if (!done) { done = true; resolve(val); } };
      curReject = null;
      worker.postMessage({ type: "SEARCH", fen: fen, movetime: movetime, seq: mySeq, allowChase: false, multipv: multipv || 1, extra: extra || null });
      setTimeout(function () {
        if (done) return;
        done = true;
        if (curSeq === mySeq) { curCb = null; curReject = null; }
        resolve({ move: '__timeout__', candidates: null });
      }, (movetime || 500) + 15000);
    });
  }

  function stop() {
    if (worker) { try { worker.postMessage({ type: 'STOP' }); } catch (e) {} }
    curSeq = 0;
    curCb = null; curReject = null;
  }

  root.PF = {
    HEAVY_LEVELS: HEAVY,
    MILLIS: MILLIS,
    MULTIPV: MULTIPV,
    UCI_EXTRA: UCI_EXTRA,
    isHeavyLevel: function (i) { return HEAVY.indexOf(i) >= 0; },
    boardToFen: boardToFen,
    parseMove: parseMove,
    load: load,
    whenReady: whenReady,
    search: search,
    stop: stop,
    lastInfo: null,
    ready: function () { return ready; }
  };
})(typeof window !== 'undefined' ? window : this);