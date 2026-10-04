/* new_engine/gen_level_task.js — TEST-ONLY task-file generator for card t_ef6e93b8.
 * Usage: node gen_level_task.js <round> [smoke]
 * Writes task_levels_r<round>.json (+ task_levels_smoke.json for the smoke run).
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const round = +(process.argv[2] || 1);
const smoke = process.argv[3] === 'smoke';

const positions = JSON.parse(fs.readFileSync(path.join(ROOT, 'level_positions.json'), 'utf8')).map((p) => ({
  id: p.id, group: p.group, fen: p.fen,
}));

const configs = [
  { id: 'AM',    multipv: 4, slot: 4, movetime: 150,  hash: 64  }, // 业余
  { id: 'AD',    multipv: 3, slot: 3, movetime: 300,  hash: 64  }, // 进阶（300ms 补测）
  { id: 'EX',    multipv: 2, slot: 2, movetime: 500,  hash: 128 }, // 高手
  { id: 'GM',    multipv: 1, slot: 1, movetime: 6000, hash: 256 }, // 大师
  { id: 'S1T300', multipv: 4, slot: 1, movetime: 300, hash: 64  }, // 对照：进阶同参但取第1候选
];

const task = {
  round: round,
  refMs: 2000,
  refHash: 256,
  pre: ['setoption name Threads value 4', 'setoption name Hash value 64', 'setoption name MultiPV value 1'],
  configs: configs,
  positions: smoke ? positions.filter((p) => p.id === 'OP00' || p.id === 'MG_QT01') : positions,
};

const name = smoke ? 'task_levels_smoke.json' : 'task_levels_r' + round + '.json';
fs.writeFileSync(path.join(ROOT, name), JSON.stringify(task, null, 1));
console.log('wrote', name, 'positions=' + task.positions.length, 'configs=' + configs.length);
