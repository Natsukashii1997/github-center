// 候选来源：GH Archive 小时文件（主）、ClickHouse 公开事件库（某小时缺失时补；更早的日子按天补）、官方热门日／周／月榜。
// 事件计数只用来挑候选和每日自检，不上页面。
import { Readable, pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { TRENDING_PAGES } from './lists.js';
import { dayRange } from './stat-day.js';

const ARCHIVE_TIMEOUT_MS = 180_000;

// 下载出错或超时时抛出（由调用方改用 ClickHouse），不能让流错误变成进程崩溃。
// date、hour 是 UTC 的日期和小时（文件名就是这么写的）。
export async function archiveHour({ fetch, date, hour }) {
  const res = await fetch(`https://data.gharchive.org/${date}-${hour}.json.gz`, { signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GH Archive ${date}-${hour} 返回 ${res.status}`);
  const text = createGunzip().setEncoding('utf8');
  pipeline(Readable.fromWeb(res.body), text, () => {});
  const rows = new Map();
  const take = (line) => {
    if (!line.includes('"WatchEvent"')) return;
    const e = JSON.parse(line);
    if (e.type !== 'WatchEvent') return;
    const row = rows.get(e.repo.id) ?? { id: e.repo.id, name: e.repo.name, events: 0 };
    row.events += 1;
    rows.set(e.repo.id, row);
  };
  let rest = '';
  for await (const chunk of text) {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop();
    lines.forEach(take);
  }
  take(rest);
  return [...rows.values()];
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ClickHouse 公开库和官方热门榜偶尔连不上：断网、超时（60 秒）或 5xx 时最多试 3 次，仍失败就带上数据源名字报错。
async function fetchRetry({ fetch, sleep = realSleep, url, init, label }) {
  for (let attempt = 1; ; attempt++) {
    let res;
    let why;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      why = `请求失败（${e.cause?.code ?? e.message}）`;
    }
    if (res?.ok) return res;
    if (res && res.status < 500) throw new Error(`${label}返回 ${res.status}`);
    if (attempt >= 3) throw new Error(`${label}${why ?? `返回 ${res.status}`}`);
    await sleep(attempt * 2000);
  }
}

// start、end 是 UTC 时刻（含起不含止），写成 ClickHouse 的 'YYYY-MM-DD HH:MM:SS'。
async function clickhouseStars({ fetch, sleep, start, end, tail, label }) {
  const sql = `SELECT repo_name, count() AS stars FROM github_events WHERE event_type = 'WatchEvent' AND created_at >= toDateTime('${start}') AND created_at < toDateTime('${end}') GROUP BY repo_name ${tail}FORMAT JSONEachRow`;
  const res = await fetchRetry({ fetch, sleep, url: 'https://play.clickhouse.com/?user=play', init: { method: 'POST', body: sql }, label });
  return (await res.text()).split('\n').filter(Boolean).map((l) => {
    const r = JSON.parse(l);
    return { id: null, name: r.repo_name, events: Number(r.stars) };
  });
}

const chTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// UTC 某日某小时（GH Archive 缺这个小时文件时补）。
export function clickhouseHour({ fetch, sleep, date, hour }) {
  const from = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  return clickhouseStars({ fetch, sleep, start: chTime(from), end: chTime(from + 3600e3), tail: 'ORDER BY stars DESC LIMIT 5000 ', label: `ClickHouse UTC ${date} ${hour} 时` });
}

// 整个统计日（太平洋时间，dayRange），近 7/30 天补更早的日子用。
export function clickhouseDay({ fetch, sleep, day }) {
  const { from, to } = dayRange(day);
  return clickhouseStars({ fetch, sleep, start: chTime(from), end: chTime(to), tail: '', label: `ClickHouse 统计日 ${day} ` });
}


const count = (s) => (s ? Number(s.replace(/,/g, '')) : null);

// 官方热门榜只能抓到运行当时的。按页面原样的顺序返回项目，连同原始页面（存档用）。
// periodStars 是页面上写的“这段时间新增 Star”（GitHub 自己的数字），total 是页面上的总 Star。
export async function trending({ fetch, sleep, since }) {
  const url = `https://github.com/trending?since=${since}`;
  const res = await fetchRetry({ fetch, sleep, url, init: { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 github-center' } }, label: `官方热门${TRENDING_PAGES[since].name}` });
  const body = await res.text();
  const items = [...body.matchAll(/<article class="Box-row">([\s\S]*?)<\/article>/g)].map(([, a]) => ({
    id: Number(a.match(/repository_id&quot;:(\d+)/)?.[1]) || null,
    name: a.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/)[1],
    periodStars: count(a.match(/([\d,]+) stars (?:today|this week|this month)/)?.[1]),
    total: count(a.match(/\/stargazers"[^>]*>(?:\s*<svg[\s\S]*?<\/svg>)?\s*([\d,]+)\s*<\/a>/)?.[1]),
  }));
  if (!items.length) throw new Error(`官方热门${TRENDING_PAGES[since].name}页面没解析出任何项目（页面结构可能变了），按更新失败处理`);
  return { items, res: { url, body, date: res.headers.get('date') } };
}
