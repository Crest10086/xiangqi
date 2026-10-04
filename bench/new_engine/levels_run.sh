#!/usr/bin/env bash
# levels_run.sh <taskfile-basename> <logname> [poll_iters] — TEST-ONLY runner for card t_ef6e93b8.
# Same serve/Chrome recipe as bench/new_engine/run_driver.sh, but points at levels_driver.html.
set -u
TASK="${1:-task_levels.json}"
LOGN="${2:-levels.log}"
POLL="${3:-600}"
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
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-lvl' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-lvl"
"$NODE" "$NT_SERVE" "$NT_ROOT" 8798 "$NT_LOG" > "$SCRATCH/serve_lvl.out" 2>&1 &
SRV=$!
sleep 1
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-lvl \
  "http://127.0.0.1:8798/levels_driver.html?task=$TASK" > "$SCRATCH/chrome_lvl.out" 2>&1 &
CH=$!
for i in $(seq 1 "$POLL"); do
  if grep -q 'DRV DONE' "$LOG" 2>/dev/null; then echo POLL-DONE; break; fi
  sleep 2
done
sleep 1
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-lvl' >/dev/null 2>&1
kill "$SRV" 2>/dev/null
echo "===== LOG $MS_LOG ====="
wc -l "$MS_LOG" 2>/dev/null
grep -c '^L|' "$MS_LOG" 2>/dev/null
