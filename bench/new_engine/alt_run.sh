#!/usr/bin/env bash
# alt_run.sh <taskfile-basename> <logname> [poll_iters] — TEST-ONLY runner for card t_9f14af96.
# Same serve/Chrome recipe as levels_run.sh (card t_ef6e93b8) but points at alt_driver.html
# and uses its own port (8799) + Chrome profile (chrome-alt) so it never collides with 8797/8798.
set -u
TASK="${1:-task_alt.json}"
LOGN="${2:-alt.log}"
POLL="${3:-900}"
MS_LOG="/c/Users/35165/xiangqi/bench/new_engine_logs/$LOGN"
NT_ROOT='C:/Users/35165/xiangqi/bench/new_engine'
NT_SERVE='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/serve_upg.js'
NT_LOG="C:/Users/35165/xiangqi/bench/new_engine_logs/$LOGN"
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
SCRATCH='/c/Users/35165/AppData/Local/hermes/profiles/programmer/cache/scratch'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/profiles/programmer/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
LOG="$MS_LOG"
mkdir -p /c/Users/35165/xiangqi/bench/new_engine_logs
rm -f "$LOG"
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-alt' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-alt"
"$NODE" "$NT_SERVE" "$NT_ROOT" 8799 "$NT_LOG" > "$SCRATCH/serve_alt.out" 2>&1 &
SRV=$!
sleep 1
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/profiles/programmer/cache/scratch/chrome-alt \
  "http://127.0.0.1:8799/alt_driver.html?task=$TASK" > "$SCRATCH/chrome_alt.out" 2>&1 &
CH=$!
LAST=0
for i in $(seq 1 "$POLL"); do
  if grep -q 'DRV DONE' "$LOG" 2>/dev/null; then echo POLL-DONE; break; fi
  NOW=$(grep -c '^PROG|' "$LOG" 2>/dev/null || echo 0)
  if [ "$NOW" != "$LAST" ]; then echo "progress positions=$NOW at iter=$i"; LAST="$NOW"; fi
  sleep 2
done
sleep 1
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-alt' >/dev/null 2>&1
kill "$SRV" 2>/dev/null
echo "===== LOG $MS_LOG ====="
wc -l "$MS_LOG" 2>/dev/null
grep -c '^L|' "$MS_LOG" 2>/dev/null
grep -c 'SKIP' "$MS_LOG" 2>/dev/null
