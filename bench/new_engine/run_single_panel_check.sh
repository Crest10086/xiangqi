#!/usr/bin/env bash
# run_single_panel_check.sh — verify the single-file build (file://) does not claim a 50.7MB
# download: the panel must say "正在准备内置引擎…（无需下载）" (card t_f51aab68).
set -u
CDPPORT="${1:-9482}"
NT_CDP='C:/Users/35165/xiangqi/bench/new_engine/cdp_single_panel_check.js'
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_SCRATCH='C:/Users/35165/AppData/Local/hermes/cache/scratch'
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
PAGE='file:///C:/Users/35165/xiangqi/xiangqi.html'
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-single-panel' >/dev/null 2>&1
rm -rf "$NT_SCRATCH/chrome-single-panel"
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --allow-file-access-from-files \
  --remote-debugging-port="$CDPPORT" \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-single-panel \
  "$PAGE" > "$NT_SCRATCH/chrome_single_panel.out" 2>&1 &
CH=$!
sleep 6
"$NODE" "$NT_CDP" "$CDPPORT" "$PAGE"
RC=$?
kill "$CH" 2>/dev/null
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-single-panel' >/dev/null 2>&1
exit $RC
