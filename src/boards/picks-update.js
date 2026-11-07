// 精选榜默认填法（#26）：候选池 = 历史榜最近一期前 100 和涨星榜三个窗口这一期的已核数候选（都带简介、topics 和总 Star），
// 按总 Star 取前 limit 个；还没按当前标签清单建议过标签的交给建议器（每批 50 个，2 批同时跑），然后按默认填法重填没固定的卡。
// 一批建议失败不影响其他批，这些项目下次运行再建议；已建议过的不重建（标签清单加了标签才全部重建）。
import { readLatestSnapshot, readCandidates } from '../ranking/store.js';
import { WINDOWS } from '../ranking/stat-day.js';
import { mapLimit } from '../ranking/rank-day.js';
import { openPicks } from './picks.js';
import { BOARD as HISTORY } from './history.js';

export const POOL = 500;
const BATCH = 50;
const CONCURRENCY = 2;

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// 有项目 id 和总 Star 的项目，按 id 去重（历史榜优先：它带作者 id），按总 Star 从高到低。
export function poolFrom(dataDir, limit = POOL) {
  const byId = new Map();
  const add = (x) => x.id && Number.isInteger(x.total) && !byId.has(x.id) && byId.set(x.id, x);
  for (const e of readLatestSnapshot(dataDir, HISTORY)?.entries ?? []) add({ id: e.id, fullName: e.repo, ownerId: e.ownerId, total: e.total, description: e.description, topics: e.topics });
  for (const w of Object.keys(WINDOWS)) {
    const snap = readLatestSnapshot(dataDir, w);
    for (const c of (snap && readCandidates(dataDir, w, snap.statDay)?.items) ?? []) add({ id: c.id, fullName: c.fullName, ownerId: null, total: c.total, description: c.description, topics: c.topics });
  }
  return [...byId.values()].sort((a, b) => b.total - a.total || a.id - b.id).slice(0, limit);
}

// tagger：{ version, suggest(tags, items) → { results: [{ i, tags }], ai? } }（picks-codex.js；ai 是这一批的留痕，#69）。
export async function updatePicks({ dataDir, tagger, limit = POOL, batch = BATCH }) {
  const pool = poolFrom(dataDir, limit);
  const picks = openPicks(dataDir);
  try {
    const todoIds = new Set(picks.upsertPool(pool));
    const todo = pool.filter((x) => todoIds.has(x.id));
    const tags = picks.tags();
    const stat = { pool: pool.length, todo: todo.length, suggested: 0, failed: 0, errors: [] };
    if (tags.length) {
      await mapLimit(chunks(todo, batch), CONCURRENCY, async (group) => {
        try {
          const { results, ai } = await tagger.suggest(tags, group.map(({ fullName, description, topics }) => ({ fullName, description, topics })));
          const got = (Array.isArray(results) ? results : []).filter((r) => Number.isInteger(r?.i) && group[r.i]);
          picks.saveSuggestions(got.map((r) => ({ projectId: group[r.i].id, tags: r.tags })), { version: tagger.version, ai });
          stat.suggested += got.length;
        } catch (e) {
          stat.failed += group.length;
          stat.errors.push(e.message);
        }
      });
    }
    picks.refill();
    const board = picks.board(null);
    return { ...stat, tags: board.tags.map((t) => ({ name: t.name, cards: t.cards.length, manual: t.manual, repos: t.cards.map((c) => c.fullName) })) };
  } finally {
    picks.close();
  }
}
