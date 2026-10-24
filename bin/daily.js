// 生成日报：npm run daily -- [--data data]
// 按近 1 天最新一期的统计日写 data/daily/<统计日>.json（网站日报页用）和 <统计日>.feishu.md（飞书消息内容，同一份）；已有就不重写。
// 每天出榜、补资料、归类之后由定时任务接着跑，手动重跑是安全的。token 取法和出榜一样。
// 还没有近 1 天的榜单，或有项目的官方 Release 没查全时退出码为 1（日报照样写出，没查全的项目不写版本发布）。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { buildDaily } from '../src/daily/index.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const t0 = performance.now();
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const r = await buildDaily({ dataDir: values.data, token });

if (r.status === 'missing') {
  console.log('还没有近 1 天的榜单，不生成日报');
  process.exitCode = 1;
} else if (r.status === 'exists') {
  console.log(`统计日 ${r.statDay} 的日报已有，不重写：${r.path}、${r.feishuPath}`);
} else {
  const list = Object.values(r.daily.projects);
  const unknown = list.filter((p) => p.lookup !== 'ok').length;
  console.log(`日报 ${r.statDay}：三个窗口前 10 共 ${list.length} 个项目，${list.filter((p) => p.release).length} 个在所在窗口内发了正式版本${unknown ? `，${unknown} 个没查全` : ''}`);
  console.log(`官方接口请求 ${r.daily.requests} 次；耗时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
  console.log(`  ${r.path}\n  ${r.feishuPath}（飞书消息内容，本仓库不发送）`);
  if (unknown) process.exitCode = 1;
}
