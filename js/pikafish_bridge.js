/* pikafish_bridge.js — 把 Pikafish WASM 引擎接入本页面的桥接层
 *
 * 两条引擎路径（实测依据见 bench/ENGINE_UPGRADE_FEASIBILITY.md 与 bench/NEW_ENGINE_OPTIONS.md）：
 *   A. 线上/HTTP 部署（Pages）：完整强度构建 js/engines/pikafish/
 *      pikafish.js 80KB + pikafish.wasm 662KB + pikafish.nnue 50.7MB，多线程。
 *      需要 crossOriginIsolated（COOP/COEP）：裸 GitHub Pages 不提供这两个响应头，由根目录
 *      coi-serviceworker.js 注入。未隔离时该构建是 0 线程（DataCloneError），不会退化成单线程，
 *      所以这里在加载前先过 COOP/COEP 闸门（注册 SW + 重载一次，最多两次，之后放弃）。
 *   B. file:// 单文件版：内嵌的旧小网络构建 js/engines/pikafish/legacy/，Blob Worker。
 *      旧构建的 MultiPV 只产出 1 条 PV（实测），拿不到候选池，因此 B 路径沿用定案前的旧参数
 *      （movetime 阶梯 + UCI_Elo），保证单文件版仍然五档可区分；只有 A 路径按定案参数走。
 *
 * 强度阶梯（A 路径）不在本文件里定义：参数由 bench/new_engine/gen_tier_config.js 从
 * bench/new_engine/tier_tiers.json 生成到 js/tier_config.js（PF_TIERS），选着规则是 js/tier_rules.js
 * （与 bench 台架同一份文件）。movetime/Hash 只是每档的固定搜索预算，不是阶梯。
 *
 * 对外接口：PF.isHeavyLevel / PF.load / PF.whenReady / PF.tierSearch / PF.search / PF.stop
 *          PF.boardToFen / PF.parseMove / PF.uciOf / PF.TIERS / PF.lastInfo / PF.lastCost / PF.onProgress
 *          PF.NET_BYTES / PF.netLabel() / PF.loadText(p) —— 引擎下载提示的体积与文案（t_f51aab68 第1项）
 */
(function (root) {
  'use strict';
  var HEAVY = [1, 2, 3, 4];            // 业余/进阶/高手/大师用引擎（入门 idx0 内置引擎，定案：完全不改）
  var WORKER_PATH = 'js/engines/pikafish/pikafish.worker.js';
  var COI_PATH = 'coi-serviceworker.js';
  // B 路径沿用的旧参数（定案前的 movetime 阶梯 + 旧引擎的 UCI_Elo 限制），不是定案参数
  var LEGACY_MILLIS = { 1: 50, 2: 150, 3: 500, 4: 6000 };
  var LEGACY_EXTRA = {
    1: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1400 }],
    2: [{ name: 'UCI_LimitStrength', value: 'true' }, { name: 'UCI_Elo', value: 1800 }]
  };

  var worker = null, ready = false, seq = 0, curSeq = 0, curCb = null, curReject = null;
  var loadPromise = null, curCandidates = null, legacyMode = false, curTierIdx = null, resolveLoad = null;
  var seedBase = (Math.random() * 1e9) | 0;
  // 完整强度构建的强度网络体积（js/engines/pikafish/pikafish.nnue）。UI 的下载提示文案只从这里
  // 生成，别在页面里另写一份数字：改引擎网络时改这一处 + 重跑 test_ui_wiring.js（它会拿磁盘真实
  // 字节数核对这里的常量）。
  var NET_BYTES = 50706378;                 // = 50.7MB（十进制 MB，与仓库文档口径一致）
  var NET_LABEL = '50.7MB';

  function mb(n) { return (n / 1e6).toFixed(1); }

  /* 引擎下载提示文案（t_f51aab68 第1项）：措辞只有这一份，页面侧只负责把它画进面板。
   * p = worker 的 NET_PROGRESS {loaded,total}；p 为空表示"已决定要加载、还没开始收字节"。 */
  function loadText(p) {
    if (!p || !p.loaded) {
      return '正在准备引擎：首次对局需下载 ' + NET_LABEL + ' 强度网络…';
    }
    var total = p.total || NET_BYTES;
    var pct = Math.max(0, Math.min(100, Math.floor(p.loaded * 100 / total)));
    if (p.loaded >= total) {
      return '强度网络已下载完（' + NET_LABEL + '），正在初始化引擎…';
    }
    return '正在下载引擎强度网络 ' + pct + '%（' + mb(p.loaded) + '/' + mb(total) + 'MB），只需一次，之后走缓存';
  }

  function tierOf(i) {
    var T = root.PF_TIERS && root.PF_TIERS.levels;
    return (T && T[i]) || null;
  }
  function isBlobMode() { return location.protocol === 'file:' || root.PF_FORCE_BLOB; }

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
    // halfmove 恒为 0：新引擎对 halfmove>=120 的 FEN 直接拒收（Rule60 counter out of range），
    // 60 回合判罚由前端自己算。
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

  // ---- {f,t} -> UCI "h2e2"（与 bench 台架同一口径：先起点后终点）----
  function uciOf(m) {
    return String.fromCharCode(97 + (m.f % 9)) + (9 - ((m.f / 9) | 0)) +
           String.fromCharCode(97 + (m.t % 9)) + (9 - ((m.t / 9) | 0));
  }

  // ---- COOP/COEP 闸门：未隔离时先让 coi-serviceworker 接管并重载一次 ----
  // 注意顺序：未隔离时浏览器根本不提供 SharedArrayBuffer（实测 headless Chrome: coi=false sab=false），
  // 所以不能拿"SAB 不存在"当"不需要重载"的理由——那正是 SW 要解决的问题。
  function ensureIsolated() {
    return new Promise(function (resolve) {
      if (root.crossOriginIsolated === true) { resolve(true); return; }
      if (!window.isSecureContext || !navigator.serviceWorker) { resolve(false); return; }
      var tries = +(sessionStorage.getItem('coiTries') || 0);
      if (tries >= 2) { resolve(false); return; } // 重载过两次仍不隔离：不再循环
      sessionStorage.setItem('coiTries', String(tries + 1));
      var scope = new URL('./', document.baseURI).href;
      var swUrl = new URL(COI_PATH, document.baseURI).href;
      navigator.serviceWorker.getRegistration(scope).then(function (reg) {
        return reg || navigator.serviceWorker.register(swUrl, { scope: scope });
      }).then(function (reg) {
        // SW 注册成功但还没接管本页时，重载一次才会带上 COOP/COEP 头
        location.reload();
      }).catch(function () { resolve(false); });
    });
  }

  // ---- 原生 Worker（线上/HTTP 部署，完整强度构建）----
  function spawnNative() {
    var t = tierOf(4);
    worker = new Worker(WORKER_PATH);
    attach(worker);
    var hc = navigator.hardwareConcurrency || 2;
    worker.postMessage({ type: 'INIT', threads: Math.max(1, Math.min(4, hc)), hash: (t && t.hash) || 64 });
  }

  // ---- Blob Worker（单文件版，内嵌旧小网络构建）----
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
      if (d.type === 'READY') {
        ready = true;
        root.PF.lastCost = Object.assign({}, root.PF.lastCost, { readyAt: Math.round(performance.now()) });
      } else if (d.type === 'ENV') {
        root.PF.env = d; // 诊断: crossOriginIsolated / SAB / 实际线程数
      } else if (d.type === 'NET_PROGRESS') {
        root.PF.netProgress = d;
        if (typeof root.PF.onProgress === 'function') { try { root.PF.onProgress(d); } catch (e) {} }
      } else if (d.type === 'NET_WRITTEN') {
        root.PF.lastCost = Object.assign({}, root.PF.lastCost, { netBytes: d.bytes });
      } else if (d.type === 'INFO') {
        // 捕获搜索 INFO 行：depth / score cp|mate / nodes（供基准与设备自检页读取）
        var s = String(d.info || '');
        root.PF.lastRawLine = s; // 诊断用: 最近一条 UCI info 原文
        if (s.indexOf('CRITICAL ERROR') >= 0) root.PF.lastCritical = s; // 引擎原文（诊断）
        if (s.indexOf('depth ') >= 0) {
          var md = /depth (\d+)/.exec(s);
          var ms = /score (cp|mate) (-?\d+)/.exec(s);
          var mn = /nodes (\d+)/.exec(s);
          if (md) { root.PF.lastInfo = { depth: +md[1], score: ms ? (ms[1] === 'cp' ? (+ms[2]) + 'cp' : '#' + ms[2]) : '', nodes: mn ? +mn[1] : 0 }; }
        }
        if (curCandidates) {
          // MultiPV 候选收集: multipv K + 该层最新 score/pv（与 bench 台架同一口径）
          var mp = /multipv (\d+)/.exec(s), pv = / pv (\S+)/.exec(s), dp = /depth (\d+)/.exec(s), sc = /score (cp|mate) (-?\d+)/.exec(s);
          if (mp && pv) {
            var kk = +mp[1];
            var scv = sc ? (sc[1] === 'mate' ? (sc[2] > 0 ? 100000 - 100 * (+sc[2]) : -100000 + 100 * (+sc[2])) : +sc[2]) : 0;
            var dpv = dp ? +dp[1] : 0;
            if (!curCandidates[kk] || curCandidates[kk].depth <= dpv) curCandidates[kk] = { score: scv, pv: pv[1].trim().split(/\s+/), depth: dpv };
          }
        }
      } else if (d.type === 'CRITICAL') {
        root.PF.lastCritical = d.info;
        // 硬约束（bench/NEW_ENGINE_OPTIONS.md 1.3 末行）：非法 position 后引擎不重置局面，
        // 会沿用上一条有效局面出着。这种着法必须当场作废。只作废它自己的那次搜索（seq 匹配），
        // 迟到的 CRITICAL 不会误杀已经正常开始的下一次搜索。
        if (curReject && curSeq && d.seq === curSeq) {
          var rj = curReject; curCb = null; curReject = null;
          var err = new Error('引擎报告 CRITICAL ERROR（着法会沿用上一条局面）');
          err.kind = 'critical';
          rj(err);
        }
      } else if (d.type === 'CMD') {
        root.PF.lastCommands = d.cmds; // 诊断: 本次搜索实际下发的强度选项
      } else if (d.type === 'ERROR') {
        root.PF.lastError = d.message;
        if (curReject && curSeq) { var r = curReject; curReject = null; curCb = null; r(new Error(d.message)); }
      } else if (d.type === 'BEST_MOVE') {
        // seq 校验：丢弃过期着法（防止旧搜索的迟到响应劫持新搜索）
        if (curCb && (d.seq === undefined || d.seq === curSeq)) {
          var cb = curCb; curCb = null; curReject = null;
          var cands = null;
          if (curCandidates) { cands = []; for (var k = 1; k <= 64; k++) { if (curCandidates[k]) cands.push(curCandidates[k]); } }
          curCandidates = null;
          cb({ move: d.move, candidates: cands, critical: !!d.critical });
        }
      }
    };
    w.onerror = function (ev) {
      root.PF.lastError = (ev && ev.message) || '引擎线程异常';
      if (curReject) { var r = curReject; curReject = null; curCb = null; r(new Error(root.PF.lastError)); }
    };
  }

  function watchReady(reject) {
    var t = setTimeout(function () { reject(new Error('皮卡鱼加载超时')); }, 90000);
    var prev = worker.onmessage;
    worker.onmessage = function (ev) {
      if (ev.data && ev.data.type === 'READY') { clearTimeout(t); worker.onmessage = prev; ready = true; resolveLoad(); }
      else prev(ev);
    };
    var prevErr = worker.onerror;
    worker.onerror = function (ev) { prevErr(ev); clearTimeout(t); reject(new Error((ev && ev.message) || '引擎线程异常')); };
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      if (ready) { resolve(); return; }
      resolveLoad = resolve;
      if (worker) { watchReady(reject); return; } // 已创建但尚未 READY：继续轮询
      try {
        if (isBlobMode()) {
          legacyMode = true;
          if (typeof PF_WASM_B64 === 'string' && PF_WASM_B64.length) { spawnBlob(); watchReady(reject); }
          else reject(new Error('单文件版缺少内嵌引擎数据'));
          return;
        }
      } catch (e) { reject(e); return; }
      // A 路径：先过 COOP/COEP 闸门（可能触发一次页面重载），再加载 50.7MB 网络
      ensureIsolated().then(function (iso) {
        if (!iso) { reject(new Error('浏览器未隔离，多线程引擎不可用')); return; }
        // 下载还没开始（要等 worker 起线程、fetch 建连）也要先给 UI 一句话：
        // 用户点"新对局"到第一个字节之间本来就有 1–2 秒空窗，没有提示就像卡死了。
        if (typeof root.PF.onProgress === 'function') { try { root.PF.onProgress(null); } catch (e) {} }
        try { spawnNative(); } catch (e) { reject(e); return; }
        watchReady(reject);
      });
    });
    return loadPromise;
  }

  function whenReady() {
    return load().then(function () { return true; }).catch(function () { return false; });
  }

  // 低层搜索（基准页 / perf_probe 用）：签名与旧版一致
  function search(fen, movetime, multipv, extra) {
    return new Promise(function (resolve, reject) {
      if (!worker || !ready) { reject(new Error("not-ready")); return; }
      var mySeq = ++seq;
      curSeq = mySeq;
      var done = false; // 每次搜索独立的完成标志（修复：残留超时误杀后续搜索）
      curCandidates = multipv > 1 ? {} : null;
      curCb = function (val) { if (!done) { done = true; resolve(val); } };
      // 引擎侧错误（初始化失败 / CRITICAL ERROR）必须当场 reject：不接上 reject 的话
      // 只能等超时兜底，白等 20 秒才回退内置引擎。
      curReject = function (err) { if (!done) { done = true; reject(err); } };
      var t = tierOf(curTierIdx);
      worker.postMessage({
        type: "SEARCH", fen: fen, movetime: movetime, seq: mySeq, multipv: multipv || 1,
        extra: extra || null, hash: (t && t.hash) || 64
      });
      setTimeout(function () {
        if (done) return;
        done = true;
        if (curSeq === mySeq) { curCb = null; curReject = null; }
        resolve({ move: '__timeout__', candidates: null });
      }, (movetime || 300) + 20000);
    });
  }

  /* 按档搜索 + 按档选着（定案契约在生产代码里的唯一落点：参数 PF_TIERS + 规则 js/tier_rules.js）。
   * ctx: { legal: [{f,t}...], ply: int, seed?: int } —— group 按定标口径由 ply 决定（ply<=8 记 opening）。
   * resolve({ move, hit, gap, cfg })；失败 reject(Error)，kind = 'timeout' | 'critical'。 */
  function tierSearch(i, fen, ctx) {
    var cfg = tierOf(i);
    if (!cfg) return Promise.reject(new Error('该档没有参数'));
    curTierIdx = i;
    var multipv = cfg.multipv || 1, movetime = cfg.movetime || 300, extra = null;
    if (legacyMode) { // 旧构建只出 1 条 PV（实测）：候选池不可用，退回旧旋钮
      movetime = LEGACY_MILLIS[i] || movetime;
      multipv = 1;
      extra = LEGACY_EXTRA[i] || null;
    }
    return search(fen, movetime, multipv, extra).then(function (out) {
      if (!out || out.move === '__timeout__') { var e = new Error('搜索超时'); e.kind = 'timeout'; throw e; }
      if (out.critical) { var ec = new Error('引擎报告 CRITICAL ERROR（着法沿用了上一条局面）'); ec.kind = 'critical'; throw ec; }
      var move = out.move, meta = null;
      if (cfg.kind !== 'master' && root.TierRules && multipv > 1) {
        var pool = { slots: {} };
        (out.candidates || []).forEach(function (c, idx) { pool.slots[idx + 1] = c; });
        if (!Object.keys(pool.slots).length && out.move) pool.slots[1] = { score: 0, pv: [out.move], depth: 0 };
        var ply = (ctx && ctx.ply) || 0;
        var seed = (ctx && ctx.seed !== undefined) ? ctx.seed
          : root.TierRules.strHash(seedBase + '|' + fen + '|' + ply) >>> 0;
        var sel = root.TierRules.pick(cfg, pool, {
          group: ply <= 8 ? 'opening' : 'normal',
          legal: ((ctx && ctx.legal) || []).map(uciOf)
        }, seed);
        if (!sel.skip && sel.move) { move = sel.move; meta = sel; }
      }
      return { move: move, hit: meta ? meta.hit : 'best', gap: meta ? meta.gap : 0, cfg: cfg };
    });
  }

  function stop() {
    if (worker) { try { worker.postMessage({ type: 'STOP' }); } catch (e) {} }
    curSeq = 0;
    curCb = null; curReject = null;
  }

  root.PF = {
    HEAVY_LEVELS: HEAVY,
    MILLIS: LEGACY_MILLIS,
    isHeavyLevel: function (i) { return HEAVY.indexOf(i) >= 0; },
    tierConfig: tierOf,
    TIERS: (root.PF_TIERS && root.PF_TIERS.levels) || null,
    boardToFen: boardToFen,
    parseMove: parseMove,
    uciOf: uciOf,
    load: load,
    whenReady: whenReady,
    tierSearch: tierSearch,
    search: search,
    stop: stop,
    lastInfo: null,
    lastCost: null,
    lastError: null,
    env: null,
    onProgress: null,
    NET_BYTES: NET_BYTES,
    netLabel: function () { return NET_LABEL; },
    loadText: loadText,
    // 是否真的会发生一次 50MB 下载：file:// 单文件版把引擎内嵌在 HTML 里，不下载，
    // 所以那一侧不该显示"正在下载 50.7MB"这种话。
    netDownloadNeeded: function () { try { return !isBlobMode(); } catch (e) { return false; } },
    ready: function () { return ready; }
  };
})(typeof window !== 'undefined' ? window : this);
