#!/usr/bin/env bash
# clean_r3.sh — TEST-ONLY for card t_ef6e93b8: kill all node+chrome from this bench, then run round 3 once.
set -u
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-lvl' >/dev/null 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-opt' >/dev/null 2>&1
powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like '*hermes*node.exe' } | Stop-Process -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1
sleep 3
cd /c/Users/35165/xiangqi/bench/new_engine
bash levels_run.sh task_levels_r3.json levels_r3.log 500 2>&1 | tail -4
echo CLEAN_R3_EXIT
