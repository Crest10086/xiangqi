#!/usr/bin/env bash
# run_bn_all.sh — TEST-ONLY sequential runner for card t_f844043c (bounded noise 实测).
# Same recipe as run_ac_all.sh: every requested round runs back-to-back IN ONE process and
# clean_alt.sh runs before each round (a surviving serve_upg.js child holds port 8799 otherwise).
# Usage: bash run_bn_all.sh 1 2 3        (rounds are the b-prefixed bounded-noise matrix)
set -u
cd /c/Users/35165/xiangqi/bench/new_engine
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
for R in "$@"; do
  BR="b$R"
  TASK="task_bn_r$R.json"; LOG="bn_r$R.log"
  echo "######## ROUND $BR ($TASK) gen"
  "$NODE" alt_gen_task.js "$BR"
  echo "######## ROUND $BR clean"
  bash clean_alt.sh
  echo "######## ROUND $BR run"
  bash alt_run.sh "$TASK" "$LOG" 1500
  echo "######## ROUND $BR done at $(date +%H:%M:%S)"
done
echo "ALL-BN-ROUNDS-DONE"
