#!/usr/bin/env bash
# run_reload_probe.sh — reproduce the "下完一步变回开局" case against a server WITHOUT COOP/COEP
# (the GitHub Pages case): the shipped coi-serviceworker.js has to take over and reload the page.
#   usage: bash bench/new_engine/run_reload_probe.sh [port]
set -u
PORT="${1:-9381}"
CDPPORT=$((PORT + 1))
NT_ROOT='C:/Users/35165/xiangqi'
NT_SERVE='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/serve_upg.js'
NT_CDP='C:/Users/35165/xiangqi/bench/new_engine/cdp_reload_probe.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
CHROME='/c/Program Files/Google/Chrome/Application/chrome.exe'
LOGDIR="$NT_ROOT/bench/new_engine_logs"
mkdir -p "$LOGDIR"
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-reload' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-reload"
"$NODE" "$NT_SERVE" "$NT_ROOT" "$PORT" "$LOGDIR/reload_probe_serve.log" > "$NT_SCRATCH/serve_reload.out" 2>&1 &
SRV=$!
sleep 1
"$CHROME" \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --remote-debugging-port="$CDPPORT" \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-reload \
  "http://127.0.0.1:$PORT/index.html" > "$NT_SCRATCH/chrome_reload.out" 2>&1 &
CH=$!
sleep 5
"$NODE" "$NT_CDP" "$CDPPORT" "http://127.0.0.1:$PORT/index.html" 240 2>&1 | tee "$LOGDIR/reload_probe.log"
RC=${PIPESTATUS[0]}
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-reload' >/dev/null 2>&1
kill "$SRV" 2>/dev/null
exit "$RC"
