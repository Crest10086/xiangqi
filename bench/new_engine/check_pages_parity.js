/* check_pages_parity.js — is the DEPLOYED site byte-identical to the repository HEAD?
 * For every tracked file the browser actually loads (index.html, engine.js, js/**, coi-serviceworker.js,
 * online_smoke.html, xiangqi.html) we fetch it from the live Pages origin and compare its git blob SHA-1
 * (sha1("blob <len>\0" + bytes)) with the blob id `git ls-files -s` reports for HEAD.
 * A mismatch means Pages is serving an older/newer build than the code we benchmarked.
 * usage: node bench/new_engine/check_pages_parity.js [repoPath] [baseUrl]
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const REPO = process.argv[2] || 'C:/Users/35165/xiangqi';
const BASE = (process.argv[3] || 'https://crest10086.github.io/xiangqi/').replace(/\/?$/, '/');

const WATCH = /^(js\/|index\.html$|engine\.js$|coi-serviceworker\.js$|online_smoke\.html$|xiangqi\.html$)/;

function tracked() {
  const out = execFileSync('git', ['-C', REPO, 'ls-files', '-s'], { encoding: 'utf8' });
  const map = new Map();
  const RE = /^(\d{6}) ([0-9a-f]{40}) (\d+)\t(.+)$/;
  for (const line of out.split(/\r?\n/)) {
    const m = RE.exec(line);
    if (!m) continue;
    const [, , blob, , path] = m;
    if (WATCH.test(path)) map.set(path, blob);
  }
  return map;
}
const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

(async () => {
  const map = tracked();
  const rows = [];
  for (const path of [...map.keys()].sort()) {
    const res = await fetch(BASE + path);
    if (!res.ok) { rows.push([path, null, map.get(path), 'HTTP ' + res.status, false]); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const live = crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex');
    rows.push([path, buf.length, map.get(path), live, live === map.get(path)]);
  }
  console.log('HEAD=' + head + '  BASE=' + BASE + '  files=' + rows.length);
  for (const [p, n, g, l, ok] of rows) {
    console.log((ok ? 'OK   ' : 'DIFF ') + String(p).padEnd(46) + String(n).padStart(10) + '  ' + g + '  ' + l);
  }
  const bad = rows.filter((r) => !r[4]);
  console.log('\nPARITY ' + (bad.length === 0 ? 'ALL-IDENTICAL' : 'MISMATCH ' + bad.length + '/' + rows.length));
  process.exit(bad.length === 0 ? 0 : 1);
})().catch((e) => { console.log('PARITY ERR ' + (e && e.message)); process.exit(1); });
