#!/usr/bin/env bash
# run_bench_rss2.sh — clean RSS measurement (bench_upg) + LAN-page fetch test afterwards
set -x
cd /c/Users/35165/AppData/Local/hermes/cache/scratch
NODE=/c/Users/35165/AppData/Local/hermes/node/node.exe

rm -f upg_bench.log rss_samples.txt
powershell -NoProfile -ExecutionPolicy Bypass -File kill_chrome_by_profile.ps1 'chrome-upg' >/dev/null 2>&1
rm -rf chrome-upg

powershell -NoProfile -ExecutionPolicy Bypass -File sample_rss.ps1 'chrome-upg' 80 C:/Users/35165/AppData/Local/hermes/cache/scratch/rss_samples.txt >/dev/null 2>&1 &

'/c/Program Files/Google/Chrome/Application/chrome.exe' \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir=C:/Users/35165/AppData/Local/hermes/cache/scratch/chrome-upg \
  'http://127.0.0.1:8796/bench_upg.html' > chrome_upg.out 2>&1 &

for i in $(seq 1 60); do
  if grep -q 'ALL DONE' upg_bench.log 2>/dev/null; then echo POLL-DONE; break; fi
  sleep 2
done
sleep 40
powershell -NoProfile -ExecutionPolicy Bypass -File kill_chrome_by_profile.ps1 'chrome-upg' >/dev/null 2>&1
sleep 2
echo '===== RSS ====='
cat rss_samples.txt
