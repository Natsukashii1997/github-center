// 更新历史榜：npm run history -- [--data data]
// 一次 GitHub 官方搜索按总 Star 倒序取全站前 100，存成当天（UTC）的快照；当天已存过就不再请求，手动重跑是安全的。
// token 取环境变量 GITHUB_TOKEN，没有就用本机 gh 登录（和出榜一样）。失败时保留上一次快照、记进 status.json，退出码为 1。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { githubClient } from '../src/ranking/github.js';
import { updateHistory } from '../src/boards/index.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const t0 = performance.now();
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const r = await updateHistory({ dataDir: values.data, gh: githubClient({ fetch: globalThis.fetch, token }) });

const num = (n) => n.toLocaleString('en-US');
if (r.status === 'exists') console.log(`今天的历史榜快照已存在，没有重跑：${r.path}`);
else if (r.status === 'failed') console.log(`历史榜更新失败（保留上一次快照）：${r.error}`);
else {
  const s = r.snapshot;
  console.log(`已发布 ${r.path}：搜索计数 ${num(s.totalCount)}，存前 ${s.entries.length} 名`);
  for (const e of s.entries.slice(0, 10)) console.log(`${String(e.rank).padStart(3)}  ${num(e.total).padEnd(9)} ${e.repo}`);
}
console.log(`GitHub 搜索请求 ${r.requests} 次；耗时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
if (r.status === 'failed') process.exitCode = 1;
