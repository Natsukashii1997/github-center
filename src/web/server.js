// 本机网站：只监听 127.0.0.1；登录后才能看（#5）。页面只读快照和更新记录，访问时不调用任何外部接口。样式从简，视觉由 #13、#14 负责。
// 首页是涨星榜（近 1/7/30 天），另有新项目榜、官方热门榜、累计高星榜。
import { createServer } from 'node:http';
import { openAccounts, ROLES, SESSION_DAYS } from './accounts.js';
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

const STYLE = 'body{font:14px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;margin:40px auto;max-width:880px;padding:0 24px;color:#202a30;background:#faf9f6}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid #dfe4e1;text-align:left}td:nth-child(3),td:nth-child(4),th:nth-child(3),th:nth-child(4){text-align:right;font-variant-numeric:tabular-nums}a{color:#176b75;text-decoration:none}.note{color:#657176;font-size:12px}.warn{color:#8a4b0f}header form{display:inline}';
const document = (title, inner) => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
${inner}
</body>
</html>
`;
const layout = (path, account, { title, body }) => document(title, `<header>${tabs(PAGES.map(([href, text]) => [href, href, text]), path)}
<p class="note">${esc(account.name)}（${ROLES[account.role]}）　<form method="post" action="/logout"><button>退出</button></form></p></header>
<h1>${title}</h1>
${body}`);

const loginPage = (next, error) => document('登录 · GitHub 快速中心', `<h1>GitHub 快速中心</h1>
${error ? `<p class="warn">${error}</p>\n` : ''}<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(next)}">
<p><label>账号 <input name="name" autocomplete="username" required autofocus></label></p>
<p><label>密码 <input name="password" type="password" autocomplete="current-password" required></label></p>
<p><button>登录</button></p>
</form>
<p class="note">不开放注册；账号由所有者在本机开通。</p>`);

// 登录（#5）：除登录页外，所有页面和接口都要先登录。会话令牌放在 HttpOnly Cookie 里。
const COOKIE = 'gc_session';
const cookieOf = (req) => req.headers.cookie?.split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === COOKIE)?.[1];
const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
// 登录后只跳回本站的路径，不跳到别的网站。
const safeNext = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/');
// 表单只接受本站提交的（没有 Origin 或 Origin 是本机地址），挡住别的网站代为提交。
const sameOrigin = (req) => !req.headers.origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin);

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 10_000) reject(new Error('表单太大'));
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

export function startServer({ dataDir, port = 5310 }) {
  const accounts = openAccounts(dataDir);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, headers, body) => res.writeHead(status, headers).end(req.method === 'HEAD' ? undefined : body);
    const text = (status, body) => send(status, { 'content-type': 'text/plain; charset=utf-8' }, body);
    const html = (status, body, headers = {}) => send(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers }, body);

    if (url.pathname === '/login' && (req.method === 'GET' || req.method === 'HEAD')) {
      return accounts.session(cookieOf(req)) ? send(303, { location: '/' }) : html(200, loginPage(safeNext(url.searchParams.get('next'))));
    }
    if (url.pathname === '/login' || url.pathname === '/logout') {
      if (req.method !== 'POST') return send(405, {});
      if (!sameOrigin(req)) return text(403, '只接受本站提交的表单');
      if (url.pathname === '/logout') {
        accounts.logout(cookieOf(req));
        return send(303, { location: '/login', 'set-cookie': sessionCookie('', 0) });
      }
      let form;
      try {
        form = await readForm(req);
      } catch {
        return text(413, '表单太大');
      }
      const token = accounts.login(form.get('name') ?? '', form.get('password') ?? '');
      if (!token) return html(401, loginPage(safeNext(form.get('next')), '账号或密码不对。'));
      return send(303, { location: safeNext(form.get('next')), 'set-cookie': sessionCookie(token, SESSION_DAYS * 86400) });
    }

    const account = accounts.session(cookieOf(req));
    if (!account) {
      if (url.pathname.startsWith('/api/')) return send(401, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ error: '未登录' }));
      return send(303, { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, {});
    const page = route(url, dataDir);
    if (!page) return text(404, '没有这个页面');
    html(200, layout(url.pathname, account, page));
  });
  server.on('close', () => accounts.close());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}
