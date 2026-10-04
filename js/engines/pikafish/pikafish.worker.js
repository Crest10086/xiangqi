/**
 * pikafish.worker.js - 皮卡鱼(Pikafish) WASM 引擎的 UCI 桥接 Worker
 *
 * 引擎 = 完整强度构建（bench/ENGINE_UPGRADE_FEASIBILITY.md 路线①，mistboard pikafish-wasm v0.1.0）：
 *   pikafish.js 80,121B + pikafish.wasm 662,419B + pikafish.nnue 50,706,378B（zstd，运行时解压 66MB）
 * 旧的小网络构建（pikafish.js/pikafish.wasm/pikafish.data）保留在 ./legacy/，只供 file:// 单文件版。
 *
 * 协议(与 js/pikafish_bridge.js 约定):
 *   主线程 -> Worker:  { type: "INIT", threads, hash }
 *                     { type: "SEARCH", fen, movetime, multipv, hash, seq }
 *                     { type: "STOP" }
 *   Worker -> 主线程:  { type: "READY" }
 *                     { type: "ENV", coi, sab, threads }
 *                     { type: "INFO",  info }
 *                     { type: "CMD",   cmds }
 *                     { type: "NET_PROGRESS", loaded, total }
 *                     { type: "BEST_MOVE", move, seq, critical }
 *                     { type: "ERROR", message }
 *
 * 与旧构建的三点差别（都是实测结论，见 bench/NEW_ENGINE_OPTIONS.md）：
 *   1. 驱动方式：这个构建经 cwrap('pikafish_initialize') + cwrap('pikafish_command') 下发命令，
 *      网络必须先 fetch 再 FS.writeFile('/pikafish.nnue')，引擎才会加载 NNUE。
 *   2. 旧构建的 Repetition Rule / Draw Rule / Sixty Move Rule / UCI_LimitStrength / UCI_Elo
 *      在这里**不存在**（逐项实测回 "No such option"），所以只下发 Threads / Hash / MultiPV；
 *      判例与和棋裁决留在前端（index.html checkEnd），强度阶梯改由选着规则(cap/p/mistakeBand)决定。
 *   3. 非法 position 时引擎回一行 CRITICAL ERROR 并**沿用上一条有效局面**继续搜索——
 *      因此这里把 critical 标记随着法一起回传，由桥接层丢弃该次结果。
 *
 * 多线程需要 crossOriginIsolated（COOP/COEP）；未隔离时 pthread 构建在实例化阶段就抛
 * DataCloneError（0 线程，不是退化为单线程）。隔离由根目录 coi-serviceworker.js 提供，
 * 桥接层负责在加载前完成"注册 + 重载一次"。
 */
"use strict";

var engineModule = null;   // Emscripten 模块（FS / HEAPU8 等）
var command = null;        // cwrap('pikafish_command')
var searchPending = null;
var stopPending = false;
var engineSearching = false;
var criticalFlag = false;  // 本次搜索里出现过 CRITICAL ERROR
var lastSeq = 0;
var initStarted = false;
var wantThreads = 1;
var wantHash = 64;

function post(obj) { self.postMessage(obj); }

function sendCommand(line) {
  command(line);
}

/* 50.7MB 网络带进度下载（懒加载时前端可据此显示进度） */
async function fetchNet(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("网络下载失败 HTTP " + response.status);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    post({ type: "NET_PROGRESS", loaded: loaded, total: total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function postOut(line) {
  line = String(line || "").replace(/[\r\n]+$/, "");
  if (!line) {
    return;
  }
  if (line.indexOf("CRITICAL ERROR") >= 0) {
    criticalFlag = true;
    // 带 seq 上报：CRITICAL 可能迟到（引擎在自己的线程上打印），若不带 seq，
    // 上一次搜索的错误会误杀下一次已经正常开始的搜索。
    post({ type: "CRITICAL", seq: lastSeq, info: line });
    return;
  }
  if (line.indexOf("uciok") >= 0) {
    post({ type: "READY" });
    drainPending();
  } else if (line.indexOf("bestmove") === 0) {
    engineSearching = false;
    // stop 指令后引擎吐出的第一条 bestmove 属于被打断的旧搜索：吞掉它，
    // 否则它会顶着新搜索的 seq 被主线程当成新着法接受，走出与当前局面
    // 不符的"鬼步"，棋盘从此停在电脑回合一动不动。
    if (stopPending) {
      stopPending = false;
      drainPending();
      return;
    }
    var parts = line.split(/\s+/);
    post({ type: "BEST_MOVE", move: parts.length > 1 ? parts[1] : "", seq: lastSeq, critical: criticalFlag });
    criticalFlag = false;
    drainPending();
  } else if (line.indexOf("info ") === 0) {
    post({ type: "INFO", info: line });
  }
}

function runSearchNow(d) {
  engineSearching = true;
  criticalFlag = false;
  lastSeq = d.seq || lastSeq;
  try {
    var cmds = [
      "setoption name Hash value " + (d.hash || 64),
      "setoption name MultiPV value " + (d.multipv > 1 ? d.multipv : 1)
    ];
    for (const c of cmds) sendCommand(c);
    post({ type: "CMD", cmds: cmds.map(function (c) { return c.replace("setoption name ", ""); }) });
    if (d.fen) {
      // 补齐成标准 7 段式 FEN, 兼容 UCI/UCCI 协议。halfmove 恒为 0：新引擎对
      // halfmove >= 120 的 FEN 直接拒收（"Rule60 counter out of range"），60 回合判罚留在前端。
      var fen = d.fen.indexOf(" - ") >= 0 ? d.fen : d.fen + " - - 0 1";
      sendCommand("position fen " + fen);
    }
    sendCommand("go movetime " + (d.movetime || 300));
  } catch (err) {
    engineSearching = false;
    // 非法 position 时这个构建的 pikafish_command 会直接抛（实测抛的不是 Error 对象），
    // 引擎同时打印 CRITICAL ERROR。两种情况都按 critical 上报，让桥接层立刻回退而不是白等超时。
    post({ type: "CRITICAL", seq: lastSeq, info: "search command failed: " + (err && err.message ? err.message : JSON.stringify(err)) });
    drainPending();
  }
}

function drainPending() {
  if (searchPending && engineModule && !engineSearching) {
    var p = searchPending;
    searchPending = null;
    runSearchNow(p);
  }
}

/* 加载 + 初始化：胶水 -> 网络(并行) -> FS 写入 -> pikafish_initialize -> uci */
async function initEngine() {
  var base = self.location.href.substring(0, self.location.href.lastIndexOf("/") + 1);
  post({
    type: "ENV",
    coi: typeof self.crossOriginIsolated === "boolean" ? self.crossOriginIsolated : null,
    sab: typeof SharedArrayBuffer !== "undefined",
    threads: wantThreads
  });
  var netPromise = fetchNet(base + "pikafish.nnue"); // 与脚本加载并行
  importScripts("pikafish.js");
  var factory = self.Pikafish;
  if (typeof factory !== "function") throw new Error("pikafish.js 加载后没有 Pikafish 工厂");
  var module = await factory({
    locateFile: function (path) { return base + path; },
    mainScriptUrlOrBlob: base + "pikafish.js", // pthread worker 池需要胶水脚本的 URL
    print: function (line) { postOut(line); },
    printErr: function () { /* 引擎警告忽略 */ }
  });
  var net = await netPromise;
  module.FS.writeFile("/pikafish.nnue", net);
  post({ type: "NET_WRITTEN", bytes: net.byteLength });
  var initialize = module.cwrap("pikafish_initialize", null, []);
  command = module.cwrap("pikafish_command", null, ["string"]);
  initialize();
  engineModule = module;
  sendCommand("setoption name Threads value " + wantThreads);
  sendCommand("setoption name Hash value " + wantHash);
  sendCommand("uci"); // 引擎回 id/option/uciok -> postOut 里发 READY
}

self.onmessage = function (e) {
  var data = e.data || {};
  var type = data.type;

  if (type === "INIT") {
    if (initStarted) return;
    initStarted = true;
    wantThreads = Math.max(1, Math.min(4, data.threads || 1));
    wantHash = data.hash || 64;
    try {
      Promise.resolve(initEngine()).catch(function (err) {
        post({ type: "ERROR", message: "皮卡鱼初始化失败: " + (err && err.message ? err.message : err) + " ||STACK|| " + String(err && err.stack ? err.stack : "(no stack)").replace(/\n/g, " | ") });
      });
    } catch (err) {
      post({ type: "ERROR", message: "皮卡鱼加载失败: " + err });
    }
    return;
  }

  if (type === "SEARCH") {
    var req = {
      fen: data.fen, movetime: data.movetime || 300, seq: data.seq,
      multipv: data.multipv, hash: data.hash
    };
    if (!engineModule || !command) {
      // 引擎还没就绪：把搜索排队，等 uciok/READY 后补执行。
      // 直接 return 会丢掉这次搜索，主线程永远等不到 BEST_MOVE，
      // 棋盘 busy 锁死、点哪都没用。
      searchPending = req;
      return;
    }
    if (engineSearching) {
      // 旧 go 还挂着（stop 可能还在路上）：先 stop，等它的 bestmove 被吞掉后补执行。
      searchPending = req;
      stopPending = true;
      try {
        sendCommand("stop");
      } catch (err) { /* ignore */ }
      return;
    }
    runSearchNow(req);
    return;
  }

  if (type === "STOP") {
    // 主线程悔棋/重开/换引擎时取消旧思考：正在跑的 go 用 stop 指令打断（UCI 标准指令）。
    // 只有引擎确实在搜索时才会收到被打断的 bestmove，才需要置 stopPending 吞掉它；
    // 引擎空闲时乱置会把下一次正常搜索的 bestmove 也吞掉，导致棋盘死等。
    searchPending = null;
    if (engineSearching) {
      stopPending = true;
    }
    if (command) {
      try {
        sendCommand("stop");
      } catch (err) { /* ignore */ }
    }
  }
};

self.addEventListener("error", function (ev) {
  post({ type: "ERROR", message: "引擎线程异常: " + ((ev && ev.message) || "unknown") });
});
self.addEventListener("unhandledrejection", function (ev) {
  post({ type: "ERROR", message: "引擎线程异常: " + String(ev && ev.reason) });
});
