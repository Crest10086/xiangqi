#!/usr/bin/env bash
# r3_retry.sh — TEST-ONLY helper for card t_ef6e93b8: kill stale chrome-lvl, rerun round 3.
set -u
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-lvl' >/dev/null 2>&1
sleep 3
cd /c/Users/35165/xiangqi/bench/new_engine
bash levels_run.sh task_levels_r3.json levels_r3.log 400 2>&1 | tail -4
