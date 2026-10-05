#!/usr/bin/env bash
# run_pages_reload_probe.sh — run the "下完一步变回开局" reload probe against the LIVE GitHub Pages
# deployment (the exact Xiaomi-browser scenario, card t_f51aab68): cold profile -> pick tier ->
# click 新对局 -> play a move -> coi-serviceworker reloads the page -> the game must survive.
#   usage: bash bench/new_engine/run_pages_reload_probe.sh [cdpPort]
set -u
CDPPORT="${1:-9511}"
PAGE='https://crest10086.github.io/xiangqi/index.html'
NT_ROOT='C:/Users/35165/xiangqi'
NT_CDP='C:/Users/35165/xiangqi/bench/new_engine/cdp_reload_probe.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
CHROME='/c/Program Files/Google/Chrome/Application/chrome.exe'
LOGDIR="$NT_ROOT/bench/new_engine_logs"
mkdir -p "$LOGDIR"
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-live' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-live"
"$CHROME" \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --remote-debugging-port="$CDPPORT" \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-live \
  "$PAGE" > "$NT_SCRATCH/chrome_live.out" 2>&1 &
CH=$!
sleep 6
"$NODE" "$NT_CDP" "$CDPPORT" "$PAGE" 300 2>&1 | tee "$LOGDIR/pages_reload_probe.log"
RC=${PIPESTATUS[0]}
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-live' >/dev/null 2>&1
exit "$RC"
