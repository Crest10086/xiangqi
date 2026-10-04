#!/usr/bin/env bash
# run_ui_probe.sh — drive the REAL index.html UI in headless Chrome over CDP:
# serve the repo root WITH COOP/COEP (self-hosted deployment case), open index.html, evaluate
# bench/new_engine/ui_probe_expr.js (which clicks 新对局 / 难度选择 and plays real moves).
# The Pages case (no COOP/COEP headers -> coi-serviceworker) is covered by run_online_smoke.sh.
set -u
PORT="${1:-9341}"
CDPPORT=$((PORT + 1))
NT_ROOT='C:/Users/35165/xiangqi'
NT_SERVE='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/serve.js'
NT_EXPR='C:/Users/35165/xiangqi/bench/new_engine/ui_probe_expr.js'
NT_CDP='C:/Users/35165/xiangqi/bench/new_engine/cdp_run_probe.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_LOG='C:/Users/35165/xiangqi/bench/new_engine_logs/ui_probe.log'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-ui' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-ui"
"$NODE" "$NT_SERVE" "$NT_ROOT" "$PORT" "$NT_LOG" > "$NT_SCRATCH/serve_ui.out" 2>&1 &
SRV=$!
sleep 1
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --remote-debugging-port="$CDPPORT" \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-ui \
  "http://127.0.0.1:$PORT/index.html" > "$NT_SCRATCH/chrome_ui.out" 2>&1 &
CH=$!
sleep 6
"$NODE" "$NT_CDP" "$CDPPORT" "http://127.0.0.1:$PORT/index.html" "$NT_EXPR"
RC=$?
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-ui' >/dev/null 2>&1
kill "$SRV" 2>/dev/null
exit $RC
