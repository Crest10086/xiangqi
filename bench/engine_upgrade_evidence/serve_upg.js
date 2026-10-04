/* serve_upg.js — no COOP/COEP headers (Pages-like), binds 0.0.0.0 so LAN clients can reach it */
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || '.');
const port = +process.argv[3] || 8796;
const LOG = path.resolve(process.argv[4] || (root + '/../upg_bench.log'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.nnue': 'application/octet-stream', '.md': 'text/plain', '.json': 'application/json' };
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__log') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      fs.appendFileSync(LOG, body + '\n');
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
    });
    return;
  }
  const url = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, url === '/' ? '/index.html' : url);
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
      'Content-Length': data.length,
      // NO COOP/COEP on purpose (GitHub Pages cannot set them)
    });
    res.end(data);
  });
}).listen(port, '0.0.0.0', () => console.log('serving(NO headers, 0.0.0.0) ' + root + ' on :' + port + ' log=' + LOG));
