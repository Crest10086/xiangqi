#!/usr/bin/env bash
# run_pages_probe.sh — drive the DEPLOYED site (GitHub Pages) in headless Chrome over CDP.
# This is the only probe that touches the real production deployment: no local server, no
# COOP/COEP from any local host (GitHub Pages cannot send them), assets from the real CDN,
# isolation must come from the shipped coi-serviceworker.js.
#   usage: bash bench/new_engine/run_pages_probe.sh smoke [cdpPort] [maxWaitSec]
#          bash bench/new_engine/run_pages_probe.sh ui    [cdpPort] [maxWaitSec]
#   env:   PAGE_URL / EXPR_FILE override the target page and probe expression (ui mode);
#          DONE_MARK / FAIL_MARK set the completion markers a smoke page writes to its #log.
# Logs are appended to bench/new_engine_logs/pages_<mode>.log so the evidence is kept in the repo.
set -u
MODE="${1:-smoke}"
CDPPORT="${2:-9361}"
MAXWAIT="${3:-600}"
NT_ROOT='C:/Users/35165/xiangqi'
NT_PROBE='C:/Users/35165/xiangqi/bench/new_engine/cdp_pages_probe.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
CHROME='/c/Program Files/Google/Chrome/Application/chrome.exe'
LOGDIR='/c/Users/35165/xiangqi/bench/new_engine_logs'
LOG="$LOGDIR/pages_$MODE.log"
mkdir -p "$LOGDIR"

case "$MODE" in
  smoke) PAGE='https://crest10086.github.io/xiangqi/online_smoke.html' ;;
  ui)    PAGE='https://crest10086.github.io/xiangqi/index.html' ;;
  *) echo "mode must be smoke|ui"; exit 2 ;;
esac
# PAGE_URL overrides which live page to drive (mode ui then runs EXPR_FILE against it);
# EXPR_FILE overrides the probe expression. Used for the live device self-check page.
PAGE="${PAGE_URL:-$PAGE}"
EXPR_FILE="${EXPR_FILE:-C:/Users/35165/xiangqi/bench/new_engine/ui_probe_expr.js}"

# A profile dir that is still held by a chrome that survived the previous run makes the new chrome
# hand off to the dead singleton and never open the DevTools port (observed as ECONNREFUSED).
# So: kill by profile marker, wait for the processes to actually disappear, then use a fresh dir.
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-pages' >/dev/null 2>&1
PS_COUNT='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/count_pages_chrome.ps1'
for i in $(seq 1 20); do
  n=$(powershell -NoProfile -ExecutionPolicy Bypass -File "$PS_COUNT" 2>/dev/null | tr -d '[:space:]')
  [ "$n" = "0" ] && break
  sleep 1
done
# Warm/returning-visitor run: pass COLD=0 plus a PROFILE_DIR that survives between runs, so the
# service worker registered by the previous run is still there and no reload is needed.
PROFILE="${PROFILE_DIR:-C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-pages-$$}"
if [ "${COLD:-1}" = "0" ] && [ -z "${PROFILE_DIR:-}" ]; then rm -rf "$PROFILE" 2>/dev/null; fi
"$CHROME" \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --remote-debugging-port="$CDPPORT" \
  --user-data-dir="$PROFILE" \
  "$PAGE" > "$NT_SCRATCH/chrome_pages.out" 2>&1 &
CH=$!
for i in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$CDPPORT/json/list" && break
  sleep 1
done
sleep 4
if [ "$MODE" = ui ]; then
  "$NODE" "$NT_PROBE" "$CDPPORT" "$PAGE" ui "$EXPR_FILE" "$MAXWAIT" 2>&1 | tee "$LOG"
else
  "$NODE" "$NT_PROBE" "$CDPPORT" "$PAGE" smoke "$MAXWAIT" 2>&1 | tee "$LOG"
fi
RC=${PIPESTATUS[0]}
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-pages' >/dev/null 2>&1
if [ "${COLD:-1}" != "0" ]; then rm -rf "$PROFILE" 2>/dev/null; fi
exit "$RC"
