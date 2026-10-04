/* new_engine/tier_ceiling_cost.js — 大师 movetime ladder + its real cost (card t_a8096ea3, review
 * round 1 item 3).
 *
 * Run: node tier_ceiling_cost.js [tier_r5.log ...]     (default: tier_r5.log)
 *
 * Answers the question the contract on t_9c93fb06 asked and the r3 round did not answer:
 *   "measure the master movetime, including memory and first-load cost; do not inherit the old
 *    6000 ms default."
 *
 * Three things are reported:
 *   1. strength vs movetime (loss vs the ANCHOR best move, and nodes/depth reached),
 *   2. cost vs movetime: the WASM heap the engine actually grew to after that config's searches
 *      (tier_driver.html asks worker_mb.js for module.HEAPU8.length when task.memProbe is set),
 *   3. first-load cost, once per session: NNUE bytes, importScripts / module / net / initialize
 *      timings and the heap size right after initialization.
 *
 * The sample size is printed, not hidden: with few positions the strength column is a hint, not a
 * measurement, and the script says so.
 */
const fs = require('fs');
const path = require('path');
const LOGDIR = path.join(__dirname, '..', 'new_engine_logs');

const args = process.argv.slice(2);
const logs = (args.length ? args : ['tier_r5.log']).map((n) => {
  for (const p of [n, path.join(LOGDIR, n), path.join(LOGDIR, n + '.log')]) if (fs.existsSync(p)) return p;
  throw new Error('no such log: ' + n);
});

const SEL_RE = /\|SEL\|move=(\S+)\|slotScore=(\S+)\|top1=(\S+)\|gap=(\S+)\|rule=(\S+)\|hit=(\S+)\|slotUsed=(\d+)\|seed=(\d+)\|probs=(.*?)\|depth=(\S*)\|nodes=(\S*)\|slots=(.*?)\|smoves=(.*?)\|crit=(\d+)/;
const ANCH_RE = /\|ANCHOR\|move=(\S+)\|score=(\S+)\|mate=(\S+)\|depth=(\S*)\|nodes=(\S*)\|crit=(\d+)/;
const REF_RE = /\|REF\|move=(\S+)\|score=(\S+)\|mate=(\S+)/;

const state = new Map();
const order = [];
const firstLoad = [];
const heap = {};   // cfgId -> [bytes]
const ensure = (pos) => { if (!state.has(pos)) { state.set(pos, { cfgs: {} }); order.push(pos); } return state.get(pos); };

for (const name of logs) {
  for (const line of fs.readFileSync(name, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('TIMING|') || line.startsWith('NET|') || line.startsWith('HEAP|ready') || line.startsWith('MEM|')) {
      firstLoad.push(line); continue;
    }
    if (line.startsWith('HEAP|')) {
      const f = line.split('|');            // HEAP|<round>|<pos>|<cfg>|bytes=
      const cfg = f[3];
      const b = +(String(f[4] || '').replace('bytes=', '') || 0);
      if (cfg && b) (heap[cfg] = heap[cfg] || []).push(b);
      continue;
    }
    if (!line.startsWith('L|')) continue;
    const parts = line.split('|');
    const posId = parts[2], cfgId = parts[3];
    const rec = ensure(posId);
    if (line.includes('|ANCHOR|')) {
      const m = line.match(ANCH_RE);
      if (m) rec.anchor = { score: +m[2], nodes: m[5] === '-' ? null : +m[5] };
      continue;
    }
    if (line.includes('|SKIP|')) continue;
    const m = line.match(SEL_RE);
    if (!m) continue;
    rec.cfgs[cfgId] = {
      gap: +m[4], nodes: m[11] === '-' ? null : +m[11], depth: m[10] === '-' ? null : +m[10],
      probs: m[9] || '',
    };
  }
}
/* second pass for REF scores */
for (const name of logs) {
  for (const line of fs.readFileSync(name, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('L|')) continue;
    const parts = line.split('|');
    const posId = parts[2], cfgId = parts[3];
    if (!line.includes('|REF|')) continue;
    const m = line.match(REF_RE);
    const rec = state.get(posId);
    if (!m || !rec || !rec.cfgs[cfgId]) continue;
    rec.cfgs[cfgId].refScore = +m[2];
  }
}

const cfgIds = [];
for (const posId of order) for (const id of Object.keys(state.get(posId).cfgs)) if (!cfgIds.includes(id)) cfgIds.push(id);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f1 = (x) => (x === null || x === undefined ? '  -  ' : (+x).toFixed(1));
const MB = (b) => (b ? (b / 1048576).toFixed(0) + ' MB' : '-');

console.log('logs=' + logs.map((p) => path.basename(p)).join(',') + '  positions=' + order.length + '  configs=' + cfgIds.length);
console.log('\n=== 1. first-load cost (once per session, from worker_mb.js timings) ===');
for (const l of firstLoad.filter((l) => l.startsWith('TIMING|') || l.startsWith('NET|') || l.startsWith('HEAP|ready') || l.startsWith('MEM'))) {
  const f = l.split('|');
  if (f[0] === 'TIMING') console.log('  ' + f[1].padEnd(12) + f[2].replace('ms=', '') + ' ms' + (f[3] ? '  ' + f[3].replace('bytes=', '') : ''));
  else if (f[0] === 'NET') console.log('  NNUE bytes  ' + f[1].replace('bytes=', ''));
  else if (f[0] === 'HEAP') console.log('  heap after init  ' + MB(+String(f[2] || '').replace('bytes=', '')));
  else console.log('  ' + l);
}

console.log('\n=== 2. strength and memory cost per movetime (loss vs the ANCHOR best move) ===');
console.log(['cfg', 'n', 'lossMean', 'lossMedian', 'nodesMean', 'depthMean', 'heapMax', 'heapMean'].join('\t'));
for (const id of cfgIds) {
  const loss = [], nodes = [], depth = [];
  for (const posId of order) {
    const rec = state.get(posId);
    const c = rec.cfgs[id];
    if (!c) continue;
    nodes.push(c.nodes); depth.push(c.depth);
    if (c.refScore !== undefined && rec.anchor) loss.push(rec.anchor.score + c.refScore);
  }
  const hs = heap[id] || [];
  const s = loss.slice().sort((a, b) => a - b);
  console.log([id, loss.length, f1(mean(loss)),
    loss.length ? s[Math.floor(0.5 * (s.length - 1))] : '-',
    nodes.length ? Math.round(mean(nodes.filter((x) => x !== null))) : '-',
    depth.length ? f1(mean(depth.filter((x) => x !== null)), 0) : '-',
    hs.length ? MB(Math.max.apply(null, hs)) : '-', hs.length ? MB(mean(hs)) : '-'].join('\t'));
}

console.log('\n=== 3. per-position detail (loss per cfg) ===');
console.log(['pos'].concat(cfgIds).join('\t'));
for (const posId of order) {
  const rec = state.get(posId);
  console.log([posId].concat(cfgIds.map((id) => {
    const c = rec.cfgs[id];
    return c && c.refScore !== undefined && rec.anchor ? rec.anchor.score + c.refScore : '-';
  })).join('\t'));
}
console.log('\nSAMPLE SIZE NOTE: positions=' + order.length + '. With fewer than ~10 positions the strength column is a');
console.log('direction check, not a measurement — any movetime value taken from it must stay marked as pending.');
