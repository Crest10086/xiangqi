#!/usr/bin/env bash
# run_perf_probe.sh — drive the device self-check page (perf_probe.html) in headless Chrome.
#
# Card t_0918db73 acceptance: the self-check page must load the engine, report engine memory /
# thread count / first-load stages, and — when it cannot load — print the real reason. This script
# is how that is checked on a desktop (the phone run is done by a human and read off the page).
#
#   bash bench/new_engine/run_perf_probe.sh [cdpPort] [maxWaitSec]
#   env:  MODE=local|live   local = serve the repo at a fixed download rate (default),
#                           live  = the deployed GitHub Pages page (no local server)
#         RATE=bytesPerSec  nnue streaming rate for the local server (default 4MB/s)
#         COI=0             omit COOP/COEP locally -> reproduces the Pages case (page reloads once)
#         THROTTLE=n        CPU throttle (emulation only; known NOT to affect the engine's pthreads)
#         PROFILE_DIR / COLD=0   warm/returning-visitor run
# Log: bench/new_engine_logs/perf_probe.log
set -u
CDPPORT="${1:-9371}"
MAXWAIT="${2:-240}"
MODE="${MODE:-local}"
RATE="${RATE:-4194304}"
NT_ROOT="${ROOT:-C:/Users/35165/xiangqi}"   # ROOT= lets you point the local server at a trimmed copy
                                               # (e.g. a dir without js/engines/... to force a load failure)
NT_PROBE='C:/Users/35165/xiangqi/bench/new_engine/cdp_pages_probe.js'
NT_SERVE='C:/Users/35165/xiangqi/bench/new_engine/serve_slow.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_COUNT='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/count_pages_chrome.ps1'
SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
CHROME='/c/Program Files/Google/Chrome/Application/chrome.exe'
LOGDIR='/c/Users/35165/xiangqi/bench/new_engine_logs'
NT_LOGDIR='C:/Users/35165/xiangqi/bench/new_engine_logs'   # node 不认 MSYS 路径（本机关闭了路径转换）
LOG="$LOGDIR/perf_probe.log"
mkdir -p "$LOGDIR"
export DONE_MARK='自检 DONE'
export FAIL_MARK='自检 FAIL'

if [ "$MODE" = live ]; then
  PAGE='https://crest10086.github.io/xiangqi/perf_probe.html?auto=1'
else
  PAGE="http://127.0.0.1:8797/perf_probe.html?auto=1"
  "$NODE" "$NT_SERVE" "$NT_ROOT" 8797 "$NT_LOGDIR/perf_probe_server.log" "$RATE" > "$SCRATCH/serve_perf.out" 2>&1 &
  SRV=$!
  sleep 1
fi

powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-pages' >/dev/null 2>&1
for i in $(seq 1 20); do
  n=$(powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_COUNT" 2>/dev/null | tr -d '[:space:]')
  [ "$n" = "0" ] && break
  sleep 1
done
PROFILE="${PROFILE_DIR:-C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-pages-perf-$$}"
if [ "${COLD:-1}" = "0" ] && [ -z "${PROFILE_DIR:-}" ]; then rm -rf "$PROFILE" 2>/dev/null; fi

"$CHROME" \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --remote-debugging-port="$CDPPORT" \
  --user-data-dir="$PROFILE" \
  "$PAGE" > "$SCRATCH/chrome_perf.out" 2>&1 &
CH=$!
for i in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$CDPPORT/json/list" && break
  sleep 1
done
sleep 4
"$NODE" "$NT_PROBE" "$CDPPORT" "$PAGE" smoke "$MAXWAIT" 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-pages' >/dev/null 2>&1
[ "${SRV:-}" ] && kill "$SRV" 2>/dev/null
if [ "${COLD:-1}" != "0" ]; then rm -rf "$PROFILE" 2>/dev/null; fi
exit "$RC"
