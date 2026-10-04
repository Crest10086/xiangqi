/* new_engine/tier_games_report.js — summarize a tier_games.html log (card t_a8096ea3).
 * Run: node tier_games_report.js <logname> [more.log ...]
 * Prints per-pair scores (hi/lo/draw), per-tier move statistics (how often the mistake branch fired,
 * mean gap played), invalid/critical counts, and a monotonicity check over the pair results.
 */
const fs = require('fs');
const path = require('path');
const LOGDIR = path.join(__dirname, '..', 'new_engine_logs');

const args = process.argv.slice(2);
if (!args.length) { console.log('usage: node tier_games_report.js <log> [...]'); process.exit(2); }
const readLog = (n) => {
  for (const p of [n, n + '.log', path.join(LOGDIR, n), path.join(LOGDIR, n + '.log')]) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').split(/\r?\n/);
  }
  throw new Error('no such log: ' + n);
};

const games = new Map();
const moves = [];
let done = 0;
for (const name of args) {
  for (const line of readLog(name)) {
    if (line.startsWith('DRV DONE')) { done++; continue; }
    if (!line.startsWith('G|') && !line.startsWith('GM|') && !line.startsWith('GE|')) continue;
    const parts = line.split('|');
    const gid = parts[2];
    if (!games.has(gid)) games.set(gid, { id: gid, round: +parts[1] });
    const g = games.get(gid);
    if (parts[3] === 'START') {
      const f = Object.fromEntries(line.split('|').slice(4).map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
      g.pair = decodeURIComponent(f.pair || ''); g.posId = f.pos; g.hi = f.hi; g.lo = f.lo; g.hiFirst = f.hiFirst;
    } else if (parts[3] === 'END') {
      const f = Object.fromEntries(line.split('|').slice(4).map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
      g.winner = f.winner; g.reason = decodeURIComponent(f.reason || ''); g.plies = +f.plies;
      g.invalid = +(f.invalid || 0); g.crit = +(f.crit || 0);
      g.stats = {};
      for (const seg of String(f.stats || '').split(';')) {
        const i = seg.indexOf(':'); if (i < 0) continue;
        const cfg = seg.slice(0, i);
        g.stats[cfg] = Object.fromEntries(seg.slice(i + 1).split(',').map(kv => { const j = kv.indexOf('='); return [kv.slice(0, j), kv.slice(j + 1)]; }));
      }
    } else if (parts[3] && parts[3] !== 'PROG') {
      const f = Object.fromEntries(line.split('|').slice(4).map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
      moves.push({ gid: gid, cfg: f.cfg, kind: f.kind, hit: f.hit, gap: +f.gap || 0, nodes: +f.nodes || 0, ply: +parts[3] });
    }
  }
}

const list = [...games.values()].filter(g => g.winner);
console.log('games parsed=' + list.length + ' (harness DONE markers=' + done + ')');

/* per pair */
const pairs = {};
for (const g of list) {
  const p = pairs[g.pair] = pairs[g.pair] || { hi: g.hi, lo: g.lo, hiWin: 0, loWin: 0, draw: 0, plies: [], invalid: 0, games: [] };
  if (g.winner === 'hi') p.hiWin++; else if (g.winner === 'lo') p.loWin++; else p.draw++;
  p.plies.push(g.plies); p.invalid += g.invalid;
  p.games.push(g.id + '=' + g.winner + '(' + g.reason + ',' + g.plies + 'ply)');
}
console.log('\nper-pair results (hi = the stronger tier by design)');
console.log(['pair', 'hiCfg', 'loCfg', 'hiWin', 'loWin', 'draw', 'plies', 'invalid'].join('\t'));
for (const k of Object.keys(pairs)) {
  const p = pairs[k];
  console.log([k, p.hi, p.lo, p.hiWin, p.loWin, p.draw, p.plies.join('/'), p.invalid].join('\t'));
}
for (const k of Object.keys(pairs)) console.log('  ' + k + ': ' + pairs[k].games.join(' '));

/* per tier */
const tiers = {};
for (const m of moves) {
  const t = tiers[m.cfg] = tiers[m.cfg] || { n: 0, rand: 0, cap: 0, above: 0, bmiss: 0, builtin: 0, best: 0, gapSum: 0, gapMax: 0, nodesSum: 0 };
  t.n++;
  if (m.hit === 'rand') t.rand++;
  if (m.hit === 'cap') t.cap++;
  if (m.hit === 'above') t.above++;
  if (m.hit === 'bmiss') t.bmiss++;
  if (m.hit === 'builtin') t.builtin++;
  if (m.hit === 'best') t.best++;
  t.gapSum += m.gap; t.gapMax = Math.max(t.gapMax, m.gap); t.nodesSum += m.nodes;
}
console.log('\nper-tier move statistics');
console.log(['cfg', 'moves', 'rand', 'cap', 'above', 'bmiss', 'builtin', 'best', 'randShare', 'gapMean', 'gapMax', 'nodesMean'].join('\t'));
for (const k of Object.keys(tiers)) {
  const t = tiers[k];
  console.log([k, t.n, t.rand, t.cap, t.above, t.bmiss, t.builtin, t.best,
    (t.rand / t.n).toFixed(2), Math.round(t.gapSum / t.n), t.gapMax, Math.round(t.nodesSum / t.n)].join('\t'));
}

/* ladder check: for every pair, did the designed-stronger side score at least as well? */
console.log('\nladder check (design expectation: hi must not LOSE the pair outright)');
let ok = 0, bad = 0;
for (const k of Object.keys(pairs)) {
  const p = pairs[k];
  const pass = p.hiWin >= p.loWin;
  if (pass) ok++; else bad++;
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + ' ' + k + ' hi ' + p.hiWin + ' - lo ' + p.loWin + ' (draw ' + p.draw + ')');
}
console.log('pairs passing=' + ok + ' failing=' + bad);

/* invalid / critical */
const totInvalid = list.reduce((a, g) => a + g.invalid, 0);
const totCrit = list.reduce((a, g) => a + g.crit, 0);
console.log('\ntotal invalid moves=' + totInvalid + ' critical-error searches=' + totCrit);
const reasons = {};
for (const g of list) reasons[g.reason] = (reasons[g.reason] || 0) + 1;
console.log('end reasons: ' + JSON.stringify(reasons));
