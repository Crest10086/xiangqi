#!/usr/bin/env bash
# run_single_probe.sh — open the built single-file xiangqi.html over file:// in headless Chrome
# and drive the real UI (same probe expression as run_ui_probe.sh). This is the legacy/blob path:
# no COOP/COEP, no 50.7MB network, engine comes from the inlined small-network build.
set -u
CDPPORT="${1:-9347}"
NT_EXPR='C:/Users/35165/xiangqi/bench/new_engine/ui_probe_expr.js'
NT_CDP='C:/Users/35165/xiangqi/bench/new_engine/cdp_run_probe.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
PAGE='file:///C:/Users/35165/xiangqi/xiangqi.html'
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-single' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-single"
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --allow-file-access-from-files \
  --remote-debugging-port="$CDPPORT" \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-single \
  "$PAGE" > "$NT_SCRATCH/chrome_single.out" 2>&1 &
CH=$!
sleep 6
"$NODE" "$NT_CDP" "$CDPPORT" "$PAGE" "$NT_EXPR" 300
RC=$?
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-single' >/dev/null 2>&1
exit $RC
