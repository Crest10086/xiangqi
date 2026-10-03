/* bench/pf.js — Node 版 Pikafish WASM 引擎封装（与生产 worker 同款 UCI 选项）
 * createEngine() -> Promise<{search(fen, ms) -> Promise<move>, close()}>
 * 复刻 pikafish.worker.js 的选项: Hash=256, Repetition Rule=AsianRule, Draw Rule=None,
 * Sixty Move Rule=true （生产 bridge 发 allowChase:false 对应 AsianRule 路径）
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'js', 'engines', 'pikafish') + path.sep;

function createEngine() {
  return new Promise((resolve, reject) => {
    const PK = require(DIR + 'pikafish.js');
    let onBest = null;               // 当前 bestmove 回调
    let onUciOk = null;
    let mod = null;
    let lastDepth = 0, lastNodes = 0, lastScore = null;
    const kill = setTimeout(() => reject(new Error('engine init timeout')), 30000);

    PK({
      wasmBinary: fs.readFileSync(DIR + 'pikafish.wasm'),
      locateFile: (p) => path.join(DIR, p),
      getPreloadedPackage: () => {
        const b = fs.readFileSync(DIR + 'pikafish.data');
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      },
      onReceiveStdout: (line) => {
        line = String(line || '').replace(/[\r\n]+$/, '');
        if (!line) return;
        if (line.indexOf('info depth') === 0) {
          const d = /info depth (\d+)/.exec(line);
          const n = /nodes (\d+)/.exec(line);
          const s = /score (cp (\-?\d+)|mate (\-?\d+))/.exec(line);
          if (d) lastDepth = +d[1];
          if (n) lastNodes = +n[1];
          if (s) lastScore = s[2] !== undefined ? +s[2] : (s[3] > 0 ? 99999 : -99999);
        }
        if (line.indexOf('uciok') === 0) { clearTimeout(kill); if (onUciOk) onUciOk(); }
        if (line.indexOf('bestmove') === 0) {
          const mv = line.split(/\s+/)[1];
          const cb = onBest; onBest = null;
          if (cb) cb({ move: mv, depth: lastDepth, nodes: lastNodes, score: lastScore });
        }
      },
      onReceiveStderr: () => {},
      onExit: () => {},
    }).then((m) => {
      mod = m;
      // 关键顺序: uciok 会在 sendCommand('uci') 的调用栈内同步返回,
      // 必须先挂好 onUciOk 回调再发命令, 否则永久 pending(Node 静默 exit 0)
      onUciOk = () => {
        clearTimeout(kill);
        resolve({
          search: (fen, ms, a, b) => new Promise((res, rej) => {
            if (onBest) { rej(new Error('previous search still running')); return; }
            // 第3参数: 数字=超时(旧用法) 或 {timeoutMs, options:[{name,value}]}(强度旋钮)
            const timeoutMs = (typeof a === 'number') ? a : ((a && a.timeoutMs) || (b && typeof b === 'number' ? b : 0));
            const optList = (a && typeof a === 'object' && a.options) ? a.options : null;
            const to = setTimeout(() => { onBest = null; rej(new Error('search timeout')); }, timeoutMs || (ms + 20000));
            onBest = (mv) => { clearTimeout(to); res(mv); };
            // 生产 bridge 每次搜索下发的选项（allowChase:false 路径）
            mod.sendCommand('setoption name Repetition Rule value AsianRule');
            mod.sendCommand('setoption name Draw Rule value None');
            mod.sendCommand('setoption name Sixty Move Rule value true');
            if (optList) { for (const o of optList) mod.sendCommand('setoption name ' + o.name + ' value ' + o.value); }
            // 必须显式复位: 同一引擎实例在一局里被两个配置交替使用, 否则上一次的强度限制会泄漏到下一次搜索
            else { mod.sendCommand('setoption name UCI_LimitStrength value false'); mod.sendCommand('setoption name Skill Level value 20'); }
            mod.sendCommand('position fen ' + (String(fen).indexOf(' - ') >= 0 ? fen : fen + ' - - 0 1'));
            mod.sendCommand('go movetime ' + ms);
          }),
        });
      };
      m.sendCommand('setoption name Hash value 256');
      m.sendCommand('uci');
    }).catch(reject);
  });
}

module.exports = { createEngine };