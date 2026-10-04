/* new_engine/old_uci_dump.js — dump the CURRENT PRODUCTION engine's UCI options (small-net 2024 build)
 * for side-by-side comparison with the new engine's option list.
 * output: bench/new_engine_logs/old_engine_uci.txt
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', '..', 'js', 'engines', 'pikafish') + path.sep;
const OUT = path.join(__dirname, '..', 'new_engine_logs', 'old_engine_uci.txt');
const PK = require(DIR + 'pikafish.js');
const lines = [];
PK({
  wasmBinary: fs.readFileSync(DIR + 'pikafish.wasm'),
  locateFile: (p) => path.join(DIR, p),
  getPreloadedPackage: () => {
    const b = fs.readFileSync(DIR + 'pikafish.data');
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
  onReceiveStdout: (l) => lines.push(String(l).replace(/[\r\n]+$/, '')),
  onReceiveStderr: (l) => lines.push('[err] ' + String(l)),
  onExit: () => {},
}).then((m) => {
  m.sendCommand('uci');
  m.sendCommand('setoption name Repetition Rule value AsianRule');
  m.sendCommand('setoption name Draw Rule value None');
  m.sendCommand('setoption name Sixty Move Rule value false');
  m.sendCommand('setoption name UCI_LimitStrength value true');
  m.sendCommand('setoption name UCI_Elo value 1400');
  m.sendCommand('setoption name Skill Level value 20');
  m.sendCommand('setoption name MultiPV value 4');
  m.sendCommand('setoption name Threads value 1');
  m.sendCommand('setoption name Hash value 256');
  m.sendCommand('setoption name Nonsense Option value 1');
  m.sendCommand('isready');
  setTimeout(() => {
    fs.writeFileSync(OUT, lines.join('\n'));
    console.log('lines=' + lines.length + ' -> ' + OUT);
    console.log(lines.filter(l => /^id |^option |No such|Unknown|readyok/i.test(l)).join('\n'));
    process.exit(0);
  }, 1500);
}).catch((e) => { console.log('INIT FAIL ' + e); process.exit(1); });
