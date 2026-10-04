/* serve_noheaders.js — 静态服务器，不带任何 COOP/COEP 头（模拟 GitHub Pages）
 * POST /__log 记录浏览器回传日志
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || '.');
const port = +process.argv[3] || 8793;
const LOG = path.resolve(process.argv[4] || (root + '/../bench_coi.log'));
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
      // NO COOP/COEP on purpose
    });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('serving(NO headers) ' + root + ' on http://127.0.0.1:' + port + ' log=' + LOG));
