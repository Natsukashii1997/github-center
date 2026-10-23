// 本机网站：只监听 127.0.0.1；页面只读快照和更新记录，访问时不调用任何外部接口。样式从简，视觉由 #13、#14 负责。
// 首页是涨星榜（近 1/7/30 天），另有新项目榜、官方热门榜、累计高星榜。
import { createServer } from 'node:http';
import { readLatestSnapshot, readStatus, WINDOWS, LISTS, SINCES, TRENDING_PAGES } from '../ranking/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
const beijing = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const label = (w) => `近 ${WINDOWS[w].days} 天`;
const repo = (name) => `<a href="https://github.com/${esc(name)}">${esc(name)}</a>`;
const PAGES = [['/', '涨星榜'], ['/new', LISTS.new], ['/trending', LISTS.trending], ['/top', LISTS.top]];
const SEARCH_NOTE = '已知现象：GitHub 搜索会把少数仓库计进总数，但列表里不返回它们，所以极少数项目可能不在这里。';

// 漏失概率写成“约万分之 1.1”这样的说法。
function chance(p) {
  if (p >= 0.01) return `约 ${(p * 100).toFixed(1)}%`;
  const units = [[1e-3, '千分之'], [1e-4, '万分之'], [1e-5, '十万分之'], [1e-6, '百万分之'], [1e-7, '千万分之'], [1e-8, '亿分之']];
  const [u, name] = units.find(([u]) => p >= u) ?? units.at(-1);
  return `约${name} ${(p / u).toFixed(1)}`;
}

// 更新失败时保留上一次的快照，写明它的真实日期和失败原因。
function failure(board, snapshot, status) {
  const last = status?.boards?.[board];
  if (last?.status !== 'failed' || (snapshot && last.day <= snapshot.statDay)) return '';
  return `<p class="warn">统计日 ${esc(last.day)} 的榜单更新失败：${esc(last.error)}${snapshot ? `。下面仍是统计日 ${esc(snapshot.statDay)} 的榜单。` : ''}</p>\n`;
}

function incomplete(snapshot) {
  if (!snapshot.incomplete) return '';
  const why = [];
  if (!snapshot.check.passed) why.push(`自检未通过，估计漏掉一个该上榜项目的概率${chance(snapshot.check.missProbability)}（要求小于百万分之一）`);
  if (snapshot.candidates.failed.length) why.push(`${snapshot.candidates.failed.length} 个候选的官方核数失败`);
  return `<p class="warn">可能不完整：${why.join('；')}。</p>\n`;
}

const table = (heads, rows) => `<table>
<thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>
${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}
</tbody>
</table>`;
const tabs = (items, current) => `<nav>${items.map(([key, href, text]) => (key === current ? `<strong>${text}</strong>` : `<a href="${href}">${text}</a>`)).join('　')}</nav>`;
const empty = (name) => `<p>还没有${name}。先运行一次 <code>npm run rank</code>。</p>`;

function stars(window, snapshot, status) {
  const head = tabs(Object.keys(WINDOWS).map((w) => [w, `/?w=${w}`, label(w)]), window);
  if (!snapshot) return { title: `涨星榜 · ${label(window)}`, body: `${head}\n${failure(window, null, status)}${empty(`${label(window)}的榜单`)}` };
  const span = window === 'd1' ? `统计日 ${esc(snapshot.statDay)}（UTC）` : `统计到 ${esc(snapshot.statDay)}（UTC），${esc(snapshot.from)} 至 ${esc(snapshot.statDay)}`;
  const rows = snapshot.entries.map((e) => [e.rank, repo(e.fullName), `+${num(e.gain)}`, num(e.total)]);
  return {
    title: `涨星榜 · ${label(window)}`,
    body: `${head}
<p>${span}　更新于 ${beijing(snapshot.generatedAt)}（北京时间）</p>
${failure(window, snapshot, status)}${incomplete(snapshot)}${table(['名次', '项目', `${window === 'd1' ? '当天' : label(window)}新增 Star`, '当前总 Star'], rows)}
<p class="note">数字来自 GitHub 官方 Star 历史；前 20 名，末位并列一起列出。${snapshot.check ? '' : '这份榜单生成于每日自检上线之前，没有做完整性自检。'}</p>`,
  };
}

function byTotal(list, snapshot, status) {
  if (!snapshot) return { title: LISTS[list], body: `${failure(list, null, status)}${empty(LISTS[list])}` };
  const scope = list === 'new' ? `近 30 天内（${esc(snapshot.from)} 至 ${esc(snapshot.statDay)}，UTC）创建的项目，含 fork，按总 Star 排` : '全站项目按总 Star 排';
  const rows = snapshot.entries.map((e) => [e.rank, repo(e.fullName), num(e.total), ...(list === 'new' ? [esc(e.createdAt.slice(0, 10))] : [])]);
  return {
    title: LISTS[list],
    body: `<p>统计日 ${esc(snapshot.statDay)}（UTC）　更新于 ${beijing(snapshot.generatedAt)}（北京时间）</p>
${failure(list, snapshot, status)}${table(['名次', '项目', '总 Star', ...(list === 'new' ? ['创建日期'] : [])], rows)}
<p class="note">${scope}；前 20 名，末位并列一起列出。总 Star 来自 GitHub 官方搜索，是更新时的数字。${SEARCH_NOTE}</p>`,
  };
}

function trendingPage(since, snapshot, status) {
  const head = tabs(SINCES.map((s) => [s, `/trending?since=${s}`, TRENDING_PAGES[s].name]), since);
  if (!snapshot) return { title: LISTS.trending, body: `${head}\n${failure('trending', null, status)}${empty(LISTS.trending)}` };
  const page = snapshot.pages[since];
  const rows = page.entries.slice(0, 20).map((e) => [e.rank, repo(e.fullName), e.periodStars == null ? '—' : `+${num(e.periodStars)}`, num(e.total)]);
  return {
    title: `${LISTS.trending} · ${TRENDING_PAGES[since].name}`,
    body: `${head}
<p>抓取于 ${beijing(page.fetchedAt ?? snapshot.generatedAt)}（北京时间）</p>
${failure('trending', snapshot, status)}${table(['名次', '项目', `${TRENDING_PAGES[since].period}新增 Star（GitHub 页面上的数字）`, '总 Star'], rows)}
<p class="note">GitHub 官方 Trending 的原样排序，全部语言；排序规则由 GitHub 决定，不是纯涨星。官方页面共 ${page.entries.length} 个${page.entries.length > 20 ? '，这里列前 20 个' : ''}。</p>`,
  };
}

function route(url, dataDir) {
  const status = readStatus(dataDir);
  const q = (k, d) => url.searchParams.get(k) ?? d;
  switch (url.pathname) {
    case '/': {
      const w = q('w', 'd1');
      return Object.hasOwn(WINDOWS, w) && stars(w, readLatestSnapshot(dataDir, w), status);
    }
    case '/new':
    case '/top': {
      const list = url.pathname.slice(1);
      return byTotal(list, readLatestSnapshot(dataDir, list), status);
    }
    case '/trending': {
      const since = q('since', 'daily');
      return SINCES.includes(since) && trendingPage(since, readLatestSnapshot(dataDir, 'trending'), status);
    }
  }
  return null;
}

const layout = (path, { title, body }) => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;margin:40px auto;max-width:880px;padding:0 24px;color:#202a30;background:#faf9f6}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid #dfe4e1;text-align:left}td:nth-child(3),td:nth-child(4),th:nth-child(3),th:nth-child(4){text-align:right;font-variant-numeric:tabular-nums}a{color:#176b75;text-decoration:none}.note{color:#657176;font-size:12px}.warn{color:#8a4b0f}</style>
</head>
<body>
${tabs(PAGES.map(([href, text]) => [href, href, text]), path)}
<h1>${title}</h1>
${body}
</body>
</html>
`;

export function startServer({ dataDir, port = 5310 }) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    const url = new URL(req.url, 'http://127.0.0.1');
    const page = route(url, dataDir);
    if (!page) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('没有这个页面');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(req.method === 'HEAD' ? undefined : layout(url.pathname, page));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}
