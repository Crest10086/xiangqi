#!/usr/bin/env bash
# tier_games_run.sh — run the 五档互弈 rounds for card t_a8096ea3 (position-calibration rounds are
# tier_rounds.sh; this is the game-level ladder check). Sequential: one port, one Chrome profile.
set -u
cd /c/Users/35165/xiangqi/bench/new_engine
for r in 1 2; do
  echo "=== games round $r start $(date +%H:%M:%S) ==="
  bash tier_run.sh "task_games_r$r.json" "games_r$r.log" 2000 tier_games.html
  echo "=== games round $r done $(date +%H:%M:%S) ==="
done
echo ALL-GAMES-DONE
