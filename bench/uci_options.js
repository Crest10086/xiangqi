// bench/uci_options.js — 列出 Pikafish WASM 实际支持的 UCI 选项名
const fs = require('fs');
const path = require('path');
const Pikafish = require(path.join(__dirname, '..', 'js', 'engines', 'pikafish', 'pikafish.js'));
const dir = path.join(__dirname, '..', 'js', 'engines', 'pikafish');
const wasm = fs.readFileSync(path.join(dir, 'pikafish.wasm'));
const data = fs.existsSync(path.join(dir, 'pikafish.data')) ? fs.readFileSync(path.join(dir, 'pikafish.data')) : null;

Pikafish({
  locateFile: (p) => path.join(dir, p),
  wasmBinary: new Uint8Array(wasm).buffer,
  getPreloadedPackage: (n, s) => (data && n.indexOf('pikafish') >= 0 ? data.buffer : null),
  onReceiveStdout: (line) => {
    const s = String(line);
    if (s.indexOf('option name') === 0) console.log(s);
    if (s.indexOf('uciok') >= 0) {
      const m = Pikafish.Module || globalThis.Module;
      console.log('--- test MultiPV ---');
      try {
        const mod = globalThis.__pfmod;
        if (mod && mod.sendCommand) { mod.sendCommand('setoption name MultiPV value 4'); mod.sendCommand('isready'); }
      } catch (e) { console.log('setoption failed: ' + e); }
      setTimeout(() => process.exit(0), 1500);
    }
  },
  onReceiveStderr: () => {},
  noImageDecoding: true, noAudioDecoding: true, noWasmDecoding: true,
}).then((mod) => { globalThis.__pfmod = mod; mod.sendCommand('uci'); })
  .catch((e) => { console.error('LOAD FAIL', e); process.exit(1); });