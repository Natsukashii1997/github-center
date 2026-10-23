// 本机网站：只监听 127.0.0.1；登录后才能看（#5）。页面只读快照和更新记录，访问时不调用任何外部接口。
// 首页是涨星榜（近 1/7/30 天，#13 起按冻结的视觉方案 t1b-r2，见 home.js）；另有新项目榜、官方热门榜、累计高星榜，样式从简，视觉由 #14 负责。
// 点开榜单上的项目进入项目页（#6），项目页能复制安装指令（#7）、收藏项目或单个 Skill，“我的收藏”列出自己的全部收藏（#8）。
// 三个榜单都能按分类筛选，在榜内过滤（#10，?cat=），项目页写明项目的分类。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { openAccounts, ROLES, SESSION_DAYS } from './accounts.js';
import { openFavorites } from './favorites.js';
import { readLatestSnapshot, readStatus, newerFailure, WINDOWS, LISTS, SINCES, TRENDING_PAGES } from '../ranking/index.js';
import { findProfile, readProfile, findOnBoards, currentGenerated, skillPlace, skillPurpose, installInstruction, INSTALL_AIS } from '../profiles/index.js';
import { homeData, homePage } from './home.js';
import { CATEGORIES, readCategories, listInCategory } from '../categories/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
const beijing = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const repo = (name) => `<a href="/p/${esc(name)}">${esc(name)}</a>`;
const PAGES = [['/', '涨星榜'], ['/new', LISTS.new], ['/trending', LISTS.trending], ['/top', LISTS.top], ['/favorites', '我的收藏']];
const SEARCH_NOTE = '已知现象：GitHub 搜索会把少数仓库计进总数，但列表里不返回它们，所以极少数项目可能不在这里。';

// 更新失败时保留上一次的快照，写明它的真实日期和失败原因。
function failure(board, snapshot, status) {
  const last = newerFailure(status, board, snapshot);
  if (!last) return '';
  return `<p class="warn">统计日 ${esc(last.day)} 的榜单更新失败：${esc(last.error)}${snapshot ? `。下面仍是统计日 ${esc(snapshot.statDay)} 的榜单。` : ''}</p>\n`;
}

const table = (heads, rows) => `<table>
<thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>
${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}
</tbody>
</table>`;
const tabs = (items, current) => `<nav>${items.map(([key, href, text]) => (key === current ? `<strong>${text}</strong>` : `<a href="${href}">${text}</a>`)).join('　')}</nav>`;
const empty = (name) => `<p>还没有${name}。先运行一次 <code>npm run rank</code>。</p>`;

// 分类筛选（#10）：一排分类链接，带上本页其他参数；榜内过滤后写明没归类的个数。
function categoryFilter(path, params, cat) {
  const href = (c) => {
    const u = new URLSearchParams(params);
    if (c) u.set('cat', c); else u.delete('cat');
    return esc(`${path}${u.size ? `?${u}` : ''}`);
  };
  return tabs([['', href(null), '全部'], ...CATEGORIES.map((c) => [c, href(c), esc(c)])], cat ?? '');
}
function filtered({ entries, find, cat, byTotal: byStars }) {
  if (!cat) return { entries, notes: '' };
  const r = listInCategory({ entries, find, category: cat, byTotal: byStars });
  const notes = [r.entries.length ? '' : `<p>「${esc(cat)}」在本榜没有项目。</p>`, r.unclassified ? `<p class="note">本榜还有 ${r.unclassified} 个项目没归类，归好后按分类列出。</p>` : ''].join('');
  return { entries: r.entries, notes };
}
const catsOf = (find, e) => esc((find({ id: e.projectId, fullName: e.fullName })?.categories ?? []).join('、'));

function byTotal(list, snapshot, status, { params, cat, find }) {
  const head = categoryFilter(`/${list}`, params, cat);
  if (!snapshot) return { title: LISTS[list], body: `${head}\n${failure(list, null, status)}${empty(LISTS[list])}` };
  const scope = list === 'new' ? `近 30 天内（${esc(snapshot.from)} 至 ${esc(snapshot.statDay)}，UTC）创建的项目，含 fork，按总 Star 排` : '全站项目按总 Star 排';
  const shown = filtered({ entries: snapshot.entries, find, cat, byTotal: true });
  const rows = shown.entries.map((e) => [e.rank, repo(e.fullName), num(e.total), ...(list === 'new' ? [esc(e.createdAt.slice(0, 10))] : []), catsOf(find, e)]);
  return {
    title: LISTS[list],
    body: `${head}
<p>统计日 ${esc(snapshot.statDay)}（UTC）　更新于 ${beijing(snapshot.generatedAt)}（北京时间）</p>
${failure(list, snapshot, status)}${shown.notes}${table(['名次', '项目', '总 Star', ...(list === 'new' ? ['创建日期'] : []), '分类'], rows)}
<p class="note">${scope}；前 20 名，末位并列一起列出。总 Star 来自 GitHub 官方搜索，是更新时的数字。${SEARCH_NOTE}</p>`,
  };
}

function trendingPage(since, snapshot, status, { params, cat, find }) {
  const head = `${tabs(SINCES.map((s) => [s, esc(`/trending?since=${s}${cat ? `&cat=${encodeURIComponent(cat)}` : ''}`), TRENDING_PAGES[s].name]), since)}\n${categoryFilter('/trending', params, cat)}`;
  if (!snapshot) return { title: LISTS.trending, body: `${head}\n${failure('trending', null, status)}${empty(LISTS.trending)}` };
  const page = snapshot.pages[since];
  const shown = filtered({ entries: page.entries.slice(0, 20), find, cat, byTotal: false });
  const rows = shown.entries.map((e) => [e.rank, repo(e.fullName), e.periodStars == null ? '—' : `+${num(e.periodStars)}`, num(e.total), catsOf(find, e)]);
  return {
    title: `${LISTS.trending} · ${TRENDING_PAGES[since].name}`,
    body: `${head}
<p>抓取于 ${beijing(page.fetchedAt ?? snapshot.generatedAt)}（北京时间）</p>
${failure('trending', snapshot, status)}${shown.notes}${table(['名次', '项目', `${TRENDING_PAGES[since].period}新增 Star（GitHub 页面上的数字）`, '总 Star', '分类'], rows)}
<p class="note">GitHub 官方 Trending 的原样排序，全部语言；排序规则由 GitHub 决定，不是纯涨星。官方页面共 ${page.entries.length} 个${page.entries.length > 20 ? '，这里列前 20 个' : ''}。</p>`,
  };
}

// 一键复制安装指令，复制后短暂提示，几秒后提示消失。剪贴板接口不能用时退回到选中文字再复制。
const COPY_SCRIPT = `document.getElementById('copy-install').addEventListener('click', async () => {
  const text = document.getElementById('install-text');
  const status = document.getElementById('copy-status');
  let ok = true;
  try { await navigator.clipboard.writeText(text.value); } catch { text.select(); ok = document.execCommand('copy'); }
  status.textContent = ok ? '已复制，可以粘贴给你的 AI 了' : '没能自动复制，请在上面的框里全选后手动复制';
  clearTimeout(window.copyTimer);
  window.copyTimer = setTimeout(() => { status.textContent = ''; }, 3000);
});`;

// 安装指令（#7）：选交给 Claude Code 还是 Codex、装整个项目还是某个 Skill（不用脚本也能换），指令放在只读文本框里，一键复制。
function installSection(profile, query) {
  const ai = Object.hasOwn(INSTALL_AIS, query.get('ai') ?? '') ? query.get('ai') : 'claude-code';
  const skills = profile.material.skills;
  const skillPath = skills.some((s) => s.path === query.get('skill')) ? query.get('skill') : '';
  const option = (value, text, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(text)}</option>`;
  return `<h2 id="install">安装指令</h2>
<form method="get" action="/p/${esc(profile.fullName)}#install">
<label>交给 <select name="ai">${Object.entries(INSTALL_AIS).map(([k, v]) => option(k, v.name, k === ai)).join('')}</select></label>
<label>安装 <select name="skill">${option('', '整个项目', !skillPath)}${skills.map((s) => option(s.path, `Skill：${s.name}`, s.path === skillPath)).join('')}</select></label>
<button>换成这个</button>
</form>
<textarea id="install-text" rows="18" readonly>${esc(installInstruction({ profile, ai, skillPath }))}</textarea>
<p><button type="button" id="copy-install">复制指令</button> <span id="copy-status" class="note" role="status"></span></p>
<script>${COPY_SCRIPT}</script>`;
}

// 收藏或取消收藏的按钮（#8）：一个小表单，提交后回到 next。skillPath 为空表示整个项目。
const favoriteButton = ({ projectId, skillPath = '', saved, what, next }) => `<form method="post" action="/favorites" class="fav">
<input type="hidden" name="project_id" value="${esc(projectId)}"><input type="hidden" name="skill" value="${esc(skillPath)}">
<input type="hidden" name="action" value="${saved ? 'remove' : 'add'}"><input type="hidden" name="next" value="${esc(next)}">
<button>${saved ? '取消收藏' : '收藏'}${what}</button></form>`;

// 项目页（#6）：简介（干什么、能解决什么问题）、项目文档写到的使用条件、仓库里的 Skill、安装指令（#7）、原项目链接、收藏（#8）。
// 内容都来自存下的项目资料。简介没生成好、或文档更新后还没重新生成好，就写“简介生成中”，不拿猜测或过期的内容顶替。
// projectId 为空（只从官方热门榜知道名字、还没有资料）时不能收藏；saved 是这个人在这个项目上收藏了哪些（整个项目记为 ''）。
function projectPage(fullName, profile, query, { projectId, saved, cats }) {
  const m = profile?.material;
  const g = currentGenerated(profile);
  const here = `/p/${fullName}`;
  const list = (items) => `<ul>\n${items.map(([head, text, note]) => `<li><strong>${esc(head)}</strong>　${esc(text)}<br><span class="note">${esc(note)}</span></li>`).join('\n')}\n</ul>`;
  const parts = [
    `<p><a href="https://github.com/${esc(fullName)}">在 GitHub 打开原项目</a>${projectId ? `　${favoriteButton({ projectId, saved: saved.has(''), what: '这个项目', next: here })}` : ''}</p>`,
    `<p>分类：${cats?.categories.length ? esc(cats.categories.join('、')) : '还没归类'}</p>`,
    '<h2>简介</h2>',
  ];
  if (g) {
    parts.push(`<p>${esc(g.what)}</p>`, `<p>能帮你解决：${esc(g.problem)}</p>`, '<h2>使用条件</h2>');
    parts.push(g.conditions.length ? list(g.conditions.map((c) => [c.kind, c.text, `原文：${c.quote}`])) : '<p>在读到的项目文档里没有找到付费、账号、密钥或特定环境的要求。</p>');
    if (g.droppedConditions) parts.push(`<p class="note">另有 ${g.droppedConditions} 条 AI 整理出的条件在原文里核对不到，没有列出。</p>`);
    if (m.readme?.truncated || m.docs.some((d) => d.truncated)) parts.push('<p class="note">有的文档较长，只读了开头部分，后面写到的条件可能没有列出。</p>');
  } else {
    parts.push('<p>简介生成中。</p>');
  }
  if (m) {
    // 安装指令放在 Skill 列表前面：Skill 多的仓库列表很长。
    parts.push(installSection(profile, query), '<h2>Skill</h2>');
    const skillItem = (s) => `<li id="skill-${esc(s.path)}"><strong>${esc(s.name)}</strong>　${esc(skillPurpose(s, g))}　${favoriteButton({ projectId, skillPath: s.path, saved: saved.has(s.path), what: '这个 Skill', next: `${here}#skill-${s.path}` })}<br><span class="note">${esc(skillPlace(s.path))}</span></li>`;
    parts.push(m.skills.length ? `<ul>\n${m.skills.map(skillItem).join('\n')}\n</ul>` : '<p>仓库里没有按 SKILL.md 约定写的 Skill。</p>');
    if (m.treeTruncated || m.skillsTruncated) parts.push('<p class="note">仓库太大，Skill 列表可能不全。</p>');
    const readme = m.readme ? `<a href="${esc(m.readme.htmlUrl)}">${esc(m.readme.path)}</a>` : '仓库里没有 README';
    const docs = m.docs.length ? `、${m.docs.map((d) => esc(d.path)).join('、')}` : '';
    const made = g ? `；简介和使用条件由 AI 根据项目原文生成于 ${beijing(g.at)}` : '';
    parts.push(`<p class="note">依据：${readme}${docs}、仓库目录和 Skill 文件，读取于 ${beijing(m.fetchedAt)}（北京时间）${made}。</p>`);
  }
  return { title: esc(fullName), body: parts.join('\n') };
}

// 我的收藏（#8）：这个人的全部收藏，新的在前；每条都能直达项目页（Skill 直达项目页上那一条），也能直接取消。
// 名字优先用项目资料里现在的（项目可能改过名），没有资料就用收藏时记下的。项目页打不开、Skill 已从仓库删掉的，写明原因。
function favoritesPage(items, dataDir) {
  if (!items.length) return { title: '我的收藏', body: '<p>还没有收藏。在项目页点“收藏”，就会出现在这里。</p>' };
  const rows = items.map((f) => {
    const profile = readProfile(dataDir, f.projectId);
    const fullName = profile?.fullName ?? f.fullName;
    const name = f.skillPath ? `${esc(fullName)} 里的 Skill：${esc(f.skillName)}` : esc(fullName);
    let item;
    if (!profile && !findOnBoards(dataDir, { id: f.projectId })) item = `${name}（项目资料已不在，站内页面打不开；<a href="https://github.com/${esc(fullName)}">在 GitHub 打开</a>）`;
    else if (f.skillPath) item = `<a href="/p/${esc(fullName)}#skill-${esc(f.skillPath)}">${name}</a>${profile?.material.skills.some((s) => s.path === f.skillPath) ? '' : '（仓库里已经没有这个 Skill）'}`;
    else item = `${repo(fullName)}（整个项目）`;
    return `<li>${item}　${favoriteButton({ projectId: f.projectId, skillPath: f.skillPath, saved: true, what: '', next: '/favorites' })}<br><span class="note">收藏于 ${beijing(f.createdAt)}（北京时间）</span></li>`;
  });
  return { title: '我的收藏', body: `<p>共 ${items.length} 条，只有你自己看得到。</p>\n<ul>\n${rows.join('\n')}\n</ul>` };
}

function route(url, dataDir, { account, favorites }) {
  const project = url.pathname.match(/^\/p\/([\w.-]+\/[\w.-]+)$/);
  if (project) {
    // 只给有资料或正在榜单上的项目出页面。
    const profile = findProfile(dataDir, project[1]);
    const listed = profile ? null : findOnBoards(dataDir, { name: project[1] });
    if (!profile && !listed) return null;
    const projectId = profile?.projectId ?? listed.id;
    const saved = projectId ? favorites.savedIn(account.id, projectId) : new Set();
    const name = profile?.fullName ?? listed.name;
    return projectPage(name, profile, url.searchParams, { projectId, saved, cats: readCategories(dataDir).get({ id: projectId, fullName: name }) });
  }
  if (url.pathname === '/favorites') return favoritesPage(favorites.list(account.id), dataDir);
  const status = readStatus(dataDir);
  const q = (k, d) => url.searchParams.get(k) ?? d;
  const filter = { params: url.searchParams, cat: CATEGORIES.includes(q('cat')) ? q('cat') : null, find: readCategories(dataDir).get };
  switch (url.pathname) {
    case '/new':
    case '/top': {
      const list = url.pathname.slice(1);
      return byTotal(list, readLatestSnapshot(dataDir, list), status, filter);
    }
    case '/trending': {
      const since = q('since', 'daily');
      return SINCES.includes(since) && trendingPage(since, readLatestSnapshot(dataDir, 'trending'), status, filter);
    }
  }
  return null;
}

const STYLE = 'body{font:14px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;margin:40px auto;max-width:880px;padding:0 24px;color:#202a30;background:#faf9f6}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid #dfe4e1;text-align:left}td:nth-child(3),td:nth-child(4),th:nth-child(3),th:nth-child(4){text-align:right;font-variant-numeric:tabular-nums}a{color:#176b75;text-decoration:none}.note{color:#657176;font-size:12px}.warn{color:#8a4b0f}header form,form.fav{display:inline}textarea{width:100%;box-sizing:border-box;font:12px/1.5 ui-monospace,Menlo,monospace}';
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
// 登录后只跳回本站的路径，不跳到别的网站：按浏览器的规则解析（会去掉 Tab 和换行、把反斜杠当斜杠）后仍是本站才跳，
// 并且只用解析出的已编码路径和锚点（收藏 Skill 后回到页上那一条），跳转地址里不会有汉字或控制字符。
function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/')) return '/';
  try {
    const url = new URL(next, 'http://127.0.0.1');
    return url.origin === 'http://127.0.0.1' ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}
// 表单只接受本站这个端口提交的（没有 Origin，或 Origin 正是本站），挡住别的网站，也挡住本机别的端口上的网页代为提交：
// 会话 Cookie 不分端口，本机其他端口的网页发来的请求浏览器也会带上它（#5 审查记下、#8 收紧）。
function sameOrigin(req) {
  const { origin } = req.headers;
  const port = req.socket.localPort;
  return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

// 收藏或取消收藏（#8）：只动自己的收藏。收藏 Skill 时它必须在存下的项目资料里；收藏整个项目时有资料或正在榜单上就行；
// 取消不用查，资料没了也能取消。成功返回 null，否则返回拒绝的 { status, error }。
function changeFavorite(dataDir, favorites, account, form) {
  const projectId = Number(form.get('project_id'));
  const skillPath = form.get('skill') ?? '';
  if (form.get('action') === 'remove') {
    favorites.remove(account.id, projectId, skillPath);
    return null;
  }
  if (form.get('action') !== 'add') return { status: 400, error: '不认识的操作' };
  const known = Number.isSafeInteger(projectId) && projectId > 0;
  const profile = known ? readProfile(dataDir, projectId) : null;
  const listed = known && !profile && !skillPath ? findOnBoards(dataDir, { id: projectId }) : null;
  const skill = skillPath && profile?.material?.skills.find((s) => s.path === skillPath);
  if (skillPath ? !skill : !profile && !listed) return { status: 404, error: '没有这个项目或 Skill 的资料' };
  favorites.add(account.id, { projectId, fullName: profile?.fullName ?? listed.name, skillPath, skillName: skill?.name ?? '' });
  return null;
}

// 首页的样式、图标和脚本（#13）：视觉方案里的通用文件。
const ASSETS = { 'tokens.css': 'text/css', 'components.css': 'text/css', 'icons.js': 'text/javascript', 'gc.js': 'text/javascript', 'home.js': 'text/javascript' };
const assetFile = (name) => readFileSync(new URL(`./assets/${name}`, import.meta.url));

// 表单按字节限 10KB；超了就不再收，回复后断开连接。
function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const onData = (c) => {
      size += c.length;
      if (size <= 10_000) return chunks.push(c);
      req.off('data', onData).pause();
      reject(new Error('表单太大'));
    };
    req.on('data', onData);
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

export function startServer({ dataDir, port = 5310 }) {
  const accounts = openAccounts(dataDir);
  const favorites = openFavorites(dataDir);
  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, headers, body) => res.writeHead(status, headers).end(req.method === 'HEAD' ? undefined : body);
    const text = (status, body) => send(status, { 'content-type': 'text/plain; charset=utf-8' }, body);
    const html = (status, body, headers = {}) => send(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers }, body);
    const json = (status, data, headers = {}) => send(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }, JSON.stringify(data));
    const tooBig = () => send(413, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }, '表单太大');


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
      const form = await readForm(req).catch(() => null);
      if (!form) return tooBig();
      const token = accounts.login(form.get('name') ?? '', form.get('password') ?? '');
      if (!token) return html(401, loginPage(safeNext(form.get('next')), '账号或密码不对。'));
      return send(303, { location: safeNext(form.get('next')), 'set-cookie': sessionCookie(token, SESSION_DAYS * 86400) });
    }

    const account = accounts.session(cookieOf(req));
    if (!account) {
      if (url.pathname.startsWith('/api/')) return json(401, { error: '未登录' });
      return send(303, { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` });
    }
    // 收藏：项目页和我的收藏用表单，提交后回到 next；首页的收藏按钮（#13）用接口，结果和拒绝原因都回 JSON。
    if ((url.pathname === '/favorites' || url.pathname === '/api/favorites') && req.method === 'POST') {
      const api = url.pathname === '/api/favorites';
      const refuse = ({ status, error }) => (api ? json(status, { error }) : text(status, error));
      if (!sameOrigin(req)) return refuse({ status: 403, error: '只接受本站提交的表单' });
      const form = await readForm(req).catch(() => null);
      if (!form) return api ? json(413, { error: '表单太大' }, { connection: 'close' }) : tooBig();
      const refused = changeFavorite(dataDir, favorites, account, form);
      if (refused) return refuse(refused);
      return api ? json(200, { saved: form.get('action') === 'add' }) : send(303, { location: safeNext(form.get('next') ?? '/favorites') });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, {});
    const asset = url.pathname.match(/^\/assets\/([\w.-]+)$/)?.[1];
    if (asset && Object.hasOwn(ASSETS, asset)) return send(200, { 'content-type': `${ASSETS[asset]}; charset=utf-8`, 'cache-control': 'no-cache' }, assetFile(asset));
    // 首页涨星榜（#13）：整页按视觉方案出，不套下面的从简布局。
    if (url.pathname === '/') {
      const w = url.searchParams.get('w');
      if (w !== null && !Object.hasOwn(WINDOWS, w)) return text(404, '没有这个页面');
      return html(200, homePage(homeData(dataDir, { account, favorites })));
    }
    // 安装指令（#7）的文字：首页阅读卡上“复制安装指令”取它（#13）。
    if (url.pathname === '/api/install') {
      const profile = readProfile(dataDir, Number(url.searchParams.get('project')));
      const ai = url.searchParams.get('ai') ?? '';
      const skillPath = url.searchParams.get('skill') ?? '';
      if (!profile?.material || !Object.hasOwn(INSTALL_AIS, ai) || (skillPath && !profile.material.skills.some((s) => s.path === skillPath))) return json(404, { error: '没有这个项目或 Skill 的资料' });
      return text(200, installInstruction({ profile, ai, skillPath }));
    }
    const page = route(url, dataDir, { account, favorites });
    if (!page) return text(404, '没有这个页面');
    html(200, layout(url.pathname, account, page));
  };
  // 单个请求出错只回 500，不让整个服务退出。
  const server = createServer((req, res) => handle(req, res).catch((e) => {
    console.error(`${new Date().toISOString()} ${req.method} ${JSON.stringify(req.url)} 出错：`, e);
    if (res.headersSent) return res.destroy();
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }).end('服务出错，请稍后再试');
  }));
  server.on('close', () => {
    favorites.close();
    accounts.close();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}
