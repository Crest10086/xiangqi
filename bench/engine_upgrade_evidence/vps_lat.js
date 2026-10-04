const net = require('net');
function tcp(host, port, n) {
  return new Promise((resolve) => {
    const times = []; let i = 0;
    const next = () => {
      if (i++ >= n) return resolve(times);
      const t0 = process.hrtime.bigint();
      const s = net.connect({ host, port, timeout: 5000 });
      s.on('connect', () => { times.push(Number(process.hrtime.bigint()-t0)/1e6); s.destroy(); setTimeout(next, 150); });
      s.on('timeout', () => { times.push(-1); s.destroy(); setTimeout(next, 150); });
      s.on('error', () => { times.push(-2); setTimeout(next, 150); });
    };
    next();
  });
}
(async () => {
  for (const port of [443, 80, 22]) {
    const t = await tcp('23.133.88.86', port, 5);
    console.log('TCP ' + port + ':', t.map(x => x.toFixed(1)).join(', '));
  }
})();
