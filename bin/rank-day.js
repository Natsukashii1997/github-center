// 跑一次出榜：npm run rank -- [--day YYYY-MM-DD] [--data data] [--limit 300]
// 不给 --day 时取最近一个已结束的 UTC 日。token 取环境变量 GITHUB_TOKEN，没有就用本机 gh 登录。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { rankDay, lastEndedDay } from '../src/ranking/index.js';

const { values } = parseArgs({ options: { day: { type: 'string' }, data: { type: 'string', default: 'data' }, limit: { type: 'string', default: '300' } } });
const day = values.day ?? lastEndedDay(new Date());
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

let upstream = 0;
const fetch = (...args) => (upstream++, globalThis.fetch(...args));
const t0 = performance.now();
const r = await rankDay({ day, dataDir: values.data, fetch, token, limit: Number(values.limit) });
const seconds = ((performance.now() - t0) / 1000).toFixed(1);

if (r.status === 'exists') {
  console.log(`统计日 ${day} 的快照已存在，没有重跑：${r.path}`);
} else {
  const s = r.snapshot;
  const c = s.candidates;
  console.log(`统计日 ${day}：${r.status === 'published' ? '已发布' : r.status} ${r.path}`);
  console.log(`候选 ${c.total} 个（事件数据前 ${c.archive} 个，官方热门日榜 ${c.trending} 个，合并去重后 ${c.total} 个${c.fallbackHours.length ? `；第 ${c.fallbackHours.join('、')} 小时用 ClickHouse 补` : ''}）`);
  console.log(`官方核数请求 ${s.requests.history + s.requests.project} 次（星数历史 ${s.requests.history}，项目信息 ${s.requests.project}）；全部上游请求 ${upstream} 次`);
  if (c.unavailable.length) console.log(`官方接口查不到的候选 ${c.unavailable.length} 个：${c.unavailable.join('、')}`);
  console.log(`上榜 ${s.entries.length} 个；耗时 ${seconds} 秒`);
  for (const e of s.entries) console.log(`${String(e.rank).padStart(2)}  +${e.gain.toLocaleString('en-US').padEnd(8)} ${e.fullName}  (总 ${e.total.toLocaleString('en-US')})`);
}
