#!/usr/bin/env bash
# tier_final.sh — remaining runs for card t_a8096ea3, sequential on port 8801:
#   1) round 3: 大师 upper-bound probe (movetime ladder at MultiPV=1, 6 positions)
#   2) games rounds 1-2: 五档互弈 (16 games each)
set -u
cd /c/Users/35165/xiangqi/bench/new_engine
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
echo "=== ceiling r3 start $(date +%H:%M:%S) ==="
"$NODE" tier_gen_ceiling.js
bash tier_run.sh task_tier_r3.json tier_r3.log 900 tier_driver.html
echo "=== games r1 start $(date +%H:%M:%S) ==="
bash tier_run.sh task_games_r1.json games_r1.log 2500 tier_games.html
echo "=== games r2 start $(date +%H:%M:%S) ==="
bash tier_run.sh task_games_r2.json games_r2.log 2500 tier_games.html
echo ALL-FINAL-DONE
