#!/usr/bin/env bash
# build_nothreads.sh — single-thread (no pthread) build of Pikafish for browsers.
# No SharedArrayBuffer needed => runs WITHOUT COOP/COEP headers (GitHub Pages as-is).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
out_dir="${1:-dist/wasm_nothreads}"
mkdir -p "$out_dir"

mapfile -t source_paths < <(find src -name '*.cpp' -not -path '*/universal/*' | sort)

em++ \
  "${source_paths[@]}" \
  -Isrc \
  -std=c++17 \
  -O3 -funroll-loops \
  -DNDEBUG \
  -DIS_64BIT \
  -DNO_PREFETCH \
  -DUSE_POPCNT \
  -DUSE_SSE2 -msse2 \
  -DUSE_SSSE3 -mssse3 \
  -DUSE_SSE41 -msse4.1 \
  -msimd128 \
  -fno-exceptions \
  -sWASM=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=Pikafish \
  -sENVIRONMENT=web,worker \
  -sEXPORTED_FUNCTIONS=_pikafish_initialize,_pikafish_command,_main,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=cwrap,FS \
  -sINITIAL_MEMORY=256MB \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMAXIMUM_MEMORY=1GB \
  -sSTACK_SIZE=3MB \
  -sNO_EXIT_RUNTIME=1 \
  -sINVOKE_RUN=0 \
  -o "$out_dir/pikafish.js"

cp Copying.txt "$out_dir/COPYING.txt"
echo "BUILD OK -> $out_dir/pikafish.js"
