/* tier_config.js — GENERATED FILE, do not hand-edit.
 * source: bench/new_engine/tier_tiers.json (sha256 935013af28ac1c21…)
 * regenerate: node bench/new_engine/gen_tier_config.js
 * contract (bench/TIER_DESIGN_FINAL.md): cap / p / mistakeBand are the only strength knobs;
 * movetime+Hash are a fixed budget per tier, not the ladder. 大师 is the ceiling (MultiPV 1).
 */
(function (root) {
  'use strict';
  root.PF_TIERS = {
 "source": "bench/new_engine/tier_tiers.json",
 "sha256": "935013af28ac1c215c7f4e012207b1e3a9887da4cd7a9d230af9e8908957427b",
 "generated": "2026-10-04T21:48:24.834Z",
 "levels": {
  "1": {
   "name": "业余",
   "cap": 80,
   "p": 0.5,
   "mistakeBand": 200,
   "openingCap": 80,
   "openingMistakeBand": 200,
   "hardCap": 0,
   "hardMistakeBand": 700,
   "multipv": 8,
   "movetime": 300,
   "hash": 64,
   "id": "T_YOU"
  },
  "2": {
   "name": "进阶",
   "cap": 80,
   "p": 0,
   "mistakeBand": 200,
   "openingCap": 80,
   "openingMistakeBand": 200,
   "hardCap": 0,
   "hardMistakeBand": 700,
   "multipv": 8,
   "movetime": 300,
   "hash": 64,
   "id": "T_JIN"
  },
  "3": {
   "name": "高手",
   "cap": 25,
   "p": 0.1,
   "mistakeBand": 200,
   "openingCap": 25,
   "openingMistakeBand": 200,
   "hardCap": 0,
   "hardMistakeBand": 700,
   "multipv": 8,
   "movetime": 300,
   "hash": 64,
   "id": "T_GAO"
  },
  "4": {
   "name": "大师",
   "multipv": 1,
   "movetime": 2000,
   "hash": 256,
   "kind": "master",
   "id": "T_DA"
  }
 }
};
})(typeof window !== 'undefined' ? window : this);
