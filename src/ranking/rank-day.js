import { bucketOf, lastEndedDay } from './stat-day.js';
import { archiveHour, clickhouseHour, trendingDaily } from './sources.js';
import { githubClient } from './github.js';
import { openStore, findSnapshot } from './store.js';
import { topWithTies } from './rank.js';

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const keyOf = (c) => (c.id ? String(c.id) : c.name.replace('/', '__'));

// 跑一次出榜：某个已结束统计日的近 1 天涨星榜前 20（含末位并列）。
export async function rankDay({ day, dataDir, fetch = globalThis.fetch, token, now = () => new Date(), limit = 300, concurrency = 6 }) {
  const bucket = bucketOf(day);
  if (day > lastEndedDay(now())) throw new Error(`统计日 ${day} 还没结束（按 UTC），最近一个已结束的是 ${lastEndedDay(now())}`);
  const done = findSnapshot(dataDir, 'd1', day);
  if (done) return { status: 'exists', ...done };
  const startedAt = now();
  const runId = `${day}_${startedAt.toISOString().replace(/[:.]/g, '-')}`;
  const store = openStore(dataDir, runId);

  // 1. 找候选：24 个小时的 Star 事件按仓库合计，取前 limit 个，再并入官方热门日榜。
  const counts = new Map();
  const fallbackHours = [];
  await mapLimit([...Array(24).keys()], 4, async (hour) => {
    let rows;
    try {
      rows = await archiveHour({ fetch, day, hour });
    } catch {
      fallbackHours.push(hour);
      rows = await clickhouseHour({ fetch, day, hour });
    }
    for (const r of rows) {
      const k = r.name.toLowerCase();
      const row = counts.get(k) ?? { id: r.id, name: r.name, events: 0 };
      row.id ??= r.id;
      row.events += r.events;
      counts.set(k, row);
    }
  });
  const fromArchive = [...counts.values()].sort((a, b) => b.events - a.events || (a.name < b.name ? -1 : 1)).slice(0, limit);
  const trending = await trendingDaily({ fetch });
  const byName = new Map();
  for (const c of [...fromArchive, ...trending]) {
    const k = c.name.toLowerCase();
    const seen = byName.get(k);
    byName.set(k, { id: seen?.id ?? c.id, name: seen?.name ?? c.name });
  }
  const candidates = [...byName.values()];

  // 2. 官方核数：每个候选读一次官方星数历史，取统计日那一格。
  const gh = githubClient({ fetch, token });
  const verified = (await mapLimit(candidates, concurrency, async (c) => {
    const res = await gh.history(c);
    if (!res) return null;
    const week = JSON.parse(res.body).find((w) => w.week === bucket.week);
    return { candidate: c, fullName: c.name, gain: week ? week.days[bucket.dayIndex] : 0, history: store.saveRaw('history', keyOf(c), res) };
  })).filter(Boolean);

  // 3. 排名，上榜项目再读一次仓库信息取当前总 Star。
  const top = topWithTies(verified.filter((v) => v.gain > 0));
  const entries = await mapLimit(top, concurrency, async (t) => {
    const res = await gh.repo(t.candidate);
    const repo = JSON.parse(res.body);
    return { rank: t.rank, repoId: repo.id, fullName: repo.full_name, gain: t.gain, total: repo.stargazers_count, evidence: { history: t.history, repo: store.saveRaw('repo', keyOf(t.candidate), res) } };
  });

  const snapshot = {
    window: 'd1',
    statDay: day,
    bucket,
    boundaryMode: 'observed_utc',
    generatedAt: now().toISOString(),
    runId,
    candidates: { total: candidates.length, archive: fromArchive.length, trending: trending.length, fallbackHours: fallbackHours.sort((a, b) => a - b) },
    requests: { history: gh.stats.history, repo: gh.stats.repo },
    entries,
  };
  const published = store.publish(snapshot);
  return { ...published, snapshot };
}
