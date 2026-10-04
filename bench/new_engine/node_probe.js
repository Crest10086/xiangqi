/* new_engine/node_probe.js — can Node drive the mistboard pthread build? */
const fs = require('fs');
const path = require('path');
const DIR = path.resolve(__dirname);
const Pikafish = require(DIR + '/pikafish.js');
const net = fs.readFileSync(DIR + '/pikafish.nnue');
const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const lines = [];
Pikafish({
  wasmBinary: fs.readFileSync(DIR + '/pikafish.wasm'),
  mainScriptUrlOrBlob: DIR + '/pikafish.js',
  locateFile: (f) => DIR + '/' + f,
  print: (l) => { lines.push(String(l)); },
  printErr: (l) => { lines.push('[err] ' + String(l)); },
}).then(async (m) => {
  console.log('MODULE OK');
  m.FS.writeFile('/pikafish.nnue', new Uint8Array(net.buffer.slice(net.byteOffset, net.byteOffset + net.byteLength)));
  const init = m.cwrap('pikafish_initialize', null, []);
  const cmd = m.cwrap('pikafish_command', null, ['string']);
  init();
  cmd('uci');
  await new Promise(r => setTimeout(r, 1500));
  console.log('--- id/eval lines ---');
  console.log(lines.filter(l => /id name|id version|NNUE|ERROR|error/i.test(l)).join('\n').slice(0, 600));
  cmd('setoption name Threads value 1');
  cmd('setoption name Hash value 64');
  cmd('isready');
  await new Promise(r => setTimeout(r, 1500));
  console.log('--- readyok? ---');
  console.log(lines.filter(l => /readyok/i.test(l)).join('\n'));
  const mark = lines.length;
  cmd('position fen ' + FEN);
  cmd('go movetime 500');
  await new Promise(r => setTimeout(r, 2500));
  const seg = lines.slice(mark);
  console.log('--- search lines (' + seg.length + ') ---');
  console.log(seg.slice(-6).join('\n'));
  process.exit(0);
}, (e) => { console.log('INIT FAIL: ' + (e && (e.message || e))); process.exit(1); });
