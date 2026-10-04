/* 测量从本机(.99)到 .100:8899 引擎服务的一次完整 /move 请求延迟（含引擎思考时间） */
const http = require('http');
function get(url) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, body }));
    }).on('error', reject);
  });
}
(async () => {
  const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  // warmup
  await get('http://192.168.10.100:8899/healthz');
  for (const ms of [500, 2000, 6000]) {
    const r = await get('http://192.168.10.100:8899/move?ms=' + ms + '&fen=' + encodeURIComponent(FEN));
    const j = JSON.parse(r.body);
    console.log('HTTP .100 ' + ms + 'ms -> wall ' + r.ms.toFixed(1) + 'ms (server ' + j.wall_ms + 'ms) depth ' + j.depth + ' nodes ' + j.nodes + ' move ' + j.move);
  }
  // pure round-trip latency (healthz)
  const times = [];
  for (let i = 0; i < 10; i++) {
    const r = await get('http://192.168.10.100:8899/healthz');
    times.push(r.ms);
  }
  times.sort((a,b)=>a-b);
  console.log('healthz RTT: min ' + times[0].toFixed(2) + ' med ' + times[5].toFixed(2) + ' max ' + times[9].toFixed(2) + ' ms');
})();
