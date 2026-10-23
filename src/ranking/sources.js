// 候选来源：GH Archive 小时文件（主）、ClickHouse 公开事件库（某小时缺失时补；更早的日子按天补）、官方热门日／周／月榜。
// 事件计数只用来挑候选和每日自检，不上页面。
import { Readable, pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';

const ARCHIVE_TIMEOUT_MS = 180_000;

// 下载出错或超时时抛出（由调用方改用 ClickHouse），不能让流错误变成进程崩溃。
export async function archiveHour({ fetch, day, hour }) {
  const res = await fetch(`https://data.gharchive.org/${day}-${hour}.json.gz`, { signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GH Archive ${day}-${hour} 返回 ${res.status}`);
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

// ClickHouse 公开库和官方热门榜偶尔连不上：断网或 5xx 时最多试 3 次，仍失败就带上数据源名字报错。
async function fetchRetry({ fetch, sleep = realSleep, url, init, label }) {
  for (let attempt = 1; ; attempt++) {
    let res;
    let why;
    try {
      res = await fetch(url, init);
    } catch (e) {
      why = `请求失败（${e.cause?.code ?? e.message}）`;
    }
    if (res?.ok) return res;
    if (res && res.status < 500) throw new Error(`${label}返回 ${res.status}`);
    if (attempt >= 3) throw new Error(`${label}${why ?? `返回 ${res.status}`}`);
    await sleep(attempt * 2000);
  }
}

async function clickhouseStars({ fetch, sleep, start, span, tail, label }) {
  const sql = `SELECT repo_name, count() AS stars FROM github_events WHERE event_type = 'WatchEvent' AND created_at >= toDateTime('${start}') AND created_at < toDateTime('${start}') + INTERVAL 1 ${span} GROUP BY repo_name ${tail}FORMAT JSONEachRow`;
  const res = await fetchRetry({ fetch, sleep, url: 'https://play.clickhouse.com/?user=play', init: { method: 'POST', body: sql }, label });
  return (await res.text()).split('\n').filter(Boolean).map((l) => {
    const r = JSON.parse(l);
    return { id: null, name: r.repo_name, events: Number(r.stars) };
  });
}

export function clickhouseHour({ fetch, sleep, day, hour }) {
  return clickhouseStars({ fetch, sleep, start: `${day} ${String(hour).padStart(2, '0')}:00:00`, span: 'HOUR', tail: 'ORDER BY stars DESC LIMIT 5000 ', label: `ClickHouse ${day} ${hour} 时` });
}

export function clickhouseDay({ fetch, sleep, day }) {
  return clickhouseStars({ fetch, sleep, start: `${day} 00:00:00`, span: 'DAY', tail: '', label: `ClickHouse ${day} ` });
}

const TRENDING = { daily: '日榜', weekly: '周榜', monthly: '月榜' };

// 官方热门榜只能抓到运行当时的。
export async function trending({ fetch, sleep, since }) {
  const res = await fetchRetry({ fetch, sleep, url: `https://github.com/trending?since=${since}`, init: { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 github-center' } }, label: `官方热门${TRENDING[since]}` });
  const html = await res.text();
  return [...html.matchAll(/<article class="Box-row">([\s\S]*?)<\/article>/g)].map(([, a]) => ({
    id: Number(a.match(/repository_id&quot;:(\d+)/)?.[1]) || null,
    name: a.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/)[1],
  }));
}
