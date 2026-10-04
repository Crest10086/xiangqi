/* grading_by_position.js — TEST-ONLY for card t_ef6e93b8.
 * For each position: mean over 3 rounds of loss(AM), loss(AD), loss(EX), loss(GM),
 * and the adjacent deltas. Classify: graded (both deltas > 20cp), partial, flat.
 */
const fs = require('fs');
const path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'new_engine_logs', 'levels_analysis.json'), 'utf8'));
const posDefs = JSON.parse(fs.readFileSync(path.join(__dirname, 'level_positions.json'), 'utf8'));
const CFGS = ['AM', 'AD', 'EX', 'GM'];

const rows = [];
for (const p of posDefs) {
  const g = p.group;
  const loss = {};
  for (const cfg of CFGS) {
    const vals = [];
    for (const r of [1, 2, 3]) {
      const pr = A.perGroup[g][cfg].perRound[r];
      if (!pr) continue;
      const d = pr.detail.find(x => x.pid === p.id);
      if (d) vals.push(d.loss);
    }
    loss[cfg] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(0) : null;
  }
  const d1 = loss.AM - loss.AD;   // >0 means AM weaker than AD (correct grading)
  const d2 = loss.AD - loss.EX;
  const d3 = loss.EX - loss.GM;
  const graded = d1 > 20 && d2 > 20;
  const flat = d1 <= 20 && d2 <= 20;
  rows.push({ id: p.id, group: g, ...loss, d1, d2, d3, cls: graded ? 'GRADED' : (flat ? 'FLAT' : 'PARTIAL') });
}
console.log('id           grp     AM    AD    EX    GM   | d(AM-AD) d(AD-EX) d(EX-GM) class');
for (const r of rows) {
  console.log(r.id.padEnd(12), r.group.padEnd(7), String(r.AM).padStart(5), String(r.AD).padStart(5), String(r.EX).padStart(5), String(r.GM).padStart(5), '|',
    String(r.d1).padStart(8), String(r.d2).padStart(8), String(r.d3).padStart(8), r.cls.padStart(9));
}
const tally = {};
for (const r of rows) { const k = r.group + ' ' + r.cls; tally[k] = (tally[k] || 0) + 1; }
console.log('TALLY:', JSON.stringify(tally));
