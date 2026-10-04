#!/usr/bin/env bash
# run_lan_fetch_test.sh — fetch test from an http LAN page (game-self-host alternative)
set -x
cd /c/Users/35165/AppData/Local/hermes/cache/scratch
rm -f upg_bench.log
powershell -NoProfile -ExecutionPolicy Bypass -File kill_chrome_by_profile.ps1 'chrome-upg' >/dev/null 2>&1
rm -rf chrome-upg
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-upg \
  'http://192.168.10.99:8796/mixed3.html' > chrome_upg.out 2>&1 &
for i in $(seq 1 20); do
  if grep -q 'L3 lan100 move' upg_bench.log 2>/dev/null; then echo POLL-DONE; break; fi
  sleep 2
done
sleep 1
powershell -NoProfile -ExecutionPolicy Bypass -File kill_chrome_by_profile.ps1 'chrome-upg' >/dev/null 2>&1
echo '===== LOG ====='
cat upg_bench.log 2>/dev/null
