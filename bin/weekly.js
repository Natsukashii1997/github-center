// 生成周报：npm run weekly -- [--data data]
// 按涨星榜近 7 天最新一期的统计日写 data/weekly/<统计日>.json 和 <统计日>.feishu.md（飞书消息内容）；已有就不重写。
// 只读本地快照和项目资料，不请求上游；手动重跑是安全的。本仓库不发送，由猛鬼兽（Hermes）发（docs/handoff/weekly-hermes.md）。
// 还没有近 7 天的榜单时退出码为 1。
import { parseArgs } from 'node:util';
import { buildWeekly } from '../src/weekly/index.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const r = buildWeekly({ dataDir: values.data });

if (r.status === 'missing') {
  console.log('还没有近 7 天的榜单，不生成周报');
  process.exitCode = 1;
} else if (r.status === 'exists') {
  console.log(`统计日 ${r.statDay} 的周报已有，不重写：${r.path}、${r.feishuPath}`);
} else {
  const { entries, notes } = r.weekly;
  console.log(`周报 ${r.statDay}：前 10 共 ${entries.length} 个项目，${entries.filter((e) => !e.line).length} 个还没有一句话`);
  for (const n of notes) console.log(`  提示 ${n.title}：${n.text}`);
  console.log(`  ${r.path}\n  ${r.feishuPath}（飞书消息内容，本仓库不发送）`);
}
