// 项目页、我的收藏、登录（#14 起）。服务端把页面要的快照、项目资料和这个人的收藏整理成一份数据嵌进页面，页面脚本画出来。
// 2026-11-03 起（#21）项目页和首页右侧详情栏共用同一份内容（assets/bw.js），套白雾外壳；我的收藏按定稿改成收藏架（#22），点项目在本页打开同一份详情栏；登录页不变。
// 日报页、其他榜单页已删（旧地址跳首页，见 server.js）。名次、新增和总 Star 只取快照；项目页的数字和走势取这一期榜单那次运行存下的官方原始响应（同首页）。
import { readLatestSnapshot, readStatus, newerFailure, WINDOWS, SINCES } from '../ranking/index.js';
import { readCategories } from '../categories/index.js';
import { readProfile, findProfile, currentGenerated, shownGenerated, skillPurpose, INSTALL_AIS } from '../profiles/index.js';
import { boardProjects } from '../profiles/store.js';
import { windowStatus, categoryListed } from './home.js';
import { project as projectCard, aiBy, categoryOnly, conditionsOf, shortOf, maintOf } from './project-card.js';
import { embed, esc, frame, MARK, WORDMARK, FAVICON } from './frame.js';
import { rankHistory } from '../ranking/moves.js';
import { decisionOf, decisionsOf } from './favorites.js';

const labels = () => Object.fromEntries(Object.entries(WINDOWS).map(([id, { days }]) => [id, { label: `近 ${days} 天` }]));
// 每页都带的：账号、安装目标、窗口名。
export const base = (ctx) => ({ account: { name: ctx.account.name }, ais: Object.entries(INSTALL_AIS).map(([id, ai]) => [id, ai.name]), windows: labels(), decisions: ctx.favorites ? decisionsOf(ctx.favorites, ctx.account.id) : {} });

// 各榜最新快照里每个项目的总 Star（更新时的数字）：按项目 id 和名字都能查；收藏页和不在涨星榜上的项目页用。
function listTotals(dataDir) {
  const byId = new Map(), byName = new Map();
  const note = (e) => {
    if (e.total == null) return;
    if (e.projectId && !byId.has(e.projectId)) byId.set(e.projectId, e.total);
    if (!byName.has(e.fullName.toLowerCase())) byName.set(e.fullName.toLowerCase(), e.total);
  };
  for (const b of Object.keys(WINDOWS)) readLatestSnapshot(dataDir, b)?.entries.forEach(note);
  // 全站 Star 前 100（boards/history.js）。2026-11-22 前查的是累计高星榜（和它同一条搜索）和新项目榜，#110 起这两个榜不再生成。
  readLatestSnapshot(dataDir, 'history')?.entries.forEach((e) => note({ projectId: e.id, fullName: e.repo, total: e.total }));
  const trending = readLatestSnapshot(dataDir, 'trending');
  for (const s of SINCES) trending?.pages[s]?.entries.forEach(note);
  return { of: (id, name) => (id && byId.get(id)) ?? byName.get(name.toLowerCase()) ?? null };
}

// 一个项目在紧凑行、网格卡上要的资料：简介、分类、Skill、收藏状态。数字由各页按快照另给；头像没有 owner id 时页面按用户名取。
function brief(dataDir, { id, fullName }, ctx, find, profile = id ? readProfile(dataDir, id) : null) {
  const g = shownGenerated(profile);
  const saved = id ? ctx.favorites.savedIn(ctx.account.id, id) : new Set();
  return {
    repo: profile?.fullName ?? fullName, id, ownerId: null, runs: {}, lang: null, created: null,
    what: g?.what ?? null, problem: g?.problem ?? null, ghDesc: g ? null : profile?.description ?? null, ...shortOf(g),
    cats: find({ id, fullName })?.categories ?? [], aiBy: aiBy(g, find({ id, fullName })), maint: maintOf(profile), installable: Boolean(profile?.material),
    skills: (profile?.material?.skills ?? []).map((s) => ({ name: s.name, path: s.path, desc: skillPurpose(s, g) })),
    saved: saved.has(''), savedSkills: [...saved].filter(Boolean),
  };
}

// ── 项目页：只给有资料或正在榜单上的项目；找不到返回 null（404） ──
export function projectData(dataDir, fullName, ctx) {
  const profile = findProfile(dataDir, fullName);
  const listed = profile ? null : boardProjects(dataDir).find((p) => p.name.toLowerCase() === fullName.toLowerCase());
  // 只上了分类榜的项目（#10，不生成项目资料）：数字和描述取它所在分类榜的候选。
  const onCategory = listed ? null : categoryListed(dataDir).get(fullName.toLowerCase()) ?? null;
  if (!profile && !listed && !onCategory) return null;
  const id = profile?.projectId ?? listed?.id ?? onCategory[0].entry.projectId;
  const name = profile?.fullName ?? listed?.name ?? onCategory[0].entry.fullName;
  const catOnly = !profile && !listed;
  const find = readCategories(dataDir).get;
  const { card, ranks, newest } = detail(dataDir, { id, name, profile, onCategory: catOnly ? onCategory : null }, ctx, { find, history: rankHistory(dataDir, find), snapshots: latestBoards(dataDir) });
  const g = shownGenerated(profile), m = profile?.material ?? null;
  const d1 = readLatestSnapshot(dataDir, 'd1');
  const page = {
    // 侧栏默认高亮它所在的第一个涨星榜（方案默认近 1 天）；数字取最新一期那次运行，三个窗口都有。
    repo: card.repo, id, ranks, run: newest[0]?.snapshot.runId ?? null, win: ranks[0]?.w ?? newest[0]?.w ?? 'd1',
    hasProfile: Boolean(profile), catOnly,
    conditions: conditionsOf(currentGenerated(profile)),
    dropped: g?.droppedConditions ?? 0,
    truncatedDocs: Boolean(m && (m.readme?.truncated || m.docs.some((d) => d.truncated))),
    skillsTruncated: Boolean(m && (m.treeTruncated || m.skillsTruncated)),
    sources: m ? { readme: m.readme ? { path: m.readme.path, url: /^https:\/\//.test(m.readme.htmlUrl ?? '') ? m.readme.htmlUrl : `https://github.com/${name}` } : null, docs: m.docs.map((d) => d.path), fetchedAt: m.fetchedAt, generatedAt: g?.at ?? null } : null,
    // 不在涨星榜上（没有那次运行的数字）时，总 Star 取它所在榜单快照里的数。
    total: newest.length ? null : listTotals(dataDir).of(id, name),
    // 数据日期（需求第 23 条）：和首页近 1 天报头同口径，写统计日和实际更新时间，更新失败写明。
    top: windowStatus(d1, newerFailure(readStatus(dataDir), 'd1', d1)).top,
  };
  return { ...base(ctx), projects: { [card.repo]: card }, page };
}

// 找不到这个项目（没资料也不在榜上）：照方案的 missing 状态出页面，服务端回 404。
export const projectMissing = (fullName, ctx) => ({ ...base(ctx), projects: {}, page: { missing: true, repo: fullName } });

// 三个窗口涨星榜的最新快照（一次请求里读一遍）。
export const latestBoards = (dataDir) => Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, readLatestSnapshot(dataDir, w)]));

// 一个项目在详情栏（项目页、收藏页）要的内容：卡片资料、它在哪些涨星榜上的名次，以及卡片数字取自哪几期（最新生成的在前）。
// onCategory：只在分类涨星榜上（#10，不生成项目资料）时它所在的那几期，数字和描述取那里的候选。
export function detail(dataDir, { id, name, profile, onCategory }, ctx, { find, history, snapshots }) {
  // 它在哪些涨星榜上（按窗口顺序），卡片数字取最新生成的那一期的运行。
  const onBoards = Object.entries(snapshots).flatMap(([w, s]) => {
    const e = s?.entries.find((x) => (id ? x.projectId === id : x.fullName.toLowerCase() === name.toLowerCase()));
    return e ? [{ w, snapshot: s, entry: e }] : [];
  });
  // 名次胶囊带名次变化和连续期数（#17），按总榜算。
  const ranks = onBoards.map(({ w, snapshot, entry }) => {
    const mv = history.moves(w, null, snapshot.statDay);
    return { w, label: `近 ${WINDOWS[w].days} 天`, rank: entry.rank, tie: snapshot.entries.filter((x) => x.rank === entry.rank).length > 1, mv: mv ? mv(entry) : null, streak: history.streak(w, null, snapshot.statDay, entry) };
  });
  const newest = [...(onBoards.length ? onBoards : onCategory ?? [])].sort((a, b) => Date.parse(b.snapshot.generatedAt) - Date.parse(a.snapshot.generatedAt));
  const shown = newest.length ? projectCard(dataDir, newest, ctx, find) : brief(dataDir, { id, fullName: name }, ctx, find, profile);
  return { card: onCategory ? categoryOnly(shown, newest[0].entry) : shown, ranks, newest };
}

// ── 我的收藏（2026-11-03 白雾定稿 fav.html，#22）：这个人的全部收藏，新的在前，按类别分组成收藏架；点项目在本页右侧打开详情栏（内容同项目页）。
// 名字优先用资料里现在的（项目可能改过名）；Skill 已从仓库删掉（已不在仓库）、项目资料已不在都写明。
// 卡片文字：项目用一句话（补资料生成，还没生成就空着，不拿别的字凑），Skill 用 Skill 说明。
// 分组：项目归它的第一个分类（还没归类的单独一组），单个 Skill 的收藏全部归「Skill」组；组按收藏数从多到少排，一样多时最近收藏的组在前。
const SKILL_SHELF = 'Skill';
const UNSORTED_SHELF = '还没归类';
const shortFields = (g) => ({ line: g?.line ?? null, use: g?.use ?? [], scene: g?.scene ?? [], tag: g?.tag ?? null, type: g?.type ?? null });
export function favoritesData(dataDir, ctx) {
  const find = readCategories(dataDir).get;
  const listed = boardProjects(dataDir);
  // 只在分类涨星榜上的项目（#10）：不生成项目资料，站内照样打得开，数字、总 Star 和描述取那里的候选。
  const onCategory = new Map([...categoryListed(dataDir).values()].map((list) => [list[0].entry.projectId, list]));
  // 总 Star：不在涨星榜上的项目取各榜最新快照里的数字（更新时的数字），都没有就“暂缺”。
  const totals = listTotals(dataDir);
  const opts = { find, history: rankHistory(dataDir, find), snapshots: latestBoards(dataDir) };
  const projects = {}, views = {};
  const items = ctx.favorites.list(ctx.account.id).map((f) => {
    const profile = readProfile(dataDir, f.projectId);
    const repo = profile?.fullName ?? f.fullName;
    const onList = listed.some((p) => p.id === f.projectId);
    const catList = !profile && !onList ? onCategory.get(f.projectId) ?? null : null;
    const total = totals.of(f.projectId, repo) ?? catList?.[0].entry.total ?? null;
    if (!projects[repo]) {
      const { card, ranks, newest } = detail(dataDir, { id: f.projectId, name: repo, profile, onCategory: catList }, ctx, opts);
      projects[repo] = { ...card, ...shortFields(shownGenerated(profile)) };
      // 详情栏：卡片数字取哪次运行、统计格高亮哪个窗口、名次；不在涨星榜上时总 Star 另给。
      views[repo] = { run: newest[0]?.snapshot.runId ?? null, win: ranks[0]?.w ?? null, ranks, total: newest.length ? null : total };
    }
    const p = projects[repo];
    const skill = f.skillPath ? { path: f.skillPath, name: f.skillName || f.skillPath.split('/').pop(), desc: p.skills.find((s) => s.path === f.skillPath)?.desc ?? '', missing: !profile?.material?.skills.some((s) => s.path === f.skillPath) } : null;
    return {
      repo, id: f.projectId, savedName: f.fullName, renamed: Boolean(profile && profile.fullName !== f.fullName), skill, at: f.createdAt,
      hasProfile: Boolean(profile), catOnly: Boolean(catList), openable: Boolean(profile || catList || onList), total,
      shelf: skill ? SKILL_SHELF : p.cats[0] ?? UNSORTED_SHELF, cat: p.cats[0] ?? null, line: skill ? skill.desc : p.line,
      ...decisionOf(f),
    };
  });
  const shelves = [...new Set(items.map((x) => x.shelf))].map((name) => ({ name, n: items.filter((x) => x.shelf === name).length })).sort((x, y) => y.n - x.n);
  return { ...base(ctx), items, shelves, projects, views };
}

// ── 登录页的壳（#14 的样式和组件，不套白雾外壳）；数据嵌进 <script type="application/json"> ──
const shell = ({ title, body, script, data }) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Github·Tidings</title>
${FAVICON}
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/components.css">
<link rel="stylesheet" href="/assets/pages.css">
</head>
<body>
${body}
<script type="application/json" id="gc-data">${embed(data)}</script>
<script src="/assets/icons.js"></script>
<script src="/assets/gc.js"></script>
<script src="/assets/pages.js"></script>
<script src="/assets/${script}"></script>
</body>
</html>
`;

// 项目页：和首页详情栏同一份内容，整页放在白雾外壳里。从收藏页点进来时顶栏高亮“收藏页”。
export const projectPage = (data, ctx, from) => frame({ title: data.page.missing ? '找不到这个项目' : esc(data.page.repo), active: from === 'favorites' ? '收藏' : '涨星', ctx, css: ['bw.css'], js: ['bw.js', 'ho.js', 'project.js'], data,
  body: '  <main class="pwrap"><article class="ppage" id="page"></article></main>' });

// 我的收藏（#22，定稿 fav.html：C 收藏架 + A 书签丝带卡片 + A 侧栏只留类别目录）：报头、左侧类别目录、右侧按类别分组的卡片（assets/favorites.js 画），
// 点项目从右侧滑出详情栏（和首页同一份内容，bw.js）。整页滚动，顶栏吸顶，底部留白给背景鲨鱼。
export const favoritesPage = (data, ctx) => frame({ title: '收藏', active: '收藏', ctx, css: ['bw.css', 'favorites.css'], js: ['bw.js', 'ho.js', 'favorites.js'], data,
  bar: '<label class="search"><span>⌕</span><input data-q placeholder="搜项目名、标签、用途" aria-label="在收藏页里找"><span class="kbd">/</span></label>',
  body: `  <div class="fwrap">
    <section class="hero-box" id="mast"></section>
    <div id="shelf"></div>
  </div>
  <div class="scrim" data-close></div>
  <aside class="drawer" id="drawer" aria-label="详情栏"></aside>` });

// 登录（#5）：表单由服务端判定；失败时输入框描边变失败色、提示条写明，用户名照填回去（密码不回填）。next 已由 safeNext 处理成本站路径。
export const loginPage = (next, error, name = '') => shell({ title: '登录', script: 'login.js', data: { ...base({ account: { name: '' } }), projects: {} }, body: `<main class="login-split">
  <section class="intro" aria-label="这个站是做什么的">
    <a class="brand" href="/login">${MARK}${WORDMARK}</a>
    <p class="claim">每天两分钟，知道 GitHub 上什么在涨、值不值得装。</p>
    <ol class="how">
      <li><span class="n">1</span><div><b>全站找候选</b>从 GitHub 全站的 Star 事件里找出当天涨得多的项目。</div></li>
      <li><span class="n">2</span><div><b>官方核数</b>每个候选都用 GitHub 官方星数历史核一遍，榜单只认官方数字。</div></li>
      <li><span class="n">3</span><div><b>看完就装</b>简介、使用条件、Skill 都整理好，一键复制安装指令给你的 AI。</div></li>
    </ol>
  </section>
  <section class="pane">
    <div class="login">
      <h1>登录</h1>
      <p class="lede">账号由所有者开通。</p>
      <form id="form" method="post" action="/login">
        <input type="hidden" name="next" value="${esc(next)}">
        <div class="field"${error ? ' data-error' : ''}><label for="user">用户名</label><div class="input"><input id="user" name="name"${name ? ` value="${esc(name)}"` : ''} autocomplete="username" autocapitalize="off" spellcheck="false" required autofocus></div></div>
        <div class="field"${error ? ' data-error' : ''}><label for="pass">密码</label><div class="input"><input id="pass" name="password" type="password" autocomplete="current-password" required><button class="ib" type="button" id="peek" aria-label="显示密码"></button></div></div>
        <div class="err" role="alert"${error ? '' : ' hidden'}>${error ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg><span>${esc(error)}</span>` : ''}</div>
        <button class="btn btn-p btn-w" type="submit">登录</button>
      </form>
      <p class="fine">暂不开放注册。忘了密码请联系所有者重置。</p>
    </div>
  </section>
</main>` });
