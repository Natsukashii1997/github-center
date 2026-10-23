// 涨星榜之外的三个榜单（#9），随每天出榜一起存快照：新项目榜、官方热门榜、累计高星榜。
// 新项目榜和累计高星榜用 GitHub 官方搜索。已知现象：搜索会把少数仓库计进总数、列表里却不返回（如 bclswl0827/v2ray-heroku），页面上写明。
import { windowDays } from './stat-day.js';
import { topWithTies } from './rank.js';

export const LISTS = { new: '新项目榜', trending: '官方热门榜', top: '累计高星榜' };
// 官方热门榜的三页：name 是页名，period 是页面上“这段时间新增”的说法。
export const TRENDING_PAGES = { daily: { name: '日榜', period: '今日' }, weekly: { name: '周榜', period: '本周' }, monthly: { name: '月榜', period: '本月' } };
export const SINCES = Object.keys(TRENDING_PAGES);

// 按总 Star 取前 20（含末位并列）。搜索结果超时不全（incomplete_results）时不发布。
async function byTotalStars({ gh, store, kind, q }) {
  const res = await gh.search(q);
  const body = JSON.parse(res.body);
  if (body.incomplete_results) throw new Error(`GitHub 搜索结果不全（${q}），不发布`);
  const evidence = store.saveRaw('search', kind, res);
  const top = topWithTies(body.items.map((i) => ({ fullName: i.full_name, gain: i.stargazers_count, item: i })));
  return {
    query: q,
    totalCount: body.total_count,
    evidence,
    entries: top.map(({ rank, item }) => ({ rank, projectId: item.id, fullName: item.full_name, total: item.stargazers_count, createdAt: item.created_at })),
  };
}

// 新项目榜：截至统计日（含）近 30 天内创建的项目，含 fork（全站）。日期写明按 UTC，和涨星榜的统计日一致。
export async function newProjects({ day, gh, store }) {
  const from = windowDays(day, 30)[0];
  return { from, ...(await byTotalStars({ gh, store, kind: 'new', q: `created:${from}T00:00:00+00:00..${day}T23:59:59+00:00 fork:true` })) };
}

// 累计高星榜：全站按总 Star。门槛只是为了让搜索条件成立，前 20 名远高于它。
export function topProjects({ gh, store }) {
  return byTotalStars({ gh, store, kind: 'top', q: 'stars:>=10000 fork:true' });
}

// 官方热门榜：日、周、月三页，全部语言，保持页面原样的顺序；原始页面存档。只能抓到运行当时的页面。
export async function trendingLists({ hotPage, store }) {
  const pages = {};
  for (const since of SINCES) {
    const { items, res } = await hotPage(since);
    pages[since] = {
      fetchedAt: res.date ? new Date(res.date).toISOString() : null,
      url: res.url,
      evidence: store.saveRaw('trending', since, res, 'html'),
      entries: items.map((it, i) => ({ rank: i + 1, projectId: it.id, fullName: it.name, periodStars: it.periodStars, total: it.total })),
    };
  }
  return { pages };
}

const BUILD = { new: newProjects, trending: trendingLists, top: topProjects };
export const buildList = (list, ctx) => BUILD[list](ctx);
