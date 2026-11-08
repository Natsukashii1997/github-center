// B0-02（#75）星数统计日界核对：官方 stargazers/history 的日桶，和按每个 Star 的精确时间（starred_at）在各个时区偏移下自己数的结果逐日比对。
// 注意：stargazers 列表 2026-07 起只对管理员和协作者开放，按 starred_at 自数的部分实际拿不到数据、结果无效；
// 有效的只有 --run 那部分（出榜时刻 vs 现在的日桶对比）。结论见 docs/adr/0001-fast-star-ranking.md 的 2026-11-08 补充。
// 只读公开接口，不写本应用数据。用法：
//   node --use-env-proxy scripts/check-star-boundary.mjs --out <证据目录> [--run <出榜运行目录>] owner/repo ...
// --run 给了时，再拿那次运行存下的原始星数历史（raw/history/<项目 id>.json）比对，看出榜那一刻前一天的桶是否已经数齐。
// token 取 GITHUB_TOKEN，没有就用 `gh auth token`。
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const out = opt('--out');
const runDir = opt('--run');
const repos = args;
if (!out || !repos.length) throw new Error('用法：--out <目录> [--run <运行目录>] owner/repo ...');
mkdirSync(out, { recursive: true });
const token = process.env.GITHUB_TOKEN || execSync('gh auth token').toString().trim();

let requests = 0;
async function api(path, accept = 'application/vnd.github+json') {
  for (let attempt = 1; ; attempt++) {
    requests++;
    try {
      const res = await fetch('https://api.github.com' + path, {
        headers: { authorization: `Bearer ${token}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'github-center-b0-02' },
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      if (res.status === 404 && path.includes('/stargazers?')) return { body: [], date: res.headers.get('date') };
      if (!res.ok) throw new Error(`${path} 返回 ${res.status}：${text.slice(0, 120)}`);
      return { body: JSON.parse(text), date: res.headers.get('date') };
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

const DAY = 86400e3;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// 官方桶：周起点 week（Unix 秒，周日），days[0..6] 是周日到周六。按"周起点 + i 天"在 UTC 下的日期作标签（这正是要检验的映射）。
function bucketMap(weeks) {
  const m = new Map();
  for (const w of weeks) w.days.forEach((n, i) => m.set(iso(w.week * 1000 + i * DAY), n));
  return m;
}
function countBy(stamps, offsetH) {
  const m = new Map();
  for (const t of stamps) { const k = iso(t + offsetH * 3600e3); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

const summary = { startedAt: new Date().toISOString(), repos: [] };
for (const full of repos) {
  const meta = (await api(`/repos/${full}`)).body;
  const h1 = await api(`/repos/${full}/stargazers/history?per_page=3`);
  const weeks = h1.body;
  const from = Math.min(...weeks.map((w) => w.week * 1000)); // 最早一周的周日 00:00Z
  // stargazers 列表按加星时间从旧到新；从最后一页往前翻，翻到早于 from 前 1 天为止（留出时区偏移的余量）。
  // 列表能翻到的条数可能少于仓库显示的总 Star（有的 Star 不出现在列表里），所以先二分找实际的最后一页。
  const pageAt = async (p) => (await api(`/repos/${full}/stargazers?per_page=100&page=${p}`, 'application/vnd.github.star+json')).body;
  let lo = 1, hi = Math.max(1, Math.ceil(meta.stargazers_count / 100));
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if ((await pageAt(mid)).length) lo = mid; else hi = mid - 1; }
  const last = lo;
  const seen = new Set();
  const stamps = [];
  for (let p = last; p >= 1; p--) {
    const page = await pageAt(p);
    for (const s of page) {
      const key = `${s.user?.login}|${s.starred_at}`;
      if (!seen.has(key)) { seen.add(key); stamps.push(Date.parse(s.starred_at)); }
    }
    if (!page.length || Date.parse(page[0].starred_at) < from - DAY) break;
  }
  const h2 = await api(`/repos/${full}/stargazers/history?per_page=3`); // 翻页结束后再取一次，看期间桶有没有变
  const fetchedAt = Date.parse(h2.date);
  const today = iso(fetchedAt);
  const apiDays = bucketMap(h2.body);
  // 只比完整的日：from 到 UTC 昨天。
  const days = [...apiDays.keys()].filter((d) => d >= iso(from) && d < today).sort();
  const byOffset = [];
  for (let off = -12; off <= 14; off++) {
    const mine = countBy(stamps, off);
    let absDiff = 0, exact = 0;
    const perDay = days.map((d) => { const a = apiDays.get(d), b = mine.get(d) ?? 0; absDiff += Math.abs(a - b); if (a === b) exact++; return { day: d, api: a, mine: b }; });
    byOffset.push({ offsetH: off, absDiff, exactDays: exact, perDay });
  }
  byOffset.sort((a, b) => a.absDiff - b.absDiff || Math.abs(a.offsetH) - Math.abs(b.offsetH));
  const utc = byOffset.find((x) => x.offsetH === 0);
  // 当天（进行中的桶）：官方数 vs 到取数时刻为止按 UTC 自己数的。
  const todayMine = countBy(stamps.filter((t) => t <= fetchedAt), 0).get(today) ?? 0;
  const changed = JSON.stringify(h1.body) !== JSON.stringify(h2.body);
  // 出榜那次运行存下的原始响应：各日的桶在出榜时刻是多少，和现在官方、现在自己数的比。
  let atRun = null;
  if (runDir && existsSync(join(runDir, 'raw/history', `${meta.id}.json`))) {
    const stored = bucketMap(JSON.parse(readFileSync(join(runDir, 'raw/history', `${meta.id}.json`), 'utf8')));
    atRun = days.filter((d) => stored.has(d)).map((d) => ({ day: d, atRun: stored.get(d), apiNow: apiDays.get(d), utcNow: countBy(stamps, 0).get(d) ?? 0 }));
  }
  const r = {
    repo: full, id: meta.id, stars: meta.stargazers_count, listablePages: last, stampsCollected: stamps.length, fetchedAt: h2.date,
    daysCompared: days.length, from: iso(from), to: days.at(-1),
    best: { offsetH: byOffset[0].offsetH, absDiff: byOffset[0].absDiff, exactDays: byOffset[0].exactDays },
    utc: { absDiff: utc.absDiff, exactDays: utc.exactDays, perDay: utc.perDay },
    nearest: byOffset.slice(0, 5).map(({ offsetH, absDiff, exactDays }) => ({ offsetH, absDiff, exactDays })),
    pacific: [-7, -8].map((o) => { const x = byOffset.find((y) => y.offsetH === o); return { offsetH: o, absDiff: x.absDiff, exactDays: x.exactDays }; }),
    today: { day: today, api: apiDays.get(today) ?? null, utcSoFar: todayMine },
    historyChangedDuringPaging: changed,
    atRun,
  };
  writeFileSync(join(out, `${full.replace('/', '__')}.json`), JSON.stringify({ ...r, historyResponses: [h1, h2], stamps }, null, 1));
  summary.repos.push(r);
  console.log(`${full}: UTC 偏移 0 → ${utc.exactDays}/${days.length} 天完全一致，绝对差 ${utc.absDiff}；最佳偏移 ${r.best.offsetH}h（差 ${r.best.absDiff}）；太平洋 -7h 差 ${r.pacific[0].absDiff}、-8h 差 ${r.pacific[1].absDiff}；今天 官方 ${r.today.api} / 自数 ${todayMine}${changed ? '；翻页期间桶有变化' : ''}`);
}
summary.requests = requests;
summary.finishedAt = new Date().toISOString();
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`请求 ${requests} 次`);
