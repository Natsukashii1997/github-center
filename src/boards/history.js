// 历史榜（#24）：每天一次 GitHub 官方搜索按总 Star 倒序取全站前 100，存快照 snapshots/history/<日期>.json，网站展示前 50。
// 日期是实际抓取那天（UTC），快照里另记抓取时刻。同一天已存过就不再请求；失败时保留上一次快照，status.json 记下失败的日期和原因。
// 已知现象（原累计高星榜同样有）：搜索会把少数仓库计进总数、列表里却不返回，页面上写明（SEARCH_NOTE）。
import { join } from 'node:path';
import { openStore, findSnapshot, readLatestSnapshot, readStatus, recordStatus, newerFailure, writeOnce } from '../ranking/store.js';

export const BOARD = 'history';
// 门槛只是为了让搜索条件成立，前 100 名远高于它（原累计高星榜也是这条，#110 起只在这里请求）。
export const QUERY = 'stars:>=10000 fork:true';
export const KEEP = 100;
export const SHOW = 50;
export const SEARCH_NOTE = '已知现象：GitHub 搜索会把少数仓库计进总数，但列表里不返回它们，所以极少数项目可能不在这里。';

// 搜索结果 → 名单。结果不全（incomplete_results）或格式不对就报错，不发布。
export function parseHistory(text) {
  const body = JSON.parse(text);
  if (body.incomplete_results) throw new Error('GitHub 搜索结果不全（incomplete_results），不发布');
  if (!Array.isArray(body.items)) throw new Error('GitHub 搜索返回里没有 items');
  const entries = [...body.items]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, KEEP)
    .map((i, n) => ({
      rank: n + 1,
      repo: i.full_name,
      id: i.id,
      ownerId: i.owner?.id ?? null,
      total: i.stargazers_count,
      description: i.description ?? null,
      language: i.language ?? null,
      topics: i.topics ?? [],
      pushedAt: i.pushed_at ?? null,
    }));
  return { totalCount: body.total_count, entries };
}

// 跑一次：返回 { status: 'published' | 'exists' | 'failed', path?, snapshot?, error?, requests }。
// gh：ranking/github.js 的 githubClient（只用 search，一次请求）。
export async function updateHistory({ dataDir, gh, now = () => new Date() }) {
  const at = now();
  const day = at.toISOString().slice(0, 10);
  const done = findSnapshot(dataDir, BOARD, day);
  if (done) return { status: 'exists', ...done, requests: 0 };
  const before = gh.stats.search;
  try {
    const res = await gh.search(QUERY);
    const { totalCount, entries } = parseHistory(res.body);
    const store = openStore(dataDir, `${BOARD}_${at.toISOString().replace(/[:.]/g, '-')}`);
    const evidence = store.saveRaw('search', BOARD, res);
    const snapshot = { board: BOARD, statDay: day, fetchedAt: at.toISOString(), query: QUERY, totalCount, evidence, entries };
    const r = writeOnce(dataDir, join('snapshots', BOARD, `${day}.json`), JSON.stringify(snapshot, null, 2));
    recordStatus(dataDir, { day, at: at.toISOString(), boards: { [BOARD]: { status: r.status } } });
    return { ...r, snapshot, requests: gh.stats.search - before };
  } catch (e) {
    recordStatus(dataDir, { day, at: at.toISOString(), boards: { [BOARD]: { status: 'failed', error: e.message } } });
    return { status: 'failed', error: e.message, requests: gh.stats.search - before };
  }
}

// 网站读：最近一次快照的前 show 名，和它之后有没有更新失败。没有快照返回 null。
// 返回 { day, fetchedAt, totalCount, entries, failure: { day, at, error } | null, note }。
export function readHistoryBoard(dataDir, { show = SHOW } = {}) {
  const snapshot = readLatestSnapshot(dataDir, BOARD);
  const failure = newerFailure(readStatus(dataDir), BOARD, snapshot);
  if (!snapshot) return failure ? { day: null, fetchedAt: null, totalCount: null, entries: [], failure, note: SEARCH_NOTE } : null;
  return {
    day: snapshot.statDay,
    fetchedAt: snapshot.fetchedAt,
    totalCount: snapshot.totalCount,
    entries: snapshot.entries.slice(0, show),
    failure: failure && { day: failure.day, at: failure.at, error: failure.error },
    note: SEARCH_NOTE,
  };
}
