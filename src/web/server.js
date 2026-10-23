// 本机网站：只监听 127.0.0.1；登录后才能看（#5）。页面只读快照和更新记录，访问时不调用任何外部接口。样式从简，视觉由 #13、#14 负责。
// 首页是涨星榜（近 1/7/30 天），另有新项目榜、官方热门榜、累计高星榜；点开榜单上的项目进入项目页（#6），项目页能复制安装指令（#7）。
import { createServer } from 'node:http';
import { openAccounts, ROLES, SESSION_DAYS } from './accounts.js';
import { readLatestSnapshot, readStatus, WINDOWS, LISTS, SINCES, TRENDING_PAGES } from '../ranking/index.js';
import { findProfile, isOnBoards, currentGenerated, skillPlace, skillPurpose, installInstruction, INSTALL_AIS } from '../profiles/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
const beijing = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const label = (w) => `近 ${WINDOWS[w].days} 天`;
const repo = (name) => `<a href="/p/${esc(name)}">${esc(name)}</a>`;
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

// 项目页（#6）：简介（干什么、能解决什么问题）、项目文档写到的使用条件、仓库里的 Skill、安装指令（#7）、原项目链接。
// 内容都来自存下的项目资料。简介没生成好、或文档更新后还没重新生成好，就写“简介生成中”，不拿猜测或过期的内容顶替。
function projectPage(fullName, profile, query) {
  const m = profile?.material;
  const g = currentGenerated(profile);
  const list = (items) => `<ul>\n${items.map(([head, text, note]) => `<li><strong>${esc(head)}</strong>　${esc(text)}<br><span class="note">${esc(note)}</span></li>`).join('\n')}\n</ul>`;
  const parts = [`<p><a href="https://github.com/${esc(fullName)}">在 GitHub 打开原项目</a></p>`, '<h2>简介</h2>'];
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
    parts.push(m.skills.length ? list(m.skills.map((s) => [s.name, skillPurpose(s, g), skillPlace(s.path)])) : '<p>仓库里没有按 SKILL.md 约定写的 Skill。</p>');
    if (m.treeTruncated || m.skillsTruncated) parts.push('<p class="note">仓库太大，Skill 列表可能不全。</p>');
    const readme = m.readme ? `<a href="${esc(m.readme.htmlUrl)}">${esc(m.readme.path)}</a>` : '仓库里没有 README';
    const docs = m.docs.length ? `、${m.docs.map((d) => esc(d.path)).join('、')}` : '';
    const made = g ? `；简介和使用条件由 AI 根据项目原文生成于 ${beijing(g.at)}` : '';
    parts.push(`<p class="note">依据：${readme}${docs}、仓库目录和 Skill 文件，读取于 ${beijing(m.fetchedAt)}（北京时间）${made}。</p>`);
  }
  return { title: esc(fullName), body: parts.join('\n') };
}

function route(url, dataDir) {
  const project = url.pathname.match(/^\/p\/([\w.-]+\/[\w.-]+)$/);
  if (project) {
    // 只给有资料或正在榜单上的项目出页面。
    const profile = findProfile(dataDir, project[1]);
    return (profile || isOnBoards(dataDir, project[1])) && projectPage(profile?.fullName ?? project[1], profile, url.searchParams);
  }
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

const STYLE = 'body{font:14px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;margin:40px auto;max-width:880px;padding:0 24px;color:#202a30;background:#faf9f6}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid #dfe4e1;text-align:left}td:nth-child(3),td:nth-child(4),th:nth-child(3),th:nth-child(4){text-align:right;font-variant-numeric:tabular-nums}a{color:#176b75;text-decoration:none}.note{color:#657176;font-size:12px}.warn{color:#8a4b0f}header form{display:inline}textarea{width:100%;box-sizing:border-box;font:12px/1.5 ui-monospace,Menlo,monospace}';
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
// 并且只用解析出的已编码路径，跳转地址里不会有汉字或控制字符。
function safeNext(next) {
  if (typeof next !== 'string' || !next.startsWith('/')) return '/';
  try {
    const url = new URL(next, 'http://127.0.0.1');
    return url.origin === 'http://127.0.0.1' ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
}
// 表单只接受本站提交的（没有 Origin 或 Origin 是本机地址），挡住别的网站代为提交。
const sameOrigin = (req) => !req.headers.origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin);

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
  const handle = async (req, res) => {
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
        return send(413, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }, '表单太大');
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
  };
  // 单个请求出错只回 500，不让整个服务退出。
  const server = createServer((req, res) => handle(req, res).catch((e) => {
    console.error(`${new Date().toISOString()} ${req.method} ${JSON.stringify(req.url)} 出错：`, e);
    if (res.headersSent) return res.destroy();
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }).end('服务出错，请稍后再试');
  }));
  server.on('close', () => accounts.close());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}
