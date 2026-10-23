// 跑一次出榜：npm run rank -- [--day YYYY-MM-DD] [--data data] [--limit 300]
// 不给 --day 时取最近一个已结束的 UTC 日（每日定时任务就这样跑）。token 取环境变量 GITHUB_TOKEN，没有就用本机 gh 登录。
// 涨星榜三个窗口（另存每个窗口全部已核数的候选，#10）和新项目榜、官方热门榜、累计高星榜一起出。已发布的不重跑，手动重跑是安全的。
// 有榜单更新失败时退出码为 1；整次运行出错也记进 status.json，网站照样提示。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { rankDay, lastEndedDay, recordStatus, WINDOWS, LISTS } from '../src/ranking/index.js';

const { values } = parseArgs({ options: { day: { type: 'string' }, data: { type: 'string', default: 'data' }, limit: { type: 'string', default: '300' } } });
const day = values.day ?? lastEndedDay(new Date());

let upstream = 0;
const fetch = (...args) => (upstream++, globalThis.fetch(...args));
const t0 = performance.now();
let r;
try {
  const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  r = await rankDay({ day, dataDir: values.data, fetch, token, limit: Number(values.limit) });
} catch (e) {
  if (day <= lastEndedDay(new Date())) {
    const boards = [...Object.keys(WINDOWS), ...Object.keys(LISTS)];
    recordStatus(values.data, { day, at: new Date().toISOString(), boards: Object.fromEntries(boards.map((b) => [b, { status: 'failed', error: e.message }])) });
  }
  console.error(`统计日 ${day} 出榜失败：${e.message}`);
  process.exit(1);
}
const seconds = ((performance.now() - t0) / 1000).toFixed(1);

const num = (n) => n.toLocaleString('en-US');
let failed = false;
for (const [window, w] of Object.entries(r.windows)) {
  console.log(`\n== ${window} 统计日 ${day}`);
  if (w.status === 'exists') { console.log(`快照已存在，没有重跑：${w.path}`); continue; }
  if (w.status === 'failed') { failed = true; console.log(`更新失败：${w.error}`); continue; }
  const s = w.snapshot;
  const c = s.candidates;
  console.log(`${w.status === 'published' ? '已发布' : w.status} ${w.path}（${s.from} 至 ${s.statDay}）`);
  console.log(`候选 ${c.total} 个（事件数据 ${c.archive} 个，官方热门榜 ${c.trending} 个，合并去重后 ${c.total} 个${c.fallbackHours.length ? `；当天第 ${c.fallbackHours.join('、')} 小时用 ClickHouse 补` : ''}${c.backfilledDays.length ? `；${c.backfilledDays.length} 个更早的日子从 ClickHouse 补` : ''}）`);
  console.log(`官方核数请求 ${s.requests.history + s.requests.project} 次（星数历史 ${s.requests.history}，项目信息 ${s.requests.project}）`);
  if (c.unavailable.length) console.log(`官方接口查不到的候选 ${c.unavailable.length} 个：${c.unavailable.join('、')}`);
  if (c.failed.length) console.log(`核数失败 ${c.failed.length} 个：${c.failed.map((f) => `${f.name}（${f.reason}）`).join('；')}`);
  console.log(`自检${s.check.passed ? '通过' : '未通过'}：漏失概率 ${s.check.missProbability.toExponential(2)}，记录比例 ${(s.check.recordRatio * 100).toFixed(2)}%，第 20 名应有记录 ${s.check.expectedRecords.toFixed(1)} 次，候选门槛 ${s.check.threshold}${s.incomplete ? '；标注“可能不完整”' : ''}`);
  const floor = s.check.completenessFloor;
  console.log(`已核数候选 ${num(c.verified)} 个另存 ${w.candidates.path}（取到描述和 topics ${num(w.candidates.found)} 个，没取到 ${num(w.candidates.missing)} 个；GraphQL 请求 ${s.requests.graphql} 次）；完整性下限 ${floor === null ? '估计不了' : `+${num(floor)}`}`);
  console.log(`上榜 ${s.entries.length} 个`);
  for (const e of s.entries) console.log(`${String(e.rank).padStart(2)}  +${num(e.gain).padEnd(8)} ${e.fullName}  (总 ${num(e.total)})`);
}
for (const [list, l] of Object.entries(r.lists)) {
  console.log(`\n== ${LISTS[list]} 统计日 ${day}`);
  if (l.status === 'exists') { console.log(`快照已存在，没有重跑：${l.path}`); continue; }
  if (l.status === 'failed') { failed = true; console.log(`更新失败：${l.error}`); continue; }
  const s = l.snapshot;
  if (s.pages) {
    for (const [since, p] of Object.entries(s.pages)) console.log(`${since}：${p.entries.length} 个，前 3 名 ${p.entries.slice(0, 3).map((e) => e.fullName).join('、')}`);
  } else {
    console.log(`搜索条件 ${s.query}，搜索计数 ${num(s.totalCount)}；上榜 ${s.entries.length} 个`);
    for (const e of s.entries) console.log(`${String(e.rank).padStart(2)}  ${num(e.total).padEnd(9)} ${e.fullName}`);
  }
}
console.log(`\n全部上游请求 ${upstream} 次；耗时 ${seconds} 秒`);
if (failed) process.exitCode = 1;
