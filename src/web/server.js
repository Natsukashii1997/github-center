// 本机网站：只监听 127.0.0.1；登录后才能看（#5）。页面只读快照和更新记录，访问时不调用任何外部接口。
// 首页是涨星榜（近 1/7/30 天，#13 起按冻结的视觉方案 t1b-r2，见 home.js）；其他榜单（新项目榜、官方热门榜、累计高星榜并排）、项目页、
// 日报、我的收藏、登录自 #14 起按冻结的视觉方案 t1b-pages-r1（见 pages.js）。点开榜单上的项目进入项目页（#6），项目页能复制安装指令（#7）、
// 收藏项目或单个 Skill，“我的收藏”列出自己的全部收藏（#8）。三个榜单都能按分类筛选，在榜内过滤（#10），项目页写明分类。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { openAccounts, SESSION_DAYS } from './accounts.js';
import { openFavorites } from './favorites.js';
import { WINDOWS, SINCES } from '../ranking/index.js';
import { readProfile, findOnBoards, installInstruction, INSTALL_AIS } from '../profiles/index.js';
import { homeData, homePage } from './home.js';
import { boardsData, boardsPage, projectData, projectMissing, projectPage, dailyData, dailyPage, favoritesData, favoritesPage, loginPage } from './pages.js';

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

// 样式、图标和脚本：视觉方案里的通用文件（#13 首页，#14 其余页面）。
const ASSETS = { 'tokens.css': 'text/css', 'components.css': 'text/css', 'pages.css': 'text/css', 'icons.js': 'text/javascript', 'gc.js': 'text/javascript', 'home.js': 'text/javascript', 'pages.js': 'text/javascript', 'boards.js': 'text/javascript', 'project.js': 'text/javascript', 'daily.js': 'text/javascript', 'favorites.js': 'text/javascript', 'login.js': 'text/javascript' };
const assetFile = (name) => readFileSync(new URL(`./assets/${name}`, import.meta.url));
// 登录页（#14）要用的样式和脚本：不登录也能取（只是设计变量、图标和组件代码，不含任何数据）；其余页面脚本登录后才给。
const LOGIN_ASSETS = new Set(['tokens.css', 'components.css', 'pages.css', 'icons.js', 'gc.js', 'pages.js', 'login.js']);

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


    const asset = url.pathname.match(/^\/assets\/([\w.-]+)$/)?.[1];
    const sendAsset = () => send(200, { 'content-type': `${ASSETS[asset]}; charset=utf-8`, 'cache-control': 'no-cache' }, assetFile(asset));
    if (LOGIN_ASSETS.has(asset) && (req.method === 'GET' || req.method === 'HEAD')) return sendAsset();
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
      if (!token) return html(401, loginPage(safeNext(form.get('next')), '用户名或密码不对，请再试一次。', (form.get('name') ?? '').slice(0, 64)));
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
    if (asset && Object.hasOwn(ASSETS, asset)) return sendAsset();
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
    const ctx = { account, favorites };
    // 其他榜单（#14 起三个榜并排一页）：旧地址 /new、/top、/trending 跳到 /boards，带上分类与周期。
    if (['/new', '/top', '/trending'].includes(url.pathname) || url.pathname === '/boards') {
      const since = url.searchParams.get('since');
      if (since !== null && !SINCES.includes(since)) return text(404, '没有这个页面');
      if (url.pathname !== '/boards') {
        const u = new URLSearchParams();
        if (url.searchParams.get('cat')) u.set('cat', url.searchParams.get('cat'));
        if (url.pathname === '/trending' && since) u.set('since', since);
        return send(303, { location: `/boards${u.size ? `?${u}` : ''}` });
      }
      return html(200, boardsPage(boardsData(dataDir, ctx)));
    }
    if (url.pathname === '/daily') return html(200, dailyPage(dailyData(dataDir, ctx)));
    if (url.pathname === '/favorites') return html(200, favoritesPage(favoritesData(dataDir, ctx)));
    const project = url.pathname.match(/^\/p\/([\w.-]+\/[\w.-]+)$/);
    if (project) {
      // 只给有资料或正在榜单上的项目出页面；别的回 404，页面照方案写“找不到这个项目”。
      const data = projectData(dataDir, project[1], ctx);
      return data ? html(200, projectPage(data)) : html(404, projectPage(projectMissing(dataDir, project[1], ctx)));
    }
    text(404, '没有这个页面');
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
