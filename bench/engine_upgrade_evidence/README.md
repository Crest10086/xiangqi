# Pikafish WebAssembly

Mainline [Pikafish](https://github.com/official-pikafish/Pikafish) built for the
browser: the full-strength xiangqi engine, its NNUE net, pthreads and SIMD128,
driven one UCI command at a time from a Web Worker. It is the local analysis
engine on [mistboard.com/analysis/xiangqi](https://mistboard.com/analysis/xiangqi).

Measured in Chromium with four threads: 662 KB of wasm, engine ready 0.4 s
after the net is in memory, 1.4 million nodes/second from the start position,
`stop` answered in about 20 ms. The net is 50.7 MB compressed (zstd, 66 MB in
memory), so the page that hosts the engine fetches it once and caches it.

## What is here

| path | |
|---|---|
| `source.patch` | 59 lines against upstream: `pikafish_initialize()` / `pikafish_command()` C entry points, and `UCIEngine::loop()` split so `execute(cmd)` runs one command line |
| `build.sh` | the `em++` invocation; flags follow upstream `src/Makefile`'s `wasm32` arch plus the Emscripten module shape `worker.js` expects |
| `worker.js` | a Web Worker that fetches the net with byte progress, writes it to the module filesystem as `/pikafish.nnue`, builds the engine, and forwards UCI lines |
| `dist/` (release assets) | `pikafish.js`, `pikafish.wasm`, `pikafish.nnue`, `SHA256SUMS` |

## Pinned versions

| | |
|---|---|
| Pikafish | `6a59ee2f7b105bff64d9efc2692591107787e2b1` (2026-09-19) |
| Net | `pikafish.nnue` from the `master-net` release, updated 2026-09-06, sha256 `7d13d735…900e`, arch `(62083, 1024, 32, 32, 1)` |
| Toolchain | `emscripten/emsdk:3.1.74` |

Upstream publishes the net as a rolling `master-net` asset with no stable tag.
The engine commit and the net have to match, so both are pinned here and the
release carries the exact net bytes.

## Using it

The host document must be cross-origin isolated (`Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp` or
`credentialless`); the build uses pthreads, which need `SharedArrayBuffer`.

```js
const worker = new Worker('/engine/pikafish/worker.js');
worker.onmessage = ({ data }) => {
  if (data.type === 'net-progress') console.log(data.loaded, '/', data.total);
  if (data.type === 'ready') worker.postMessage({ type: 'command', command: 'uci' });
  if (data.type === 'line') console.log(data.line); // UCI output
};
worker.postMessage({
  type: 'init',
  jsUrl: location.origin + '/engine/pikafish/pikafish.js',
  wasmUrl: location.origin + '/engine/pikafish/pikafish.wasm',
  netUrl: location.origin + '/engine/pikafish/pikafish.nnue',
});
```

Then `setoption name Threads value 4`, `position startpos`, `go depth 18` as
with any UCI engine. `go` returns as soon as the search threads start; output
streams back as `line` messages. Threads are pre-allocated
(`PTHREAD_POOL_SIZE=8`), so `Threads` up to 8 is safe; higher would block the
worker waiting for a pthread that can only be created once the worker yields.

The engine confirms the net on the first search:
`info string NNUE evaluation using pikafish.nnue (64MiB, (62083, 1024, 32, 32, 1))`.
Pikafish has no classical fallback; a missing or mismatched net ends the
process instead of silently evaluating worse.

## Rebuild

```sh
git clone https://github.com/official-pikafish/Pikafish.git
cd Pikafish
git checkout 6a59ee2f7b105bff64d9efc2692591107787e2b1
git apply /path/to/source.patch
mkdir -p wasm && cp /path/to/build.sh wasm/build.sh
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.74 bash wasm/build.sh
# dist/wasm/pikafish.js, dist/wasm/pikafish.wasm
curl -L -o pikafish.nnue https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue
shasum -a 256 pikafish.nnue   # compare with dist/SHA256SUMS before shipping
```

## License

The code is GPL-3.0-or-later, Pikafish's license (`LICENSE`). The net is the
Pikafish team's and carries their `NNUE-License.md`: legal use only, and no
commercial use without their permission. A copy is in this repo and beside
the net in every release.
