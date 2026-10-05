/* new_engine/test_ui_wiring.js — unit tests for the two UI items on card t_f51aab68.
 *
 * User request (2026-10-05 07:39):
 *   1. 下载 50M 的大文件时，界面上应该有提示
 *   2. 移动完棋子后，被移动的棋子也应该高亮显示
 *
 * What this guards (source-level wiring + the pure helpers the UI renders from):
 *   A. index.html ships an engine-download panel (#engLoad, hidden by default) that is driven by
 *      the bridge's progress events, and it is armed when the user starts a game on an engine
 *      tier — not only when the AI happens to think.
 *   B. The bridge exposes PF.NET_BYTES (the shipped NNUE size, asserted against the file on disk)
 *      and PF.loadText(p), the single place the download wording is produced.
 *   C. draw()/drawPiece() highlight the piece that was just moved (glow + inner ring), for both
 *      the human's move and the AI's reply, and the highlight is cleared on 新对局/悔棋 paths
 *      (they go through lastMove).
 *
 * Run: node bench/new_engine/test_ui_wiring.js
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log(' FAIL  ' + name); }
}
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'js', 'pikafish_bridge.js'), 'utf8');
function bodyOf(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  return src.slice(i);
}

// ---- A. the download panel exists and is wired to the bridge's progress ----
t('index.html has an #engLoad panel', HTML.indexOf('id="engLoad"') > 0);
t('#engLoad is hidden by default (no permanent UI noise)', /id="engLoad"[^>]*hidden/.test(HTML) || /hidden[^>]*id="engLoad"/.test(HTML));
t('the panel has a progress bar element', HTML.indexOf('id="engBarFill"') > 0 && HTML.indexOf('id="engLoadTxt"') > 0);
t('the page arms the engine load when the user starts a game on an engine tier',
  /function newGame\(fromUser\)/.test(HTML) &&
  /fromUser[\s\S]*?ensureEngine\(/.test(bodyOf(HTML, 'newGame')));
t('the automatic first newGame() call does NOT trigger the download (lazy-load contract kept)',
  /if \(!restoreGame\(\)\) newGame\(\);/.test(HTML) &&
  (HTML.match(/newGame\(true\)/g) || []).length === 1); // only the 新对局 button arms it
t('the page still arms it from aiTurn (fallback path unchanged)', bodyOf(HTML, 'aiTurn').indexOf('ensureEngine(') > 0);
t('progress text comes from the bridge helper (no wording duplicated in the page)',
  HTML.indexOf('PF.loadText(') > 0 && !/正在加载引擎 /.test(HTML));
t('the page renders progress, and a failure state (pending state = loadText(null))',
  /function showEngineProgress\(/.test(HTML) && /function showEngineFailed\(/.test(HTML) &&
  /showEngineProgress\(null\)/.test(HTML));
t('the panel is hidden once the engine is ready', /function hideEngineProgress\(/.test(HTML));
t('a failed engine load is reported to the user instead of silently falling back',
  /showEngineFailed\(/.test(HTML) && /内置 AI/.test(HTML));

// ---- B. bridge: shipped size + the single wording source ----
const NNUE = path.join(ROOT, 'js', 'engines', 'pikafish', 'pikafish.nnue');
const REAL = fs.statSync(NNUE).size;
delete require.cache[require.resolve(path.join(ROOT, 'js', 'pikafish_bridge.js'))];
const sandbox = { window: {}, console, Math, JSON, Blob: class {}, URL, performance: { now: () => 0 }, setTimeout, clearTimeout, Promise, Error };
sandbox.window.PF_TIERS = require(path.join(ROOT, 'js', 'tier_config.js')).PF_TIERS;
sandbox.globalThis = sandbox;
vm.runInNewContext(BRIDGE, sandbox);
const PF = sandbox.window.PF;
t('bridge exposes PF.NET_BYTES and PF.loadText', !!(PF && PF.NET_BYTES && typeof PF.loadText === 'function'));
t('PF.NET_BYTES equals the shipped pikafish.nnue size on disk (' + REAL + 'B)', PF.NET_BYTES === REAL);
t('PF.NET_BYTES is not a hand-copied constant drifting from the docs (50.7MB decimal)',
  Math.round(PF.NET_BYTES / 1e5) / 10 === 50.7);
{
  const pending = PF.loadText(null);
  t('loadText(null) says the engine is being prepared and states the size',
    /准备引擎/.test(pending) && /50\.7MB/.test(pending));
  const half = PF.loadText({ loaded: Math.round(REAL / 2), total: REAL });
  t('loadText(50%) shows percent and loaded/total bytes', /50%/.test(half) && /25\.4\/50\.7MB/.test(half));
  const nodal = PF.loadText({ loaded: 1048576, total: 0 });
  t('loadText survives a missing Content-Length (no NaN, falls back to the shipped total)',
    !/NaN/.test(nodal) && /1\.0\/50\.7MB/.test(nodal));
  const over = PF.loadText({ loaded: REAL + 5, total: 0 });
  t('loadText never claims >100% / over-total progress', !/NaN/.test(over) && /已下载完/.test(over));
  const done = PF.loadText({ loaded: REAL, total: REAL });
  t('loadText at 100% reads as finishing/initialising, not as a stalled 100% download',
    /已下载完/.test(done) && /初始化/.test(done) && !/100%（50\.7\/50\.7MB）/.test(done));
}

// ---- C. the moved piece is highlighted ----
t('draw() marks the square the last move landed on', /movedIdx/.test(HTML));
t('drawPiece takes a "moved" flag and gives that piece a glow + inner ring',
  /function drawPiece\(i, c, moved\)/.test(HTML) && /shadowBlur/.test(HTML) && /moved/.test(bodyOf(HTML, 'drawPiece')));
t('draw() passes the flag for the destination of lastMove (both human and AI moves end in lastMove)',
  /drawPiece\(i, c, i === movedIdx\)/.test(HTML));
t('the highlight is cleared when lastMove is cleared (新对局 / 悔棋 set lastMove = null)',
  /function newGame\([\s\S]*?lastMove = null/.test(bodyOf(HTML, 'newGame')));
t('the existing last-move square rings are still drawn (the move path is not replaced)',
  /if \(lastMove\)/.test(HTML));

// ---- D. 下完一步变回开局（小米浏览器实测）：COOP/COEP 闸门重载前存对局、重载后接回 ----
t('the page can save the running game before a forced reload', /function saveGameForReload\(/.test(HTML));
t('ensureEngine() saves the game (that is the path that can reload the page)',
  /function ensureEngine\([\s\S]*?saveGameForReload\(\)/.test(bodyOf(HTML, 'ensureEngine')));
t('the page restores the game on boot instead of always starting a fresh one',
  /restoreGame\(\)\) newGame\(\)/.test(HTML));
t('restore replays the recorded moves through the engine-legal path and rebuilds lastMove',
  /function restoreGame\([\s\S]*?game\.move\(m\)[\s\S]*?lastMove = game\.history/.test(bodyOf(HTML, 'restoreGame')));
t('restore re-runs the end-of-game check (a restored 绝杀/重复 position must not look live)',
  /function restoreGame\([\s\S]*?checkEnd\(\)/.test(bodyOf(HTML, 'restoreGame')));
t('restore is bounded (stale archive is rejected, not replayed forever)',
  /Date\.now\(\) - \(d\.at \|\| 0\)/.test(HTML));
t('restore tells the user what happened instead of silently resetting',
  /已恢复刚才的对局/.test(HTML));
t('saveGameForReload records whether the engine download was in flight',
  /armed: engineLoadArmed/.test(bodyOf(HTML, 'saveGameForReload')));
t('restore resumes an in-flight engine download instead of losing the panel',
  /function restoreGame\([\s\S]*?d\.armed[\s\S]*?ensureEngine\(\)/.test(bodyOf(HTML, 'restoreGame')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
