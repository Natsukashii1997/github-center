// 本机网站：默认只监听 127.0.0.1，登录后才能看（#5）；所有者 2026-10-26 要分享给同一 Wi-Fi 的人看，可改监听地址、免登录共用一个账号（见 startServer）。页面只读快照和更新记录，访问时不调用任何外部接口。
// 2026-11-03 起（#21）按白雾定稿重做：导航只有涨星榜（首页，近 1/7/30 天，见 home.js）／分类榜（/categories，#27，见 categories.js）／我的收藏。点首页上的项目从右侧滑出
// 详情栏，项目页 /p/作者/仓库名 是同一份内容（#6）：能复制安装指令（#7）、收藏项目或单个 Skill，“我的收藏”列出自己的全部收藏（#8）。
// 日报页、其他榜单页删除，旧地址 /daily、/new、/top、/trending、/boards 跳首页。
// 2026-11-03 加设置页 /settings（见 settings.js），只有所有者能改。
// 2026-11-04 起导航改为 发现（首页 /，原分类榜）／涨星（/stars，原首页涨星榜）／收藏／设置。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { openAccounts, SESSION_DAYS } from './accounts.js';
import { openFavorites, decisionOf, STATUSES, HANDOFF_TYPES, TEXT_MAX } from './favorites.js';
import { WINDOWS } from '../ranking/index.js';
import { readProfile, installInstruction, INSTALL_AIS, handoffText, compareText, searchText, HANDOFF_KINDS, COMPARE_MIN, COMPARE_MAX } from '../profiles/index.js';
import { homeData, homePage } from './home.js';
import { projectData, projectMissing, projectPage, favoritesData, favoritesPage, loginPage } from './pages.js';
import { categoriesData, categoriesPage, picksApi } from './categories.js';
import { findOnBoards, onCategoryBoard, onCategoriesPage } from '../listed.js';
import { openPicks, PicksError } from '../boards/index.js';
import { settingsData, settingsPage, changeSettings, SettingsError } from './settings.js';

// 登录（#5）：除登录页外，所有页面和接口都要先登录。会话令牌放在 HttpOnly Cookie 里。
const COOKIE = 'gc_session';
const cookieOf = (req) => req.headers.cookie?.split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === COOKIE)?.[1];
// 对外地址是 https 时（放到服务器上、经反向代理用域名打开，#46）Cookie 加 Secure，只走加密连接。
const sessionCookie = (token, maxAge, secure) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
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
// 对局域网开放时，别人用本机 IP 打开，Origin 是那个地址，和请求里的 Host 一致才算本站。
// 放到服务器上经反向代理用域名打开时（#46），Origin 是对外地址 publicOrigin（如 https://tidings.natsukashii.cn），也算本站。
function sameOrigin(req, lan, publicOrigin) {
  const { origin } = req.headers;
  const port = req.socket.localPort;
  return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}` || (lan && origin === `http://${req.headers.host}`) || (publicOrigin && origin === publicOrigin);
}

// 收藏或取消收藏（#8）：只动自己的收藏。收藏 Skill 时它必须在存下的项目资料里；收藏整个项目时有资料或正在榜单上
// （含分类榜，#10）就行；取消不用查，资料没了也能取消。
// 改决策状态、理由、下一步（update）和记最近交接（handoff）见 #78，只能动自己已收藏的那一条。
// 成功返回 { ok: 接口要回的 JSON }，否则返回拒绝的 { status, error }。
function changeFavorite(dataDir, favorites, picks, account, form) {
  const projectId = Number(form.get('project_id'));
  const skillPath = form.get('skill') ?? '';
  const action = form.get('action');
  if (action === 'remove') {
    favorites.remove(account.id, projectId, skillPath);
    return { ok: { saved: false } };
  }
  if (action === 'update') {
    const field = (name) => (form.has(name) ? form.get(name).trim() : undefined);
    const change = { status: field('status'), reason: field('reason'), next: field('next_step') };
    if (change.status !== undefined && !STATUSES.includes(change.status)) return { status: 400, error: '不认识的决策状态' };
    if ((change.reason ?? '').length > TEXT_MAX) return { status: 400, error: `理由最多 ${TEXT_MAX} 字` };
    if ((change.next ?? '').length > TEXT_MAX) return { status: 400, error: `下一步最多 ${TEXT_MAX} 字` };
    const saved = favorites.update(account.id, projectId, skillPath, change);
    return saved ? { ok: decisionOf(saved) } : { status: 404, error: '还没收藏这一条' };
  }
  if (action === 'handoff') {
    const type = form.get('type');
    if (!HANDOFF_TYPES.includes(type)) return { status: 400, error: '不认识的交接类型' };
    return { ok: { recorded: favorites.handoff(account.id, projectId, skillPath, type) } };
  }
  if (action !== 'add') return { status: 400, error: '不认识的操作' };
  const known = Number.isSafeInteger(projectId) && projectId > 0;
  const profile = known ? readProfile(dataDir, projectId) : null;
  const listed = known && !profile && !skillPath ? findOnBoards(dataDir, { id: projectId }) ?? onCategoryBoard(dataDir, projectId) ?? onCategoriesPage(dataDir, picks, projectId) : null;
  const skill = skillPath && profile?.material?.skills.find((s) => s.path === skillPath);
  if (skillPath ? !skill : !profile && !listed) return { status: 404, error: '没有这个项目或 Skill 的资料' };
  favorites.add(account.id, { projectId, fullName: profile?.fullName ?? listed.name, skillPath, skillName: skill?.name ?? '' });
  return { ok: { saved: true } };
}

// 交接（#79）的文字：kind 是研究／试用／安装（带 project、skill、ai、need），对比（带 2–4 个 item = "项目 id:Skill 路径"、need），
// 找（带 question，"交给 AI 去 GitHub 找"）。成功返回 { text }，否则返回拒绝的 { status, error }。
function handoffApi(dataDir, form) {
  const kind = form.get('kind') ?? '', need = (form.get('need') ?? '').trim();
  if (need.length > TEXT_MAX) return { status: 400, error: `需求最多 ${TEXT_MAX} 字` };
  // 一个交接对象：项目要有资料，Skill 要在资料里。
  const target = (id, skillPath) => {
    const profile = readProfile(dataDir, id);
    return profile?.material && (!skillPath || profile.material.skills.some((s) => s.path === skillPath)) ? { profile, skillPath } : null;
  };
  if (kind === '找') {
    const question = (form.get('question') ?? '').trim();
    if (!question) return { status: 400, error: '先写要找什么' };
    if (question.length > TEXT_MAX) return { status: 400, error: `问题最多 ${TEXT_MAX} 字` };
    return { text: searchText({ question }) };
  }
  if (kind === '对比') {
    const items = form.getAll('item').map((v) => { const i = v.indexOf(':'); return i < 0 ? target(Number(v), '') : target(Number(v.slice(0, i)), v.slice(i + 1)); });
    if (items.length < COMPARE_MIN || items.length > COMPARE_MAX) return { status: 400, error: `对比要选 ${COMPARE_MIN}–${COMPARE_MAX} 个` };
    if (items.some((x) => !x)) return { status: 404, error: '有的候选没有资料，生成不了交接' };
    return { text: compareText({ items, need }) };
  }
  if (!HANDOFF_KINDS.includes(kind)) return { status: 400, error: '不认识的交接类型' };
  const ai = form.get('ai') ?? '';
  if (!Object.hasOwn(INSTALL_AIS, ai)) return { status: 400, error: '不认识交给谁' };
  const t = target(Number(form.get('project')), form.get('skill') ?? '');
  if (!t) return { status: 404, error: '没有这个项目或 Skill 的资料' };
  return { text: handoffText({ kind, ai, need, ...t }) };
}

// 样式、图标和脚本：白雾外壳（shell、背景鲨鱼 sharks.js，MIT，见 sharks-LICENSE.txt）、首页、项目页、我的收藏和分类榜（bw，收藏页另有 favorites，分类榜另有 categories），登录页沿用 #14 的那套（#116 起收成 login.css、login.js）。
const ASSETS = { 'shell.css': 'text/css', 'bw.css': 'text/css', 'favorites.css': 'text/css', 'categories.css': 'text/css', 'categories.js': 'text/javascript', 'login.css': 'text/css', 'sharks.js': 'text/javascript', 'shell.js': 'text/javascript', 'bw.js': 'text/javascript', 'ho.js': 'text/javascript', 'home.js': 'text/javascript', 'project.js': 'text/javascript', 'favorites.js': 'text/javascript', 'login.js': 'text/javascript', 'settings.css': 'text/css', 'settings.js': 'text/javascript' };
const assetFile = (name) => readFileSync(new URL(`./assets/${name}`, import.meta.url));
// 登录页（#14）要用的样式和脚本：不登录也能取（只是样式、两个图标和表单脚本，不含任何数据）；其余页面脚本登录后才给。
const LOGIN_ASSETS = new Set(['login.css', 'login.js']);

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

// host：监听地址，默认只本机；'0.0.0.0' 让同一 Wi-Fi 的人能打开。guest：免登录，所有人都当作这个已有账号（共用收藏），登录页直接回首页。
// lookupRepo：所有者换卡时联网查 GitHub 用（repo-lookup.js），不给就不能联网查。
// origin：对外地址（#46），经反向代理用域名打开时填，如 'https://tidings.natsukashii.cn'；从这个地址提交的表单算本站，https 时 Cookie 加 Secure。
export function startServer({ dataDir, port = 5310, host = '127.0.0.1', guest, lookupRepo, origin }) {
  const publicOrigin = origin ? new URL(origin).origin : null;
  const secure = publicOrigin?.startsWith('https:') ?? false;
  const accounts = openAccounts(dataDir);
  const guestAccount = guest ? accounts.find(guest) : null;
  if (guest && !guestAccount) {
    accounts.close();
    throw new Error(`没有账号 ${guest}，先运行 npm run account -- add ${guest} --partner`);
  }
  const lan = host !== '127.0.0.1';
  const favorites = openFavorites(dataDir);
  const picks = openPicks(dataDir);
  const fetched = new Map();
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
      return guestAccount || accounts.session(cookieOf(req)) ? send(303, { location: '/' }) : html(200, loginPage(safeNext(url.searchParams.get('next'))));
    }
    if (url.pathname === '/login' || url.pathname === '/logout') {
      if (req.method !== 'POST') return send(405, {});
      if (!sameOrigin(req, lan, publicOrigin)) return text(403, '只接受本站提交的表单');
      if (url.pathname === '/logout') {
        accounts.logout(cookieOf(req));
        return send(303, { location: '/login', 'set-cookie': sessionCookie('', 0, secure) });
      }
      const form = await readForm(req).catch(() => null);
      if (!form) return tooBig();
      const token = accounts.login(form.get('name') ?? '', form.get('password') ?? '');
      if (!token) return html(401, loginPage(safeNext(form.get('next')), '用户名或密码不对，请再试一次。', (form.get('name') ?? '').slice(0, 64)));
      return send(303, { location: safeNext(form.get('next')), 'set-cookie': sessionCookie(token, SESSION_DAYS * 86400, secure) });
    }

    const account = guestAccount ?? accounts.session(cookieOf(req));
    if (!account) {
      if (url.pathname.startsWith('/api/')) return json(401, { error: '未登录' });
      return send(303, { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` });
    }
    // 收藏：表单提交后回到 next；页面上的收藏按钮用接口，结果和拒绝原因都回 JSON。
    if ((url.pathname === '/favorites' || url.pathname === '/api/favorites') && req.method === 'POST') {
      const api = url.pathname === '/api/favorites';
      const refuse = ({ status, error }) => (api ? json(status, { error }) : text(status, error));
      if (!sameOrigin(req, lan, publicOrigin)) return refuse({ status: 403, error: '只接受本站提交的表单' });
      const form = await readForm(req).catch(() => null);
      if (!form) return api ? json(413, { error: '表单太大' }, { connection: 'close' }) : tooBig();
      const done = changeFavorite(dataDir, favorites, picks, account, form);
      if (!done.ok) return refuse(done);
      return api ? json(200, done.ok) : send(303, { location: safeNext(form.get('next') ?? '/favorites') });
    }
    // 精选榜（#27）：投票、换卡、恢复、换卡候选、联网查仓库、改标签清单。只收 POST、只接受本站提交；谁能改由 boards/picks.js 判断，拒绝时回它给的状态码和原因。
    const pickOp = url.pathname.match(/^\/api\/picks\/([a-z]+)$/)?.[1];
    if (pickOp) {
      if (req.method !== 'POST') return json(405, { error: '只接受 POST' });
      if (!sameOrigin(req, lan, publicOrigin)) return json(403, { error: '只接受本站提交的表单' });
      const form = await readForm(req).catch(() => null);
      if (!form) return json(413, { error: '表单太大' }, { connection: 'close' });
      try {
        return json(200, await picksApi(dataDir, { account, favorites, lookupRepo, fetched }, picks, pickOp, form));
      } catch (e) {
        if (e instanceof PicksError) return json(e.status, { error: e.message });
        throw e;
      }
    }
    // 设置页：改一项存一次。只有所有者能改、只接受本站提交；不合规整份不存，回原因。
    if (url.pathname === '/api/settings') {
      if (req.method !== 'POST') return json(405, { error: '只接受 POST' });
      if (!sameOrigin(req, lan, publicOrigin)) return json(403, { error: '只接受本站提交的表单' });
      if (account.role !== 'owner') return json(403, { error: '只有所有者能改设置' });
      const form = await readForm(req).catch(() => null);
      if (!form) return json(413, { error: '表单太大' }, { connection: 'close' });
      try {
        return json(200, { settings: changeSettings(dataDir, form) });
      } catch (e) {
        if (e instanceof SettingsError) return json(400, { error: e.message });
        throw e;
      }
    }
    // 交接文字（#79）：只收 POST、只接受本站提交（"我的需求"不放进链接）。
    if (url.pathname === '/api/handoff') {
      if (req.method !== 'POST') return json(405, { error: '只接受 POST' });
      if (!sameOrigin(req, lan, publicOrigin)) return json(403, { error: '只接受本站提交的表单' });
      const form = await readForm(req).catch(() => null);
      if (!form) return json(413, { error: '表单太大' }, { connection: 'close' });
      const done = handoffApi(dataDir, form);
      return done.text != null ? text(200, done.text) : json(done.status, { error: done.error });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, {});
    if (asset && Object.hasOwn(ASSETS, asset)) return sendAsset();
    const ctx = { account, favorites, guest: Boolean(guestAccount) };
    // 首页是发现（原分类榜，2026-11-04 起）；以前首页上的涨星榜链接（带 ?w= 或 ?sel=）跳到 /stars，原分类榜地址跳首页。
    if (url.pathname === '/') {
      if (url.searchParams.has('w') || url.searchParams.has('sel')) return send(303, { location: `/stars${url.search}` });
      return html(200, categoriesPage(categoriesData(dataDir, ctx, picks), ctx));
    }
    if (url.pathname === '/categories') return send(303, { location: '/' });
    // 涨星；?w= 只认三个窗口。
    if (url.pathname === '/stars') {
      const w = url.searchParams.get('w');
      if (w !== null && !Object.hasOwn(WINDOWS, w)) return text(404, '没有这个页面');
      return html(200, homePage(homeData(dataDir, ctx), ctx));
    }
    // 安装指令（#7）的文字：详情栏和项目页上“复制安装指令”取它。
    if (url.pathname === '/api/install') {
      const profile = readProfile(dataDir, Number(url.searchParams.get('project')));
      const ai = url.searchParams.get('ai') ?? '';
      const skillPath = url.searchParams.get('skill') ?? '';
      if (!profile?.material || !Object.hasOwn(INSTALL_AIS, ai) || (skillPath && !profile.material.skills.some((s) => s.path === skillPath))) return json(404, { error: '没有这个项目或 Skill 的资料' });
      return text(200, installInstruction({ profile, ai, skillPath }));
    }
    // 删掉的日报页、其他榜单页：旧链接跳涨星，不出错。
    if (['/daily', '/new', '/top', '/trending', '/boards'].includes(url.pathname)) return send(303, { location: '/stars' });
    if (url.pathname === '/favorites') return html(200, favoritesPage(favoritesData(dataDir, ctx), ctx));
    if (url.pathname === '/settings') return html(200, settingsPage(settingsData(dataDir, ctx), ctx));
    const project = url.pathname.match(/^\/p\/([\w.-]+\/[\w.-]+)$/);
    if (project) {
      // 只给有资料或正在榜单上的项目出页面；别的回 404，页面照方案写“找不到这个项目”。
      const data = projectData(dataDir, project[1], ctx);
      const from = url.searchParams.get('from');
      return data ? html(200, projectPage(data, ctx, from)) : html(404, projectPage(projectMissing(project[1], ctx), ctx, from));
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
    picks.close();
    favorites.close();
    accounts.close();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}
