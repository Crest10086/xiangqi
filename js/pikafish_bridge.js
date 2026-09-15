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
  // 高手(idx3)/大师(idx4) 用 Pikafish；movetime 越大越强（WASM 单线程约 20 万 nps）
  var HEAVY = [3, 4];
  var MILLIS = { 3: 800, 4: 2500 };
  var WORKER_PATH = 'js/engines/pikafish/pikafish.worker.js';

  var worker = null, ready = false, seq = 0, curCb = null, curReject = null, loadPromise = null;

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
      " if(d.type==='SEARCH'){var req={fen:d.fen,movetime:d.movetime||500,seq:d.seq};",
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
      else if (d.type === 'ERROR') {
        if (curReject) { var r = curReject; curReject = null; curCb = null; r(new Error(d.message)); }
      } else if (d.type === 'BEST_MOVE') {
        if (curCb) { var cb = curCb; curCb = null; curReject = null; cb(d.move); }
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

  function search(fen, movetime) {
    return new Promise(function (resolve, reject) {
      if (!worker || !ready) { reject(new Error('not-ready')); return; }
      seq++;
      curCb = resolve; curReject = reject;
      worker.postMessage({ type: 'SEARCH', fen: fen, movetime: movetime, seq: seq, allowChase: false });
      setTimeout(function () {
        if (curCb) { var cb = curCb; curCb = null; curReject = null; cb('__timeout__'); }
      }, (movetime || 500) + 15000);
    });
  }

  function stop() {
    if (worker) { try { worker.postMessage({ type: 'STOP' }); } catch (e) {} }
    curCb = null; curReject = null;
  }

  root.PF = {
    HEAVY_LEVELS: HEAVY,
    MILLIS: MILLIS,
    isHeavyLevel: function (i) { return HEAVY.indexOf(i) >= 0; },
    boardToFen: boardToFen,
    parseMove: parseMove,
    load: load,
    whenReady: whenReady,
    search: search,
    stop: stop,
    ready: function () { return ready; }
  };
})(typeof window !== 'undefined' ? window : this);