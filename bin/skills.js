// 更新 Skill 历史榜：npm run skills -- [--data data]
// 抓一次 skills.sh 首页，按累计安装量存前 100，存成当天（UTC）的快照；当天已存过就不再请求，手动重跑是安全的。
// 失败时保留上一次快照、记进 status.json，退出码为 1。
import { parseArgs } from 'node:util';
import { updateSkills } from '../src/boards/index.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const t0 = performance.now();
const r = await updateSkills({ dataDir: values.data });

const num = (n) => n.toLocaleString('en-US');
if (r.status === 'exists') console.log(`今天的 Skill 历史榜快照已存在，没有重跑：${r.path}`);
else if (r.status === 'failed') console.log(`Skill 历史榜更新失败（保留上一次快照）：${r.error}`);
else {
  console.log(`已发布 ${r.path}：存前 ${r.snapshot.entries.length} 名`);
  for (const e of r.snapshot.entries.slice(0, 10)) console.log(`${String(e.rank).padStart(3)}  ${num(e.installs).padEnd(10)} ${e.skill}（${e.source}）`);
}
console.log(`skills.sh 请求 ${r.requests} 次；耗时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
if (r.status === 'failed') process.exitCode = 1;
