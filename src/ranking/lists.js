// 涨星榜之外随每天出榜一起存快照的榜单（#9）：现在只剩官方热门榜，它也是涨星榜找候选的来源（DECIDED 2026-11-03：数据照抓、不单独展示）。
// 新项目榜（new）和累计高星榜（top）页面 11-03 已删，2026-11-22 起不再生成（#110）；已有快照留着不删。
// 累计高星榜和全站 Star 前 100（boards/history.js）是同一条搜索，现在只由后者每天请求一次。

export const LISTS = { trending: '官方热门榜' };
// 官方热门榜的三页：name 是页名，period 是页面上“这段时间新增”的说法。
export const TRENDING_PAGES = { daily: { name: '日榜', period: '今日' }, weekly: { name: '周榜', period: '本周' }, monthly: { name: '月榜', period: '本月' } };
export const SINCES = Object.keys(TRENDING_PAGES);

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

const BUILD = { trending: trendingLists };
export const buildList = (list, ctx) => BUILD[list](ctx);
