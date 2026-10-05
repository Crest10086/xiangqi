#!/usr/bin/env bash
# run_ui_visual.sh — evidence run for the UI card (t_f51aab68): screenshots + panel text +
# canvas pixel samples from the REAL index.html, with the 50.7MB NNUE download slowed by CDP
# network emulation so the download phase is observable.
#   usage: bash bench/new_engine/run_ui_visual.sh [cdpPort] [outName]
#   env:   DOWN_KBPS (default 2048) / LEVEL (default 1)
#          SLOW_KBPS — when set, serve with bench/new_engine/serve_slow.js (NO COOP/COEP, i.e. the
#          GitHub Pages case: coi-serviceworker takes over and reloads the page) and stream the
#          .nnue at that KB/s, so the download UI is observable end to end.
set -u
CDPPORT="${1:-9371}"
OUTNAME="${2:-ui_visual_before}"
NT_ROOT='C:/Users/35165/xiangqi'
NT_SERVE='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/serve.js'
if [ -n "${SLOW_KBPS:-}" ]; then NT_SERVE='C:/Users/35165/xiangqi/bench/new_engine/serve_slow.js'; fi
NT_CDP='C:/Users/35165/xiangqi/bench/new_engine/cdp_visual_probe.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
CHROME='/c/Program Files/Google/Chrome/Application/chrome.exe'
OUTDIR="$NT_ROOT/bench/new_engine_logs/$OUTNAME"
mkdir -p "$OUTDIR"
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-visual' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-visual"
if [ -n "${SLOW_KBPS:-}" ]; then
  "$NODE" "$NT_SERVE" "$NT_ROOT" "$CDPPORT" "$OUTDIR/serve.log" "$((SLOW_KBPS * 1024))" > "$NT_SCRATCH/serve_visual.out" 2>&1 &
else
  "$NODE" "$NT_SERVE" "$NT_ROOT" "$CDPPORT" "$OUTDIR/serve.log" > "$NT_SCRATCH/serve_visual.out" 2>&1 &
fi
SRV=$!
sleep 1
"$CHROME" \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --remote-debugging-port="$((CDPPORT + 1))" \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-visual \
  "http://127.0.0.1:$CDPPORT/index.html" > "$NT_SCRATCH/chrome_visual.out" 2>&1 &
CH=$!
sleep 5
"$NODE" "$NT_CDP" "$((CDPPORT + 1))" "http://127.0.0.1:$CDPPORT/index.html" "$NT_ROOT/bench/new_engine_logs/$OUTNAME" 420 2>&1 | tee "$OUTDIR/visual_probe.log"
RC=${PIPESTATUS[0]}
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-visual' >/dev/null 2>&1
kill "$SRV" 2>/dev/null
exit "$RC"
