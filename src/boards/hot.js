// 热点榜（#25）：每天一次，从 Hacker News（Algolia 公开搜索接口）和 V2EX（公开接口 v1）找指向 GitHub 仓库的帖子，
// 热度 = 点赞数 + 评论数，按仓库合计，记下各来源的份额；存快照 snapshots/hot/<日期>.json（日期是实际抓取那天，UTC）。
// 口径：每天量一次“近 7 天发的帖子”此刻的热度合计（HN 的点数、评论数在发帖后几天里还会涨，所以每天重量）。
// 近 7 天走势是每天各量一次的这个数，从存下的每日快照拼出；不满 7 天时 days 写明已记几天。
// V2EX 接口每个列表只给最新的几条（不能翻页），所以以前看到过、窗口内的 V2EX 帖子沿用上一次量到的数；
// 某个来源当天失败时同样沿用它上一次的帖子，快照里记下这个来源失败。两个来源都失败才算这一天失败，保留上一次快照。
// 设置页关掉的来源（enabled[来源] 为 false）不抓，也沿用它上一次的帖子，快照里记 status 'off'。
// Reddit 等以后拿到免费凭证再接（在 SOURCES 里加一项）；不接 X。
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { readJson, findSnapshot, readStatus, recordStatus, newerFailure, writeOnce, readLatestSnapshot } from '../ranking/store.js';
import { windowDays } from '../ranking/stat-day.js';
import { findRepos } from './repo-link.js';

export const BOARD = 'hot';
export const WINDOW_DAYS = 7;
export const SHOW = 15;
// 一个帖子链到超过这么多个不同仓库，算合集帖（“本周项目推荐”之类），不计入任何仓库。
export const MAX_REPOS_PER_POST = 3;
// 热度最高的这么多个仓库用 GitHub GraphQL 核一次（一次请求）：拿项目 id、作者 id、简介，去掉不存在的，合并改过名的。
export const RESOLVE = 40;

const HN = 'https://hn.algolia.com/api/v1/search_by_date';
const V2EX = 'https://www.v2ex.com/api';
// V2EX 要读的列表：最热、最新，和常发开源项目的几个节点。每个列表一次请求。
export const V2EX_LISTS = ['topics/hot.json', 'topics/latest.json', ...['create', 'github', 'opensource', 'share', 'programmer'].map((n) => `topics/show.json?node_name=${n}`)];

export const heatOf = (post) => (post.points ?? 0) + (post.comments ?? 0);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 公开接口的 GET：两次请求之间至少隔 gapMs；网络错误、5xx、429 最多试 3 次（429 按 retry-after 等）。stats 记实际请求次数。
export function jsonGetter({ fetch = globalThis.fetch, sleep = realSleep, gapMs = 1000, timeoutMs = 30_000 } = {}) {
  const stats = { requests: 0 };
  let last = 0;
  async function get(url) {
    for (let attempt = 1; ; attempt++) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      stats.requests++;
      let res;
      try {
        res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'github-center' }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        if (attempt < 3) { await sleep(attempt * 2000); continue; }
        throw new Error(`${url} 请求失败：${e.message}`);
      }
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(Math.min(Number(res.headers.get('retry-after')) * 1000 || attempt * 5000, 120_000));
        continue;
      }
      throw new Error(`${url} 返回 ${res.status}：${text.slice(0, 200)}`);
    }
  }
  return { get, stats };
}

// 帖子 → 只留链到 1 到 MAX_REPOS_PER_POST 个仓库的。
const keep = (post) => post.repos.length > 0 && post.repos.length <= MAX_REPOS_PER_POST;

// HN 一条 hit → 帖子。只看帖子本身的链接（url），不看正文和评论。
export function hnPost(hit) {
  return {
    source: 'hn',
    id: String(hit.objectID),
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    title: hit.title ?? '',
    createdAt: new Date(hit.created_at_i * 1000).toISOString(),
    points: hit.points ?? 0,
    comments: hit.num_comments ?? 0,
    repos: findRepos(hit.url),
  };
}

// V2EX 一个主题 → 帖子。V2EX 没有点赞数，热度只算回复数；仓库链接从标题和正文里找。
export function v2exPost(t) {
  return {
    source: 'v2ex',
    id: String(t.id),
    url: t.url ?? `https://www.v2ex.com/t/${t.id}`,
    title: t.title ?? '',
    createdAt: new Date(t.created * 1000).toISOString(),
    points: 0,
    comments: t.replies ?? 0,
    repos: findRepos(`${t.title ?? ''}\n${t.content ?? ''}`),
  };
}

// HN：近 7 天按 24 小时切成 7 段，每段一次请求（每段一百多条，远低于单次 1000 条上限；超了就记下 truncated）。
async function hnFetch({ get, from, to }) {
  const posts = [];
  let truncated = 0;
  for (let end = to; end > from; end -= 86400) {
    const start = Math.max(from, end - 86400);
    const q = new URLSearchParams({ query: 'github.com', restrictSearchableAttributes: 'url', tags: 'story', numericFilters: `created_at_i>${start},created_at_i<=${end}`, hitsPerPage: '1000' });
    const body = await get(`${HN}?${q}`);
    if (!Array.isArray(body.hits)) throw new Error('HN 搜索返回里没有 hits');
    truncated += Math.max(0, (body.nbHits ?? 0) - body.hits.length);
    posts.push(...body.hits.map(hnPost));
  }
  return { posts: posts.filter(keep), truncated };
}

// 某个列表失败（如节点改名）只跳过它，记进 errors；全部失败才算 V2EX 这一天失败。
async function v2exFetch({ get, from }) {
  const byId = new Map();
  const errors = [];
  for (const list of V2EX_LISTS) {
    try {
      const body = await get(`${V2EX}/${list}`);
      if (!Array.isArray(body)) throw new Error(`${list} 返回的不是主题列表：${JSON.stringify(body).slice(0, 120)}`);
      for (const t of body) if (!t.deleted && t.created >= from) byId.set(String(t.id), v2exPost(t));
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length === V2EX_LISTS.length) throw new Error(errors[0]);
  return { posts: [...byId.values()].filter(keep), truncated: 0, errors };
}

// complete：一次抓取就能看到窗口内全部帖子（不需要沿用以前看到的）。
export const SOURCES = { hn: { name: 'Hacker News', fetch: hnFetch, complete: true }, v2ex: { name: 'V2EX', fetch: v2exFetch, complete: false } };

// 帖子 → 按仓库合计（仓库名不分大小写）。返回按热度从高到低：{ key, repo, heat, sources: { hn, v2ex }, posts }。
export function aggregate(posts) {
  const byKey = new Map();
  for (const p of posts) {
    for (const repo of p.repos) {
      const key = repo.toLowerCase();
      const r = byKey.get(key) ?? { key, repo, heat: 0, sources: Object.fromEntries(Object.keys(SOURCES).map((s) => [s, 0])), posts: 0 };
      r.heat += heatOf(p);
      r.sources[p.source] = (r.sources[p.source] ?? 0) + heatOf(p);
      r.posts++;
      byKey.set(key, r);
    }
  }
  return [...byKey.values()].sort((a, b) => b.heat - a.heat || (a.key < b.key ? -1 : 1));
}

const RESOLVE_FIELDS = 'databaseId nameWithOwner description stargazerCount owner { ... on User { databaseId } ... on Organization { databaseId } }';
export function resolveQuery(repos) {
  return `query {\n${repos.map((r, i) => {
    const [owner, name] = r.split('/');
    return `  r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${RESOLVE_FIELDS} }`;
  }).join('\n')}\n}`;
}

// 热度最高的 RESOLVE 个仓库核一次：查不到的去掉，改过名（几个链接指向同一个项目 id）的合并。
// GraphQL 整个失败时不去掉任何仓库，id 等记为 null，resolve.failed 写明。
async function resolveTop({ gh, ranked }) {
  const top = ranked.slice(0, RESOLVE);
  const resolve = { requested: top.length, found: 0, failed: false };
  if (!top.length) return { entries: [], resolve };
  let data;
  try {
    data = JSON.parse((await gh.graphql(resolveQuery(top.map((r) => r.repo)))).body).data;
    if (!data) throw new Error('GraphQL 没有返回数据');
  } catch {
    resolve.failed = true;
    return { entries: top.map((r) => ({ ...r, id: null, ownerId: null, description: null, total: null, aliases: [r.key] })), resolve };
  }
  const byId = new Map();
  top.forEach((r, i) => {
    const g = data[`r${i}`];
    if (!g) return;
    resolve.found++;
    const had = byId.get(g.databaseId);
    if (had) {
      had.heat += r.heat;
      had.posts += r.posts;
      for (const [s, v] of Object.entries(r.sources)) had.sources[s] = (had.sources[s] ?? 0) + v;
      had.aliases.push(r.key);
      return;
    }
    byId.set(g.databaseId, { ...r, sources: { ...r.sources }, repo: g.nameWithOwner, id: g.databaseId, ownerId: g.owner?.databaseId ?? null, description: g.description ?? null, total: g.stargazerCount, aliases: [r.key] });
  });
  return { entries: [...byId.values()].sort((a, b) => b.heat - a.heat), resolve };
}

// 帖子 → 一天的快照（各来源计入几个帖子、核热度最高的仓库、按热度排名）。
async function snapshotOf({ gh, day, at, from, sources, posts }) {
  for (const [s, x] of Object.entries(sources)) x.posts = posts.filter((p) => p.source === s).length;
  const { entries, resolve } = await resolveTop({ gh, ranked: aggregate(posts) });
  return {
    board: BOARD,
    statDay: day,
    fetchedAt: at.toISOString(),
    window: { from: new Date(from * 1000).toISOString(), to: at.toISOString() },
    sources,
    resolve,
    entries: entries.map((e, i) => ({ rank: i + 1, repo: e.repo, id: e.id, ownerId: e.ownerId, description: e.description, total: e.total, heat: e.heat, sources: e.sources, posts: e.posts, aliases: e.aliases })),
    posts,
  };
}

// 跑一次：返回 { status: 'published' | 'exists' | 'failed', path?, snapshot?, error?, requests }。
// gh：ranking/github.js 的 githubClient（只用 graphql，一次请求）；get：jsonGetter().get。
export async function updateHot({ dataDir, gh, get, now = () => new Date(), enabled = {} }) {
  const at = now();
  const day = at.toISOString().slice(0, 10);
  const done = findSnapshot(dataDir, BOARD, day);
  if (done) return { status: 'exists', ...done };
  const to = Math.floor(at.getTime() / 1000);
  const from = to - WINDOW_DAYS * 86400;
  const prev = readLatestSnapshot(dataDir, BOARD);
  const sources = {};
  const fresh = [];
  for (const [s, src] of Object.entries(SOURCES)) {
    if (enabled[s] === false) {
      sources[s] = { status: 'off' };
      continue;
    }
    try {
      const r = await src.fetch({ get, from, to });
      sources[s] = { status: 'ok', fetched: r.posts.length, ...(r.truncated ? { truncated: r.truncated } : {}), ...(r.errors?.length ? { errors: r.errors } : {}) };
      fresh.push(...r.posts);
    } catch (e) {
      sources[s] = { status: 'failed', error: e.message };
    }
  }
  if (Object.values(sources).every((x) => x.status !== 'ok') && Object.values(sources).some((x) => x.status === 'failed')) {
    const error = Object.entries(sources).filter(([, x]) => x.status === 'failed').map(([s, x]) => `${SOURCES[s].name}：${x.error}`).join('；');
    recordStatus(dataDir, { day, at: at.toISOString(), boards: { [BOARD]: { status: 'failed', error } } });
    return { status: 'failed', error };
  }
  // 沿用上一次快照里、仍在窗口内的帖子：只给一次看不全的来源（V2EX）和当天失败或关掉的来源。
  const seen = new Set(fresh.map((p) => `${p.source}:${p.id}`));
  const carried = (prev?.posts ?? []).filter((p) => Object.hasOwn(SOURCES, p.source)
    && (!SOURCES[p.source].complete || sources[p.source].status !== 'ok')
    && Date.parse(p.createdAt) / 1000 > from && !seen.has(`${p.source}:${p.id}`));
  const posts = [...fresh, ...carried];
  const snapshot = await snapshotOf({ gh, day, at, from, sources, posts });
  const r = writeOnce(dataDir, join('snapshots', BOARD, `${day}.json`), JSON.stringify(snapshot));
  recordStatus(dataDir, { day, at: at.toISOString(), boards: { [BOARD]: { status: r.status } } });
  return { ...r, snapshot };
}

// 补录（所有者 2026-11-04 定）：给过去没存快照的某天补一份，当作那天北京时间 10:00（每日更新的默认时间）量的。
// 过去某一刻的点数、评论数查不到，只能用补录这一刻接口给的数回推：窗口里离那天最近一两天发的帖子，当时还没涨到现在这么多，补出来偏高；
// V2EX 接口翻不到旧帖，只用已存快照里见过的帖子（取最近一次量到的回复数），偏低。快照记 backfilled，页面写明哪几天是补录的。
// 只补今天（UTC）以前、还没有快照的日子；不改 status.json。返回 { status: 'published' | 'exists', path, snapshot? }，HN 失败直接抛错。
export const BACKFILL_NOTE = '补录：按补录时量到的点数、评论数回推，离这天最近一两天发的帖子会偏高；V2EX 旧帖翻不到，只算见过的，会偏低';
export async function backfillHot({ dataDir, gh, get, day, now = () => new Date() }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= now().toISOString().slice(0, 10)) throw new Error(`只能补今天以前的日子：${day}`);
  const done = findSnapshot(dataDir, BOARD, day);
  if (done) return { status: 'exists', ...done };
  const at = new Date(`${day}T02:00:00Z`);
  const to = at.getTime() / 1000;
  const from = to - WINDOW_DAYS * 86400;
  const saved = new Map();
  for (const [, file] of [...dailySnapshots(dataDir)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const p of readJson(file).posts ?? []) saved.set(`${p.source}:${p.id}`, p);
  }
  const inWindow = (p) => Date.parse(p.createdAt) / 1000 > from && Date.parse(p.createdAt) / 1000 <= to;
  const sources = {};
  const posts = [];
  for (const [s, src] of Object.entries(SOURCES)) {
    if (src.complete) {
      const r = await src.fetch({ get, from, to });
      sources[s] = { status: 'ok', fetched: r.posts.length, ...(r.truncated ? { truncated: r.truncated } : {}) };
      posts.push(...r.posts);
    } else {
      sources[s] = { status: 'ok', fetched: 0 };
      posts.push(...[...saved.values()].filter((p) => p.source === s && inWindow(p)));
    }
  }
  const snapshot = { ...(await snapshotOf({ gh, day, at, from, sources, posts })), backfilled: { at: now().toISOString(), note: BACKFILL_NOTE } };
  return { ...writeOnce(dataDir, join('snapshots', BOARD, `${day}.json`), JSON.stringify(snapshot)), snapshot };
}

// 存下的每日快照（按日期）。
function dailySnapshots(dataDir) {
  const dir = join(dataDir, 'snapshots', BOARD);
  if (!existsSync(dir)) return new Map();
  return new Map(readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => [f.slice(0, 10), join(dir, f)]));
}

// 网站读：最近一次快照的前 show 名，每个带近 7 天每天量到的热度（那天没存快照为 null）和比前一天的涨跌。
// 返回 { day, fetchedAt, days, complete, sources, entries: [{ rank, repo, id, ownerId, description, total, heat, sources, posts,
//   series: [{ day, heat }]（7 个，从早到晚）, change: { yesterday, delta, ratio } | null }], failure } ；没有快照返回 null。
// days：近 7 天里存了快照的天数；不满 7（complete 为 false）时页面写「记录不满 7 天（已记 N 天）」。
// backfilled：近 7 天里哪几天是补录的（见 backfillHot），页面写明。
// change：前一天没有快照为 null；前一天热度是 0（新上来的）时 ratio 为 null。
export function readHotBoard(dataDir, { show = SHOW } = {}) {
  const snapshot = readLatestSnapshot(dataDir, BOARD);
  const failure = newerFailure(readStatus(dataDir), BOARD, snapshot);
  if (!snapshot) return failure ? { day: null, fetchedAt: null, days: 0, complete: false, sources: {}, entries: [], failure } : null;
  const files = dailySnapshots(dataDir);
  const days = windowDays(snapshot.statDay, WINDOW_DAYS);
  const backfilled = [];
  const heatByDay = new Map(days.map((d) => {
    const s = d === snapshot.statDay ? snapshot : files.has(d) ? readJson(files.get(d)) : null;
    if (s?.backfilled) backfilled.push(d);
    return [d, s && new Map(aggregate(s.posts).map((r) => [r.key, r.heat]))];
  }));
  const heatOn = (d, aliases) => {
    const m = heatByDay.get(d);
    return m ? aliases.reduce((sum, k) => sum + (m.get(k) ?? 0), 0) : null;
  };
  const yesterday = days.at(-2);
  const entries = snapshot.entries.slice(0, show).map((e) => {
    const series = days.map((d) => ({ day: d, heat: heatOn(d, e.aliases) }));
    const y = heatOn(yesterday, e.aliases);
    return { ...e, series, change: y === null ? null : { yesterday: y, delta: e.heat - y, ratio: y > 0 ? (e.heat - y) / y : null } };
  });
  const recorded = [...heatByDay.values()].filter(Boolean).length;
  return {
    day: snapshot.statDay,
    fetchedAt: snapshot.fetchedAt,
    days: recorded,
    complete: recorded >= WINDOW_DAYS,
    backfilled,
    sources: snapshot.sources,
    entries,
    failure: failure && { day: failure.day, at: failure.at, error: failure.error },
  };
}
