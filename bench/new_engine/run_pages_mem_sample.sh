#!/usr/bin/env bash
# run_pages_mem_sample.sh — memory cost of the LIVE site, sampled from the OS.
# Why OS-level sampling: performance.measureUserAgentSpecificMemory() never resolves in headless
# Chrome (measured: >60s without settling), and CDP Performance.getMetrics reports only the main
# frame's JS heap — the engine lives in a worker, so its footprint is invisible to the page.
# While the shipped UI probe drives the real deployed index.html (engine load + four tiers), we
# sample the Chrome process group's working set from Windows every 2 s.
#   usage: bash bench/new_engine/run_pages_mem_sample.sh [cdpPort] [maxWaitSec]
# Outputs: bench/new_engine_logs/pages_mem_sample.csv  (t_ms,working_set_mb,chrome_procs)
#          bench/new_engine_logs/pages_mem_sample.log  (the CDP driver's full output)
# Desktop numbers only. They are NOT a phone measurement (see ONLINE_INTEGRATION.md §6).
set -u
CDPPORT="${1:-9421}"
MAXWAIT="${2:-260}"
NT_PROBE='C:/Users/35165/xiangqi/bench/new_engine/cdp_pages_probe.js'
NT_EXPR='C:/Users/35165/xiangqi/bench/new_engine/ui_probe_expr.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_PS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/chrome_working_set.ps1'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
CHROME='/c/Program Files/Google/Chrome/Application/chrome.exe'
LOGDIR='/c/Users/35165/xiangqi/bench/new_engine_logs'
PAGE='https://crest10086.github.io/xiangqi/index.html'
CSV="$LOGDIR/pages_mem_sample.csv"
LOG="$LOGDIR/pages_mem_sample.log"
PROFILE='C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-pages-mem'
mkdir -p "$LOGDIR"; rm -f "$CSV" "$LOG"

powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-pages-mem' >/dev/null 2>&1
rm -rf "$PROFILE" 2>/dev/null
"$CHROME" \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --remote-debugging-port="$CDPPORT" \
  --user-data-dir="$PROFILE" \
  "$PAGE" > "$NT_SCRATCH/chrome_mem.out" 2>&1 &
CH=$!
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$CDPPORT/json/list" && break; sleep 1; done

"$NODE" "$NT_PROBE" "$CDPPORT" "$PAGE" ui "$NT_EXPR" "$MAXWAIT" > "$LOG" 2>&1 &
NP=$!

T0=$(date +%s%3N)
echo 't_ms,working_set_mb,chrome_procs' > "$CSV"
n=0
while [ $n -lt $((MAXWAIT / 2 + 15)) ]; do
  kill -0 "$NP" 2>/dev/null || break
  read -r ws cnt <<<"$(powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_PS" '*chrome-pages-mem*' 2>/dev/null | tr -d '\r')"
  echo "$(( $(date +%s%3N) - T0 )),$ws,$cnt" >> "$CSV"
  n=$((n + 1))
  sleep 2
done
wait "$NP"; RC=$?
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-pages-mem' >/dev/null 2>&1
rm -rf "$PROFILE" 2>/dev/null
echo '=== driver summary ==='
grep -E 'STATE|firstLoadMs|"waitedMs"|"name"|"threads"|JS HEAP|UA MEMORY' "$LOG" | head -24
echo '=== memory samples (t_ms, chrome working set MB, procs) ==='
cat "$CSV"
exit "$RC"
