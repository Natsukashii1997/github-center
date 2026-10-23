import { bucketOf, lastEndedDay } from './stat-day.js';
import { archiveHour, clickhouseHour, trendingDaily } from './sources.js';
import { githubClient, PER_PAGE } from './github.js';
import { openStore, findSnapshot, WINDOW } from './store.js';
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

// 同一项目可能以不同名字出现（当天改过名），有 id 时按 id 合并，名字取后出现的（更新）；只有名字的按小写名合并，并尽量并入同名的有 id 记录。
function mergeById(rows) {
  const byId = new Map();
  const byName = new Map();
  for (const r of rows) {
    const known = r.id ? byId.get(r.id) : byId.get(byName.get(r.name.toLowerCase())?.id) ?? byName.get(r.name.toLowerCase());
    const row = known ?? { id: r.id, name: r.name, events: 0 };
    if (r.id) row.name = r.name;
    row.events += r.events ?? 0;
    if (row.id) byId.set(row.id, row);
    byName.set(r.name.toLowerCase(), row);
  }
  return [...new Set(byName.values())];
}

// 1. 找候选：24 个小时的 Star 事件按项目合计取前 limit 个，并入官方热门日榜，最后人人都有项目 id。
// 官方热门日榜只能抓到运行当天的，它只多给几个候选；每个候选的数字仍按统计日核对。
async function findCandidates({ fetch, day, gh, limit }) {
  const fallbackHours = [];
  const hours = await mapLimit([...Array(24).keys()], 4, async (hour) => {
    try {
      return await archiveHour({ fetch, day, hour });
    } catch {
      fallbackHours.push(hour);
      const rows = await clickhouseHour({ fetch, day, hour });
      if (!rows.length) throw new Error(`第 ${hour} 小时 GH Archive 缺失，ClickHouse 也没有这一小时的数据，按更新失败处理`);
      return rows;
    }
  });
  const fromArchive = mergeById(hours.flat()).sort((a, b) => b.events - a.events || (a.name < b.name ? -1 : 1)).slice(0, limit);
  const trending = await trendingDaily({ fetch });
  const unavailable = [];
  const resolved = await mapLimit(mergeById([...fromArchive, ...trending]), 6, async (c) => {
    if (c.id) return c;
    const res = await gh.project(c);
    if (!res) return (unavailable.push(c.name), null);
    const p = JSON.parse(res.body);
    return { id: p.id, name: p.full_name };
  });
  const candidates = mergeById(resolved.filter(Boolean)).map(({ id, name }) => ({ id, name }));
  return { candidates, unavailable, counts: { archive: fromArchive.length, trending: trending.length, fallbackHours: fallbackHours.sort((a, b) => a - b) } };
}

// 2. 官方核数：每个候选读一次官方星数历史，取统计日那一格。缺那一周就不发布（缺失不补零）；
// 只有统计日时项目还不存在（历史不满一页且最早一周晚于统计日）才记为当天 0。
async function verifyGains({ candidates, gh, store, bucket, day, unavailable }) {
  const missing = [];
  const verified = await mapLimit(candidates, 6, async (c) => {
    const res = await gh.history(c);
    if (!res) return (unavailable.push(c.name), null);
    const weeks = JSON.parse(res.body);
    const week = weeks.find((w) => w.week === bucket.week);
    const notYetCreated = !week && weeks.length < PER_PAGE && weeks.every((w) => w.week > bucket.week);
    if (!week && !notYetCreated) return (missing.push(c.name), null);
    return { candidate: c, fullName: c.name, gain: week ? week.days[bucket.dayIndex] : 0, history: store.saveRaw('history', String(c.id), res) };
  });
  if (missing.length) throw new Error(`${missing.length} 个候选在官方星数历史里缺统计日 ${day} 那一周（如 ${missing.slice(0, 3).join('、')}），不发布`);
  return verified.filter(Boolean);
}

// 3. 上榜项目再读一次项目信息，取当前总 Star。
async function withTotals({ top, gh, store }) {
  return mapLimit(top, 6, async (t) => {
    const res = await gh.project(t.candidate);
    if (!res) throw new Error(`上榜项目 ${t.fullName} 的项目信息读不到（404），不发布`);
    const p = JSON.parse(res.body);
    return { rank: t.rank, projectId: p.id, fullName: p.full_name, gain: t.gain, total: p.stargazers_count, evidence: { history: t.history, project: store.saveRaw('project', String(p.id), res) } };
  });
}

// 跑一次出榜：某个已结束统计日的近 1 天涨星榜前 20（含末位并列）。
export async function rankDay({ day, dataDir, fetch = globalThis.fetch, token, now = () => new Date(), limit = 300 }) {
  const bucket = bucketOf(day);
  if (day > lastEndedDay(now())) throw new Error(`统计日 ${day} 还没结束（按 UTC），最近一个已结束的是 ${lastEndedDay(now())}`);
  const done = findSnapshot(dataDir, day);
  if (done) return { status: 'exists', ...done };

  const runId = `${day}_${now().toISOString().replace(/[:.]/g, '-')}`;
  const store = openStore(dataDir, runId);
  const gh = githubClient({ fetch, token });
  const { candidates, unavailable, counts } = await findCandidates({ fetch, day, gh, limit });
  const verified = await verifyGains({ candidates, gh, store, bucket, day, unavailable });
  const entries = await withTotals({ top: topWithTies(verified.filter((v) => v.gain > 0)), gh, store });

  const snapshot = {
    window: WINDOW,
    statDay: day,
    bucket,
    boundaryMode: 'observed_utc',
    generatedAt: now().toISOString(),
    runId,
    candidates: { total: candidates.length, ...counts, unavailable },
    requests: { ...gh.stats },
    entries,
  };
  return { ...store.publish(snapshot), snapshot };
}
