#!/usr/bin/env bash
# clean_alt.sh — TEST-ONLY cleanup for card t_9f14af96.
# Frees port 8799 and the chrome-alt profile dir. Run before each alt_run.sh round:
# the previous round's serve_upg.js child often survives the script's own kill, and the next
# round's serve then dies with EADDRINUSE 8799 (that is what merged rounds r2/r3 into one log).
set -u
NT_KILLPS='C:/Users/35165/xiangqi/bench/engine_upgrade_evidence/kill_chrome_by_profile.ps1'
NT_FREEPS='C:/Users/35165/xiangqi/bench/new_engine/free_port.ps1'
SCRATCH='/c/Users/35165/AppData/Local/hermes/profiles/programmer/cache/scratch'
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_KILLPS" 'chrome-alt' 2>/dev/null
rm -rf "$SCRATCH/chrome-alt"
# kill any node process still holding 8799
powershell -NoProfile -ExecutionPolicy Bypass -File "$NT_FREEPS" 8799 2>/dev/null
echo "clean_alt done"
netstat -ano 2>/dev/null | grep ':8799' | head -5
