#!/usr/bin/env bash
# run_online_smoke.sh — serve the repo root WITHOUT COOP/COEP (Pages-like), run headless Chrome on
# online_smoke.html (the production files, unmodified), poll for SMOKE DONE.
set -u
NT_ROOT='C:/Users/35165/xiangqi'
NT_SERVE='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/serve_upg.js'
NT_LOG='C:/Users/35165/xiangqi/bench/new_engine_logs/online_smoke.log'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
SCRATCH='/c/Users/35165/AppData/Local/hermes/cache/scratch'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
MS_LOG='/c/Users/35165/xiangqi/bench/new_engine_logs/online_smoke.log'
mkdir -p /c/Users/35165/xiangqi/bench/new_engine_logs
rm -f "$MS_LOG"
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-smoke' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-smoke"
"$NODE" "$NT_SERVE" "$NT_ROOT" 8798 "$NT_LOG" > "$NT_SCRATCH/serve_smoke.out" 2>&1 &
SRV=$!
sleep 1
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-smoke \
  "http://127.0.0.1:8798/online_smoke.html" > "$SCRATCH/chrome_smoke.out" 2>&1 &
CH=$!
for i in $(seq 1 "${1:-150}"); do
  if grep -q 'SMOKE DONE' "$MS_LOG" 2>/dev/null; then echo POLL-DONE; break; fi
  if grep -q 'SMOKE FAIL' "$MS_LOG" 2>/dev/null; then echo POLL-FAIL; break; fi
  sleep 2
done
sleep 1
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-smoke' >/dev/null 2>&1
kill "$SRV" 2>/dev/null
echo "===== LOG $MS_LOG ====="
cat "$MS_LOG" 2>/dev/null
