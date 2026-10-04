#!/usr/bin/env bash
# tier_run.sh <taskfile-basename> <logname> [poll_iters] [driver.html] — TEST-ONLY runner for card
# t_a8096ea3. Same serve/Chrome recipe as alt_run.sh (card t_f844043c); driver defaults to
# tier_driver.html (position calibration), pass tier_games.html for the 互弈 harness. Port 8801 +
# Chrome profile chrome-tier, so it never collides with 8797/8798/8799/8800.
set -u
TASK="${1:-task_tier_r1.json}"
LOGN="${2:-tier_r1.log}"
POLL="${3:-1200}"
DRIVER="${4:-tier_driver.html}"
NT_ROOT='C:/Users/35165/xiangqi/bench/new_engine'
NT_SERVE='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/serve_upg.js'
NT_LOG="C:/Users/35165/xiangqi/bench/new_engine_logs/$LOGN"
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
SCRATCH='/c/Users/35165/AppData/Local/hermes/profiles/programmer/cache/scratch'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/profiles/programmer/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
LOG="$NT_LOG"
mkdir -p /c/Users/35165/xiangqi/bench/new_engine_logs
rm -f "$LOG"
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-tier' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-tier"
"$NODE" "$NT_SERVE" "$NT_ROOT" 8801 "$NT_LOG" > "$SCRATCH/serve_tier.out" 2>&1 &
SRV=$!
sleep 1
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/profiles/programmer/cache/scratch/chrome-tier \
  "http://127.0.0.1:8801/$DRIVER?task=$TASK" > "$SCRATCH/chrome_tier.out" 2>&1 &
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
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-tier' >/dev/null 2>&1
kill "$SRV" 2>/dev/null
echo "log lines: $(wc -l < "$LOG" 2>/dev/null || echo 0)"
