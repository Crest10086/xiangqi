#!/usr/bin/env bash
# run_uci_dump.sh — dump mistboard UCI options via headless chrome (SW dance included)
set -x
cd /c/Users/35165/AppData/Local/hermes/cache/scratch
rm -f upg_bench.log
powershell -NoProfile -ExecutionPolicy Bypass -File kill_chrome_by_profile.ps1 'chrome-upg' >/dev/null 2>&1
rm -rf chrome-upg
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-upg \
  'http://127.0.0.1:8796/dump_uci3.html' > chrome_upg.out 2>&1 &
for i in $(seq 1 40); do
  if grep -q 'UCIDUMP DONE' upg_bench.log 2>/dev/null; then echo POLL-DONE; break; fi
  sleep 2
done
sleep 1
powershell -NoProfile -ExecutionPolicy Bypass -File kill_chrome_by_profile.ps1 'chrome-upg' >/dev/null 2>&1
echo '===== LOG ====='
cat upg_bench.log 2>/dev/null
