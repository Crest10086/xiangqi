/* per_pos_detail.js — TEST-ONLY for card t_ef6e93b8: per-position gap/loss distribution. */
const fs = require('fs');
const path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', 'levels_analysis.json'), 'utf8'));
const posDefs = JSON.parse(fs.readFileSync(path.join(__dirname, 'level_positions.json'), 'utf8'));

const CFGS = ['AM', 'AD', 'EX'];
console.log('pos          | AM gap/loss (3 rounds)        | AD gap/loss              | EX gap/loss');
for (const p of posDefs) {
  const g = p.group;
  const cells = CFGS.map(cfg => {
    const det = [1, 2, 3].map(r => {
      const pr = A.perGroup[g][cfg].perRound[r];
      if (!pr) return null;
      const d = pr.detail.find(x => x.pid === p.id);
      return d ? d.loss : null;
    });
    // gaps from raw analysis rows are in perRound detail? gap not stored; recompute from search block
    return det.map(x => x === null ? 'NA' : x).join('/');
  });
  console.log(p.id.padEnd(12) + ' | ' + cells.map(c => c.padEnd(26)).join(' | '));
}

// gap distribution per cfg per group from logs directly
const logs = ['levels_r1.log', 'levels_r2.log', 'levels_r3.log'];
const rows = [];
for (const f of logs) {
  for (const line of fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', f), 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('L|')) continue;
    const parts = line.split('|');
    const cfg = parts[3];
    if (cfg === 'ANCHOR') continue;
    if (parts[4] !== 'SEL') continue;
    const fields = {};
    for (const kv of parts.slice(5)) { const i = kv.indexOf('='); if (i > 0) fields[kv.slice(0, i)] = kv.slice(i + 1); }
    rows.push({ round: +parts[1], pos: parts[2], cfg, gap: +fields.gap });
  }
}
const groupOf = {};
for (const p of posDefs) groupOf[p.id] = p.group;
for (const g of ['opening', 'midgame']) {
  for (const cfg of CFGS) {
    const gaps = rows.filter(r => r.cfg === cfg && groupOf[r.pos] === g).map(r => r.gap);
    const buckets = { '<10': 0, '10-49': 0, '50-199': 0, '200-499': 0, '>=500': 0 };
    for (const x of gaps) {
      if (x < 10) buckets['<10']++; else if (x < 50) buckets['10-49']++; else if (x < 200) buckets['50-199']++; else if (x < 500) buckets['200-499']++; else buckets['>=500']++;
    }
    console.log('gap buckets ' + g + ' ' + cfg + ': n=' + gaps.length, JSON.stringify(buckets));
  }
}
