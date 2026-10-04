#!/usr/bin/env bash
# run_upg_bench.sh — headless bench for the upgrade feasibility study
set -x
cd /c/Users/35165/AppData/Local/hermes/cache/scratch
NODE=/c/Users/35165/AppData/Local/hermes/node/node.exe

# 0) fresh log
rm -f upg_bench.log

# 1) start server if needed
if ! netstat -ano | grep -q 'LISTENING.*8796'; then
  nohup "$NODE" serve_upg.js upg_test 8796 C:/Users/35165/AppData/Local/hermes/cache/scratch/upg_bench.log > serve_upg.out 2>&1 &
  sleep 1
fi

# 2) kill any leftover chrome for this profile
powershell -NoProfile -ExecutionPolicy Bypass -File kill_chrome_by_profile.ps1 'chrome-upg' >/dev/null 2>&1
rm -rf chrome-upg

# 3) launch headless chrome
'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-upg \
  'http://127.0.0.1:8796/bench_upg.html' > chrome_upg.out 2>&1 &

# 4) poll log
for i in $(seq 1 100); do
  if grep -q 'ALL DONE' upg_bench.log 2>/dev/null; then echo POLL-DONE-OK; break; fi
  if grep -q 'P2/P3 FATAL' upg_bench.log 2>/dev/null; then echo POLL-FATAL; break; fi
  if grep -q 'cannot reach isolation' upg_bench.log 2>/dev/null; then echo POLL-NOCOI; break; fi
  sleep 2
done
sleep 2

# 5) kill chrome
powershell -NoProfile -ExecutionPolicy Bypass -File kill_chrome_by_profile.ps1 'chrome-upg' >/dev/null 2>&1
echo '===== LOG ====='
cat upg_bench.log 2>/dev/null || echo '(no log)'
