#!/usr/bin/env bash
# run_ac_all.sh — TEST-ONLY sequential runner for card t_3fff5a44 (A+C 叠加实测).
# Runs each requested round back-to-back IN ONE process, calling clean_alt.sh before every round
# (the previous round's serve_upg.js child survives alt_run.sh's own kill -> next serve EADDRINUSE 8799).
# Usage: bash run_ac_all.sh [rounds...] ; rounds are: 1 2 3 (main) and c1 (calib grid).
set -u
cd /c/Users/35165/xiangqi/bench/new_engine
NODE='/c/Users/35165/AppData/Local/hermes/node/node.exe'
for R in "$@"; do
  if [ "$R" = "c1" ]; then
    MODEARG=calib; TASK=task_calib_r1.json; LOG=ac_calib_r1.log
  else
    MODEARG=; TASK=task_ac_r$R.json; LOG=ac_r$R.log
  fi
  echo "######## ROUND $R ($TASK) gen"
  "$NODE" alt_gen_task.js "$R" $MODEARG
  echo "######## ROUND $R clean"
  bash clean_alt.sh
  echo "######## ROUND $R run"
  bash alt_run.sh "$TASK" "$LOG" 1200
  echo "######## ROUND $R done at $(date +%H:%M:%S)"
done
echo "ALL-ROUNDS-DONE"
