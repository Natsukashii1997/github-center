import { bucketOf, lastEndedDay, windowDays, dayHours, dayRange, WINDOWS } from './stat-day.js';
import { archiveHour, clickhouseHour, clickhouseDay, trending } from './sources.js';
import { githubClient, PER_PAGE } from './github.js';
import { openStore, findSnapshot, recordStatus } from '../store.js';
import { publishCandidates, readEvents, saveEvents } from './files.js';
import { mapLimit } from '../map-limit.js';
import { topWithTies } from './rank.js';
import { selfCheck, lowerThreshold, completenessFloor } from './check.js';
import { LISTS, buildList } from './lists.js';
import { fetchMeta } from './meta.js';

const MAX_FAILED_SHARE = 0.05;
// 同时发出的官方请求数：4 个约每分钟 500 次，低于 GitHub 每分钟 900 次的次级限流。
const CONCURRENCY = 4;
// 每个窗口最多核这么多个候选（约是近 1 天全部有事件记录的项目数），保证每天一次的运行在额度内跑得完。
const MAX_CANDIDATES = 5000;

// 同一项目可能以不同名字出现（当天改过名），有 id 时按 id 合并，名字取后出现的（更新）；只有名字的按小写名合并，并尽量并入同名的有 id 记录。
// 有 id 的记录遇到同名、还没有 id 的记录（ClickHouse 补的日子不带 id）也并进去，补上 id。
function mergeById(rows) {
  const byId = new Map();
  const byName = new Map();
  for (const r of rows) {
    const named = byName.get(r.name.toLowerCase());
    const known = r.id ? byId.get(r.id) ?? (named && !named.id ? named : undefined) : byId.get(named?.id) ?? named;
    const row = known ?? { id: r.id, name: r.name, events: 0 };
    if (r.id) Object.assign(row, { id: r.id, name: r.name });
    row.events += r.events ?? 0;
    if (row.id) byId.set(row.id, row);
    byName.set(r.name.toLowerCase(), row);
  }
  // 同名的另一个项目会在 byName 里顶掉前一个，所以有 id 的从 byId 取全。
  return [...new Set([...byId.values(), ...byName.values()])];
}

const byEvents = (a, b) => b.events - a.events || (a.name < b.name ? -1 : 1);
const nameKey = (name) => `name:${name.toLowerCase()}`;
const keyOf = (c) => (c.id ? `id:${c.id}` : nameKey(c.name));

// 同一次运行里同一个项目的官方请求只发一次，各窗口共用结果。
function oncePerProject(fn) {
  const cache = new Map();
  return (c) => {
    const key = keyOf(c);
    if (!cache.has(key)) cache.set(key, fn(c));
    return cache.get(key);
  };
}

// 1. 某个统计日的全站 Star 事件按项目合计。存过就直接用；统计日当天读这个太平洋日覆盖的 GH Archive 小时文件
// （UTC D 08:00 至 D+1 08:00，夏令时 07:00 至 07:00，dayHours；缺的小时用 ClickHouse 补），
// 更早的日子（近 7/30 天才用到）从 ClickHouse 按同样的起止补。设置页关掉 ClickHouse（clickhouse 为 false）时不补，缺数据就按更新失败处理。
// 新存的事件数据记下起止（from、to）；#83 之前存的按 UTC 日切、没有起止，照旧使用：事件只用来找候选，上榜数字都来自官方核数。
const OFF = 'ClickHouse 已在设置页关掉，补不上';
const range = (day) => Object.fromEntries(Object.entries(dayRange(day)).map(([k, ms]) => [k, new Date(ms).toISOString()]));
async function dayEvents({ fetch, sleep, dataDir, day, latest, clickhouse }) {
  const saved = readEvents(dataDir, day);
  if (saved) return saved;
  let events;
  if (latest) {
    const fallbackHours = [];
    const hours = await mapLimit(dayHours(day), 4, async ({ date, hour }) => {
      const label = `${date}T${String(hour).padStart(2, '0')}:00Z`;
      try {
        return await archiveHour({ fetch, date, hour });
      } catch {
        if (!clickhouse) throw new Error(`GH Archive 缺 UTC ${label} 这一小时，${OFF}，按更新失败处理`);
        fallbackHours.push(label);
        const rows = await clickhouseHour({ fetch, sleep, date, hour });
        if (!rows.length) throw new Error(`GH Archive 缺 UTC ${label} 这一小时，ClickHouse 也没有这一小时的数据，按更新失败处理`);
        return rows;
      }
    });
    events = { day, ...range(day), source: 'gharchive', fallbackHours: fallbackHours.sort(), rows: mergeById(hours.flat()) };
  } else {
    if (!clickhouse) throw new Error(`缺 ${day} 的事件数据，${OFF}，按更新失败处理`);
    events = { day, ...range(day), source: 'clickhouse', fallbackHours: [], rows: await clickhouseDay({ fetch, sleep, day }) };
    if (!events.rows.length) throw new Error(`ClickHouse 没有 ${day} 的事件数据，按更新失败处理`);
  }
  saveEvents(dataDir, day, events);
  return events;
}

async function windowEvents({ fetch, sleep, dataDir, days, clickhouse }) {
  const perDay = [];
  for (const d of days) perDay.push(await dayEvents({ fetch, sleep, dataDir, day: d, latest: d === days.at(-1), clickhouse }));
  return {
    rows: mergeById(perDay.flatMap((e) => e.rows)).sort(byEvents),
    fallbackHours: perDay.at(-1).fallbackHours,
    backfilledDays: perDay.filter((e) => e.source === 'clickhouse').map((e) => e.day),
  };
}

// 2. 官方核数：每个候选读一次官方星数历史（6 周，近 1/7/30 天都从这一次里取），同一次运行里各窗口共用。
function verifier({ gh, store }) {
  return oncePerProject((c) => gh.history(c).then(
    (res) => (res ? { weeks: JSON.parse(res.body), evidence: store.saveRaw('history', String(c.id ?? c.name.replace('/', '__')), res) } : { unavailable: true }),
    (e) => ({ error: e.message }),
  ));
}

// 窗口内每个统计日取官方星数历史里那一格相加。缺某一周就算核数失败（缺失不补零）；
// 只有那天项目还不存在（历史不满一页且最早一周晚于那天）才记为 0。
function gainOf(weeks, days) {
  let sum = 0;
  for (const d of days) {
    const b = bucketOf(d);
    const week = weeks.find((w) => w.week === b.week);
    if (week) sum += week.days[b.dayIndex];
    else if (!(weeks.length < PER_PAGE && weeks.every((w) => w.week > b.week))) return null;
  }
  return sum;
}

function projects({ gh, store }) {
  return oncePerProject((c) => gh.project(c).then((res) => {
    if (!res) throw new Error(`上榜项目 ${c.name} 的项目信息读不到（404），不发布`);
    const p = JSON.parse(res.body);
    return { p, evidence: store.saveRaw('project', String(p.id), res) };
  }));
}

// 3. 前 20（含末位并列）再读一次项目信息，取当前总 Star 和项目 id。
// 只有名字的候选到这一步才拿到 id：同一项目用新旧两个名字都进了榜（改过名）时只留一个，再重排。
async function rankEntries({ verified, project }) {
  let pool = verified.filter((v) => v.gain > 0);
  for (;;) {
    const top = topWithTies(pool);
    const rows = await mapLimit(top, CONCURRENCY, async (t) => ({ t, ...(await project(t.candidate)) }));
    const seen = new Set();
    const dup = new Set(rows.filter(({ p }) => seen.has(p.id) || !seen.add(p.id)).map(({ t }) => t.candidate));
    if (!dup.size) {
      return rows.map(({ t, p, evidence }) => ({ rank: t.rank, projectId: p.id, fullName: p.full_name, gain: t.gain, total: p.stargazers_count, records: t.records, evidence: { history: t.history, project: evidence } }));
    }
    pool = pool.filter((v) => !dup.has(v.candidate));
  }
}

// 一个窗口出榜：候选取事件记录次数前 limit 名（同次数的一起进）并入官方热门榜，核数排名后自检；
// 自检不过就降低候选门槛、补核新进的候选再排，直到通过；门槛降到 1 或候选到上限仍不过，就如实标注“可能不完整”。
async function rankWindow({ window, day, fetch, sleep, dataDir, gh, verify, project, hotPage, limit, maxCandidates, clickhouse }) {
  const before = { ...gh.stats };
  const days = windowDays(day, WINDOWS[window].days);
  const ev = await windowEvents({ fetch, sleep, dataDir, days, clickhouse });
  const { items: hotItems } = await hotPage(WINDOWS[window].since);
  let threshold = ev.rows[Math.min(limit, ev.rows.length) - 1]?.events ?? 1;
  // 候选上限对应的最低门槛：门槛再低，事件数据里达到它的项目就超过上限了。
  const floor = ev.rows.length > maxCandidates ? ev.rows[maxCandidates].events + 1 : 1;
  // 只从官方热门榜进来的候选，自检时也按它在事件数据里的真实记录次数算。
  const recorded = new Map(ev.rows.flatMap((r) => [[nameKey(r.name), r.events], ...(r.id ? [[keyOf(r), r.events]] : [])]));
  const recordsOf = (c) => c.events || recorded.get(keyOf(c)) || recorded.get(nameKey(c.name)) || 0;
  for (;;) {
    const fromEvents = ev.rows.filter((r) => r.events >= threshold);
    const candidates = mergeById([...fromEvents, ...hotItems]);
    const results = await mapLimit(candidates, CONCURRENCY, verify);
    const unavailable = [];
    const failed = [];
    const verified = [];
    candidates.forEach((c, i) => {
      const r = results[i];
      if (r.unavailable) return unavailable.push(c.name);
      const gain = r.weeks ? gainOf(r.weeks, days) : null;
      if (gain === null) return failed.push({ name: c.name, reason: r.error ?? (days.length === 1 ? `官方星数历史缺统计日 ${day} 那一周` : `官方星数历史缺 ${days[0]} 至 ${day} 之间的某一周`) });
      verified.push({ candidate: c, fullName: c.name, gain, records: recordsOf(c), history: r.evidence });
    });
    // 少数候选核数失败照样发布、标注“可能不完整”；大面积失败多半是上游出了问题，按更新失败处理。
    if (failed.length > MAX_FAILED_SHARE * candidates.length || !verified.some((v) => v.gain > 0)) {
      throw new Error(`${candidates.length} 个候选里 ${failed.length} 个核数失败（如 ${failed[0]?.name}：${failed[0]?.reason}），不发布`);
    }
    const entries = await rankEntries({ verified, project });
    const check = selfCheck({ entries, threshold });
    const next = Math.max(lowerThreshold(check), floor);
    if (check.passed || next >= threshold) {
      return { days, ev, candidates, fromEvents: fromEvents.length, hot: hotItems.length, unavailable, failed, verified, entries, check: { ...check, completenessFloor: completenessFloor(check) }, requests: { history: gh.stats.history - before.history, project: gh.stats.project - before.project } };
    }
    threshold = next;
  }
}

// 4. 已核数候选的描述、topics 和当前总 Star（#10），同一次运行里每个候选只取一次，各窗口共用。
function metaFetcher({ gh, store }) {
  const cache = new Map();
  return async (verified, label) => {
    const todo = [...new Map(verified.map((v) => [keyOf(v.candidate), v.candidate]))].filter(([k]) => !cache.has(k));
    const before = gh.stats.graphql;
    const { meta } = await fetchMeta({ gh, store, items: todo.map(([, c]) => c), label });
    todo.forEach(([k], i) => cache.set(k, meta[i]));
    return { get: (c) => cache.get(keyOf(c)), requests: gh.stats.graphql - before };
  };
}

// 这一期全部已核数的候选另存一份（#10）：分类榜在里面按分类重新取前 20，归类按名称、描述和 topics。
// 改过名的同一项目用新旧名字都进了候选时只留一个；取不到资料的描述、topics、总 Star 记为 null。
function candidatesFile({ window, day, runId, generatedAt, r, meta }) {
  const seen = new Set();
  const items = [];
  for (const v of [...r.verified].sort((a, b) => b.gain - a.gain || (a.fullName < b.fullName ? -1 : 1))) {
    const m = meta.get(v.candidate);
    const id = m?.id ?? v.candidate.id ?? null;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    items.push({ id, fullName: m?.fullName ?? v.fullName, gain: v.gain, total: m?.total ?? null, description: m ? m.description : null, topics: m?.topics ?? null, evidence: { history: v.history.path, meta: m?.evidence ?? null } });
  }
  const { threshold, recordRatio, completenessFloor } = r.check;
  return { window, statDay: day, generatedAt, runId, check: { threshold, recordRatio, completenessFloor }, meta: { found: items.filter((x) => x.evidence.meta).length, missing: items.filter((x) => !x.evidence.meta).length }, items };
}

// 跑一次出榜：某个已结束统计日的近 1、7、30 天涨星榜前 20（含末位并列），以及官方热门榜，各自单独发布。
// 已发布的不重跑；某个榜单失败不影响其他榜单，失败原因记进 status.json，网站据此提示。
// 官方热门榜只能取到运行当时的数据，所以只在出最近一个已结束的统计日时生成；补跑更早的日子不生成，免得把现在的数字记成旧日子的。
// sources：设置页的数据源开关（../settings）。关掉官方热门：候选只来自事件数据，也不出官方热门榜；关掉 ClickHouse：不补缺的小时和更早的日子。
export async function rankDay({ day, dataDir, fetch = globalThis.fetch, token, now = () => new Date(), limit = 300, maxCandidates = MAX_CANDIDATES, windows = Object.keys(WINDOWS), lists = Object.keys(LISTS), sleep, sources = { trending: true, clickhouse: true } }) {
  if (day > lastEndedDay(now())) throw new Error(`统计日 ${day} 还没结束（GitHub 统计日按美国太平洋时间），最近一个已结束的是 ${lastEndedDay(now())}`);
  const results = { windows: {}, lists: {} };
  // 已发布的记为 exists，返回还没发布的。
  const unpublished = (kind, boards) => boards.filter((b) => {
    const done = findSnapshot(dataDir, b, day);
    if (done) results[kind][b] = { status: 'exists', ...done };
    return !done;
  });
  const todoWindows = unpublished('windows', windows);
  const todoLists = unpublished('lists', day === lastEndedDay(now()) ? lists.filter((l) => l !== 'trending' || sources.trending) : []);

  if (todoWindows.length || todoLists.length) {
    const runId = `${day}_${now().toISOString().replace(/[:.]/g, '-')}`;
    const store = openStore(dataDir, runId);
    const gh = githubClient({ fetch, token, sleep });
    const verify = verifier({ gh, store });
    const project = projects({ gh, store });
    const metaFor = metaFetcher({ gh, store });
    // 同一次运行里官方热门榜的每一页只抓一次：涨星榜找候选和官方热门榜共用。
    const pages = new Map();
    const hotPage = (since) => {
      if (!pages.has(since)) pages.set(since, sources.trending ? trending({ fetch, sleep, since }) : Promise.resolve({ items: [] }));
      return pages.get(since);
    };
    for (const window of todoWindows) {
      try {
        const r = await rankWindow({ window, day, fetch, sleep, dataDir, gh, verify, project, hotPage, limit, maxCandidates, clickhouse: sources.clickhouse });
        const meta = await metaFor(r.verified, window);
        const generatedAt = now().toISOString();
        const cands = candidatesFile({ window, day, runId, generatedAt, r, meta });
        const candidatesSaved = { path: publishCandidates(dataDir, window, cands).path, ...cands.meta };
        const snapshot = {
          window,
          statDay: day,
          from: r.days[0],
          bucket: bucketOf(day),
          boundaryMode: 'observed_utc',
          generatedAt,
          runId,
          candidates: { total: r.candidates.length, verified: r.verified.length, archive: r.fromEvents, trending: r.hot, fallbackHours: r.ev.fallbackHours, backfilledDays: r.ev.backfilledDays, unavailable: r.unavailable, failed: r.failed },
          check: r.check,
          incomplete: !r.check.passed || r.failed.length > 0,
          requests: { ...r.requests, graphql: meta.requests },
          entries: r.entries.map(({ records, ...e }) => e),
        };
        results.windows[window] = { ...store.publish(window, snapshot), snapshot, candidates: candidatesSaved };
      } catch (e) {
        results.windows[window] = { status: 'failed', error: e.message };
      }
    }
    for (const list of todoLists) {
      try {
        const snapshot = { list, statDay: day, generatedAt: now().toISOString(), runId, ...(await buildList(list, { day, gh, store, hotPage })) };
        results.lists[list] = { ...store.publish(list, snapshot), snapshot };
      } catch (e) {
        results.lists[list] = { status: 'failed', error: e.message };
      }
    }
  }
  recordStatus(dataDir, { day, at: now().toISOString(), boards: { ...results.windows, ...results.lists } });
  return { day, ...results };
}
