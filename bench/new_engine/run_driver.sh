#!/usr/bin/env bash
# run_driver.sh <taskfile-basename> <logname> — serve bench/new_engine (no COOP/COEP), run headless Chrome, poll for DONE
set -u
TASK="${1:-task.json}"
LOGN="${2:-driver.log}"
# MSYS paths for shell builtins; NATIVE forward-slash paths for node/powershell/chrome (MSYS conversion is off)
MS_LOG="/c/Users/35165/xiangqi/bench/new_engine_logs/$LOGN"
NT_ROOT='C:/Users/35165/xiangqi/bench/new_engine'
NT_SERVE='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/serve_upg.js'
NT_LOG="C:/Users/35165/xiangqi/bench/new_engine_logs/$LOGN"
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
SCRATCH='/c/Users/35165/AppData/Local/hermes/cache/scratch'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
LOG="$MS_LOG"
mkdir -p /c/Users/35165/xiangqi/bench/new_engine_logs
rm -f "$LOG"
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-opt' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-opt"
"$NODE" "$NT_SERVE" "$NT_ROOT" 8797 "$NT_LOG" > "$NT_SCRATCH/serve_opt.out" 2>&1 &
SRV=$!
sleep 1
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-opt \
  "http://127.0.0.1:8797/driver.html?task=$TASK" > "$SCRATCH/chrome_opt.out" 2>&1 &
CH=$!
POLL="${3:-120}"
for i in $(seq 1 "$POLL"); do
  if grep -q 'DRV DONE' "$LOG" 2>/dev/null; then echo POLL-DONE; break; fi
  sleep 2
done
sleep 1
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-opt' >/dev/null 2>&1
kill "$SRV" 2>/dev/null
echo "===== LOG $MS_LOG ====="
wc -l "$MS_LOG" 2>/dev/null
