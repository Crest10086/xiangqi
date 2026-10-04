#!/usr/bin/env bash
# tier_rounds.sh — run the t_a8096ea3 calibration rounds sequentially (same port/profile).
set -u
cd /c/Users/35165/xiangqi/bench/new_engine
for r in 1 2; do
  echo "=== round $r start $(date +%H:%M:%S) ==="
  bash tier_run.sh "task_tier_r$r.json" "tier_r$r.log" 1500
  echo "=== round $r done $(date +%H:%M:%S) ==="
done
echo ALL-ROUNDS-DONE
