/* serve_https.js — HTTPS 静态服务器（自签证书），测试 https 页面调用 http 引擎是否被 mixed-content 拦截 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || '.');
const port = +process.argv[3] || 8794;
const LOG = path.resolve(process.argv[4] || (root + '/../bench_mixed.log'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.nnue': 'application/octet-stream', '.md': 'text/plain', '.json': 'application/json' };
const opts = {
  key: fs.readFileSync(path.resolve(process.argv[5] || 'key.pem')),
  cert: fs.readFileSync(path.resolve(process.argv[6] || 'cert.pem')),
};
https.createServer(opts, (req, res) => {
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
    });
    res.end(data);
  });
}).listen(port, '0.0.0.0', () => console.log('https serving ' + root + ' on :' + port + ' log=' + LOG));
