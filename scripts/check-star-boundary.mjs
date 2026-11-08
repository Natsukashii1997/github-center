// B0-02（#75）出榜时刻核对：拿某次出榜存下的官方星数历史（raw/history/<项目 id>.json），和现在官方的日桶逐日比，
// 看出榜那一刻各日的桶数完了没有。结论见 docs/adr/0001-fast-star-ranking.md 的 2026-11-08 补充。
// 原本还想按每个 Star 的 starred_at 自己数、比对各时区偏移，但 stargazers 列表 2026-07 起只对管理员和协作者开放，那部分已删。
// 只读公开接口，不写本应用数据。用法：
//   node --use-env-proxy scripts/check-star-boundary.mjs --out <证据目录> --run <出榜运行目录> owner/repo ...
// token 取 GITHUB_TOKEN，没有就用 `gh auth token`。
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const out = opt('--out');
const runDir = opt('--run');
const repos = args;
if (!out || !runDir || !repos.length) throw new Error('用法：--out <目录> --run <运行目录> owner/repo ...');
mkdirSync(out, { recursive: true });
const token = process.env.GITHUB_TOKEN || execSync('gh auth token').toString().trim();

let requests = 0;
async function api(path) {
  for (let attempt = 1; ; attempt++) {
    requests++;
    try {
      const res = await fetch('https://api.github.com' + path, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'github-center-b0-02' },
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
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
// 官方桶：week 是周日 00:00Z（Unix 秒），days[0..6] 是周日到周六；"week + i 天"的日期就是该桶的太平洋日期（ADR 第 4 节）。
function bucketMap(weeks) {
  const m = new Map();
  for (const w of weeks) w.days.forEach((n, i) => m.set(iso(w.week * 1000 + i * DAY), n));
  return m;
}

const summary = { startedAt: new Date().toISOString(), runDir, repos: [] };
for (const full of repos) {
  const meta = (await api(`/repos/${full}`)).body;
  const file = join(runDir, 'raw/history', `${meta.id}.json`);
  if (!existsSync(file)) { console.log(`${full}：那次出榜没有存它的星数历史，跳过`); continue; }
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  const now = await api(`/repos/${full}/stargazers/history?per_page=6`);
  const atRun = bucketMap(stored), apiNow = bucketMap(now.body);
  // 两边都有的日才比；一边缺就不比，不补零。
  const days = [...atRun.keys()].filter((d) => apiNow.has(d)).sort();
  const perDay = days.map((d) => ({ day: d, atRun: atRun.get(d), apiNow: apiNow.get(d) }));
  const changed = perDay.filter((x) => x.atRun !== x.apiNow);
  const r = { repo: full, id: meta.id, fetchedAt: now.date, daysCompared: days.length, changed, perDay };
  writeFileSync(join(out, `${full.replace('/', '__')}.json`), JSON.stringify({ ...r, historyNow: now.body }, null, 1));
  summary.repos.push({ repo: full, id: meta.id, daysCompared: days.length, changed });
  console.log(`${full}：比了 ${days.length} 天，${changed.length} 天和出榜时不同${changed.length ? '：' + changed.map((x) => `${x.day} ${x.atRun}→${x.apiNow}`).join('，') : ''}`);
}
summary.requests = requests;
summary.finishedAt = new Date().toISOString();
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`请求 ${requests} 次`);
