/* analyze_rule_logs.js — 机械解析本卡所有探针日志，产出 rule_evidence.json
 * 关键：CRITICAL 行以 "info string CRITICAL ERROR:" 开头，必须与 info depth 行分开判定。
 */
const fs = require('fs');
const path = require('path');
const LOGS = {
  rule4: 'new_engine_rule4.log',
  rule5: 'new_engine_rule5.log',
  rule6: 'new_engine_rule6.log',
  rule8: 'new_engine_rule8.log',
  rule9: 'new_engine_rule9.log',
  rule10: 'new_engine_rule10.log',
  rule11: 'new_engine_rule11.log',
  rule12: 'new_engine_rule12.log',
  rule13: 'new_engine_rule13.log',
  rule14: 'new_engine_rule14.log',
  rule15: 'new_engine_rule15.log',
  rule16: 'new_engine_rule16.log',
  rule17: 'new_engine_rule17.log',
};
const DIR = path.join(__dirname, '..', 'new_engine_logs');
const out = {};
for (const [tag, file] of Object.entries(LOGS)) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) { out[tag] = { missing: true }; continue; }
  const steps = {};
  let done = false;
  for (const ln of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (ln.startsWith('DRV DONE')) { done = true; continue; }
    if (!ln.startsWith('S|')) continue;
    const i1 = ln.indexOf('|'), i2 = ln.indexOf('|', i1 + 1), i3 = ln.indexOf('|', i2 + 1);
    const sid = ln.slice(i1 + 1, i2), kind = ln.slice(i2 + 1, i3), rest = ln.slice(i3 + 1);
    const st = steps[sid] || (steps[sid] = { cmd: null, plies: 0, halfmoveFen: null, rejected: false, scores: [], bestmove: null, pvMax: null, maxNodes: 0 });
    if (kind === 'CMD' && !st.cmd) {
      st.cmd = rest;
      const m = rest.match(/ moves (.+)$/);
      if (m) st.plies = m[1].trim().split(/\s+/).length;
      const h = rest.match(/ - - (\d+) \d+$/);
      if (h) st.halfmoveFen = +h[1];
    } else if (kind === 'OUT') {
      if (/^info string CRITICAL ERROR/.test(rest)) { st.rejected = true; st.rejectReason = (rest.match(/Reason: (.*)$/) || [null, rest])[1]; continue; }
      const m = rest.match(/^info depth (\d+) seldepth (\d+) multipv 1 score (mate -?\d+|cp -?\d+|lowerbound|upperbound) nodes (\d+).*? pv (.*)$/);
      if (m) { st.scores.push({ d: +m[1], score: m[3], nodes: +m[4] }); if (st.pvMax === null || +m[1] > st.pvMax.d) st.pvMax = { d: +m[1], score: m[3], pv: m[6], nodes: +m[4] }; if (+m[4] > st.maxNodes) st.maxNodes = +m[4]; }
      const m0 = rest.match(/^info depth (\d+) score (mate -?\d+|cp -?\d+)/);
      if (m0 && !rest.includes(' multipv ')) st.scores.push({ d: +m0[1], score: m0[2], nodes: 0 });
      if (/^bestmove/.test(rest)) st.bestmove = rest;
    }
  }
  const rows = Object.entries(steps).map(([sid, st]) => {
    st.scores.sort((a, b) => a.d - b.d);
    const last = st.scores[st.scores.length - 1] || null;
    const first = st.scores[0] || null;
    return {
      id: sid, plies: st.plies, halfmoveFen: st.halfmoveFen, rejected: st.rejected, rejectReason: st.rejectReason,
      d1_score: first ? first.score : null, final_depth: last ? last.d : null, final_score: last ? last.score : null,
      max_nodes: st.maxNodes, bestmove: st.bestmove, pv_final: st.pvMax ? st.pvMax.pv : null,
    };
  });
  out[tag] = { file, done, steps: rows };
  console.log('=====', tag, file, 'done=' + done, 'steps=' + rows.length, 'rejected=' + rows.filter(r => r.rejected).length);
  for (const r of rows) console.log('  %s plies=%-4d hm=%-5s rej=%-5s d1=%-9s final(d%s)=%-9s bm=%s', r.id, r.plies, r.halfmoveFen === null ? '-' : r.halfmoveFen, r.rejected, r.d1_score, r.final_depth, r.final_score, r.bestmove || '');
}
fs.writeFileSync(path.join(__dirname, 'rule_evidence.json'), JSON.stringify(out, null, 1));
console.log('\nwritten -> rule_evidence.json');
