// 候选来源：GH Archive 小时文件（主）、ClickHouse 公开事件库（某小时缺失时补）、官方热门日榜。
// 事件计数只用来挑候选，不进入快照。
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

export async function clickhouseHour({ fetch, day, hour }) {
  const start = `${day} ${String(hour).padStart(2, '0')}:00:00`;
  const sql = `SELECT repo_name, count() AS stars FROM github_events WHERE event_type = 'WatchEvent' AND created_at >= toDateTime('${start}') AND created_at < toDateTime('${start}') + INTERVAL 1 HOUR GROUP BY repo_name ORDER BY stars DESC LIMIT 5000 FORMAT JSONEachRow`;
  const res = await fetch('https://play.clickhouse.com/?user=play', { method: 'POST', body: sql });
  if (!res.ok) throw new Error(`ClickHouse ${day} ${hour} 时返回 ${res.status}`);
  return (await res.text()).split('\n').filter(Boolean).map((l) => {
    const r = JSON.parse(l);
    return { id: null, name: r.repo_name, events: Number(r.stars) };
  });
}

export async function trendingDaily({ fetch }) {
  const res = await fetch('https://github.com/trending?since=daily', { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 github-center' } });
  if (!res.ok) throw new Error(`官方热门日榜返回 ${res.status}`);
  const html = await res.text();
  return [...html.matchAll(/<article class="Box-row">([\s\S]*?)<\/article>/g)].map(([, a]) => ({
    id: Number(a.match(/repository_id&quot;:(\d+)/)?.[1]) || null,
    name: a.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/)[1],
  }));
}
