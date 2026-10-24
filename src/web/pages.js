// 其余 5 页（#14）：其他榜单、项目页、日报、我的收藏、登录，照冻结的视觉方案 t1b-pages-r1 落地（做法同 #13 的首页）：
// 服务端把页面要的快照、项目资料和这个人的收藏整理成一份数据嵌进页面，页面脚本（assets/pages.js 加各页脚本）用方案里的组件画出来。
// 名次、新增和总 Star 只取快照；项目页的数字和走势取这一期榜单那次运行存下的官方原始响应（同首页）。
import { readLatestSnapshot, readStatus, newerFailure, WINDOWS, LISTS, SINCES } from '../ranking/index.js';
import { CATEGORIES, readCategories } from '../categories/index.js';
import { readProfile, findProfile, currentGenerated, skillPurpose, INSTALL_AIS } from '../profiles/index.js';
import { boardProjects } from '../profiles/store.js';
import { windowStatus, project as projectCard, embed, categoryListed, categoryOnly } from './home.js';
import { findSnapshot } from '../ranking/store.js';
import { rankHistory, streakText } from '../ranking/moves.js';
import { readLatestDaily } from '../daily/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = (day) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
const SEARCH_NOTE = '已知现象：GitHub 搜索会把少数仓库计进总数，但列表里不返回它们，所以极少数项目可能不在这里。';
const labels = () => Object.fromEntries(Object.entries(WINDOWS).map(([id, { days }]) => [id, { label: `近 ${days} 天` }]));
// 每页都带的：账号、安装目标、分类、窗口名（gc.js 要）。
const base = (ctx) => ({ account: { name: ctx.account.name }, ais: Object.entries(INSTALL_AIS).map(([id, ai]) => [id, ai.name]), cats: CATEGORIES, windows: labels() });
// 顶栏状态：和首页近 1 天的一致。
function siteTop(dataDir) {
  const s = readLatestSnapshot(dataDir, 'd1');
  return windowStatus(s, newerFailure(readStatus(dataDir), 'd1', s)).top;
}

// 各榜最新快照里每个项目的总 Star（更新时的数字）：按项目 id 和名字都能查；收藏页和不在涨星榜上的项目页用。
function listTotals(dataDir) {
  const byId = new Map(), byName = new Map();
  const note = (e) => {
    if (e.total == null) return;
    if (e.projectId && !byId.has(e.projectId)) byId.set(e.projectId, e.total);
    if (!byName.has(e.fullName.toLowerCase())) byName.set(e.fullName.toLowerCase(), e.total);
  };
  for (const b of [...Object.keys(WINDOWS), 'new', 'top']) readLatestSnapshot(dataDir, b)?.entries.forEach(note);
  const trending = readLatestSnapshot(dataDir, 'trending');
  for (const s of SINCES) trending?.pages[s]?.entries.forEach(note);
  return { of: (id, name) => (id && byId.get(id)) ?? byName.get(name.toLowerCase()) ?? null };
}

// 一个项目在紧凑行、网格卡上要的资料：简介、分类、Skill、收藏状态。数字由各页按快照另给；头像没有 owner id 时页面按用户名取。
function brief(dataDir, { id, fullName }, ctx, find, profile = id ? readProfile(dataDir, id) : null) {
  const g = currentGenerated(profile);
  const saved = id ? ctx.favorites.savedIn(ctx.account.id, id) : new Set();
  return {
    repo: profile?.fullName ?? fullName, id, ownerId: null, runs: {}, lang: null, created: null,
    what: g?.what ?? null, problem: g?.problem ?? null, conditions: g ? g.conditions.map((c) => c.text) : [],
    cats: find({ id, fullName })?.categories ?? [], installable: Boolean(profile?.material),
    skills: (profile?.material?.skills ?? []).map((s) => ({ name: s.name, path: s.path, desc: skillPurpose(s, g) })),
    saved: saved.has(''), savedSkills: [...saved].filter(Boolean),
  };
}

// ── 其他榜单：三个榜并排各前 20；分类筛选在页面里做（项目的分类随资料嵌入） ──
export function boardsData(dataDir, ctx) {
  const status = readStatus(dataDir), find = readCategories(dataDir).get;
  const snaps = Object.fromEntries(Object.keys(LISTS).map((l) => [l, readLatestSnapshot(dataDir, l)]));
  const projects = {};
  const add = (e) => { projects[e.fullName] ??= brief(dataDir, { id: e.projectId ?? null, fullName: e.fullName }, ctx, find); return e; };
  const lists = {
    new: snaps.new && { statDay: snaps.new.statDay, from: snaps.new.from, generatedAt: snaps.new.generatedAt, entries: snaps.new.entries.map((e) => ({ repo: add(e).fullName, rank: e.rank, total: e.total, created: e.createdAt.slice(0, 10) })) },
    trending: snaps.trending && { statDay: snaps.trending.statDay, generatedAt: snaps.trending.generatedAt, pages: Object.fromEntries(SINCES.map((s) => { const pg = snaps.trending.pages[s]; return [s, { fetchedAt: pg.fetchedAt ?? snaps.trending.generatedAt, count: pg.entries.length, entries: pg.entries.slice(0, 20).map((e) => ({ repo: add(e).fullName, rank: e.rank, gain: e.periodStars, total: e.total })) }]; })) },
    top: snaps.top && { statDay: snaps.top.statDay, generatedAt: snaps.top.generatedAt, entries: snaps.top.entries.map((e) => ({ repo: add(e).fullName, rank: e.rank, total: e.total })) },
  };
  // 更新失败（比当前快照新的那天失败了）：页面保留快照，提示条写明失败的日期和原因。
  const notes = Object.keys(LISTS).flatMap((l) => {
    const f = newerFailure(status, l, snaps[l]);
    return f ? [{ tone: 'bad', icon: 'error', title: `${LISTS[l]}更新失败`, text: `${md(f.day)}的更新失败：${f.error}。${snaps[l] ? `下面仍是 ${md(snaps[l].statDay)}的${LISTS[l]}。` : ''}` }] : [];
  });
  const day = Object.values(snaps).filter(Boolean).map((s) => s.statDay).sort().at(-1) ?? null;
  // 顶栏和其他页一致（全站状态）；三个榜各自的失败写在上面的提示条里。
  return { ...base(ctx), top: siteTop(dataDir), notes, day, lists, projects, searchNote: SEARCH_NOTE };
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
  const status = readStatus(dataDir);
  // 它在哪些涨星榜上（按窗口顺序），卡片数字取最新生成的那一期的运行。
  const onBoards = Object.keys(WINDOWS).flatMap((w) => {
    const s = readLatestSnapshot(dataDir, w);
    const e = s?.entries.find((x) => (id ? x.projectId === id : x.fullName.toLowerCase() === name.toLowerCase()));
    return e ? [{ w, snapshot: s, entry: e }] : [];
  });
  // 名次胶囊带名次变化和连续期数（#17），按总榜算。
  const history = rankHistory(dataDir, find);
  const ranks = onBoards.map(({ w, snapshot, entry }) => {
    const mv = history.moves(w, null, snapshot.statDay);
    return { w, label: `近 ${WINDOWS[w].days} 天`, rank: entry.rank, tie: snapshot.entries.filter((x) => x.rank === entry.rank).length > 1, mv: mv ? mv(entry) : null, streak: streakText(history.streak(w, null, snapshot.statDay, entry)) };
  });
  const newest = [...(onBoards.length ? onBoards : onCategory ?? [])].sort((a, b) => Date.parse(b.snapshot.generatedAt) - Date.parse(a.snapshot.generatedAt));
  const shown = newest.length ? projectCard(dataDir, newest, ctx, find) : brief(dataDir, { id, fullName: name }, ctx, find, profile);
  const card = catOnly ? categoryOnly(shown, newest[0].entry) : shown;
  const g = currentGenerated(profile), m = profile?.material ?? null;
  const d1 = readLatestSnapshot(dataDir, 'd1');
  const page = {
    // 侧栏默认高亮它所在的第一个涨星榜（方案默认近 1 天）；数字取最新一期那次运行，三个窗口都有。
    repo: card.repo, id, ranks, run: newest[0]?.snapshot.runId ?? null, win: ranks[0]?.w ?? newest[0]?.w ?? 'd1',
    hasProfile: Boolean(profile), catOnly,
    // 维护信号（#18）：最近推送取资料里的 pushedAt，最新正式版取补资料时查的 releases/latest；查不到都写“未知”。
    maint: { pushed: profile?.pushedAt?.slice(0, 10) ?? null, release: profile?.release ?? { state: 'unknown' } },
    conditions: g ? g.conditions.map(({ kind, text, quote }) => ({ kind, text, quote })) : [],
    dropped: g?.droppedConditions ?? 0,
    truncatedDocs: Boolean(m && (m.readme?.truncated || m.docs.some((d) => d.truncated))),
    skillsTruncated: Boolean(m && (m.treeTruncated || m.skillsTruncated)),
    sources: m ? { readme: m.readme ? { path: m.readme.path, url: /^https:\/\//.test(m.readme.htmlUrl ?? '') ? m.readme.htmlUrl : `https://github.com/${name}` } : null, docs: m.docs.map((d) => d.path), fetchedAt: m.fetchedAt, generatedAt: g?.at ?? null } : null,
    // 不在涨星榜上（没有那次运行的数字）时，总 Star 取它所在榜单快照里的数。
    total: newest.length ? null : listTotals(dataDir).of(id, name),
    top: windowStatus(d1, newerFailure(status, 'd1', d1)).top,
  };
  return { ...base(ctx), projects: { [card.repo]: card }, page };
}

// 找不到这个项目（没资料也不在榜上）：照方案的 missing 状态出页面，服务端回 404。
export const projectMissing = (dataDir, fullName, ctx) => ({ ...base(ctx), projects: {}, page: { missing: true, repo: fullName, top: siteTop(dataDir) } });

// ── 日报（#11）：每天生成的那份日报（data/daily/<统计日>.json，飞书消息用的也是这一份），还没生成时页面显示空状态。
// 简介按日报里存下的写，网页和飞书一致；当时还在生成、现在生成好了的，用现在的。头像、分类、收藏状态和走势按日报用的那几份快照取（同首页）。 ──
export function dailyData(dataDir, ctx) {
  const daily = readLatestDaily(dataDir);
  const top = siteTop(dataDir);
  if (!daily) return { ...base(ctx), top, daily: null, projects: {} };
  const find = readCategories(dataDir).get;
  const seen = new Map();
  for (const [w, win] of Object.entries(daily.windows)) {
    const snapshot = win.statDay ? findSnapshot(dataDir, w, win.statDay)?.snapshot : null;
    for (const e of win.entries) {
      if (!seen.has(e.repo)) seen.set(e.repo, { id: e.id, intro: daily.projects[e.first?.repo ?? e.repo], boards: [] });
      const entry = snapshot?.entries.find((x) => x.fullName === e.repo);
      if (entry) seen.get(e.repo).boards.push({ w, snapshot, entry });
    }
  }
  const projects = {};
  for (const [repo, { id, intro, boards }] of seen) {
    boards.sort((a, b) => Date.parse(b.snapshot.generatedAt) - Date.parse(a.snapshot.generatedAt));
    const card = boards.length ? projectCard(dataDir, boards, ctx, find) : brief(dataDir, { id, fullName: repo }, ctx, find);
    projects[repo] = intro?.what ? { ...card, what: intro.what, problem: intro.problem } : card;
  }
  // 版本发布：项目在所在时间窗口内发的正式版本，新的在前。
  const releases = Object.entries(daily.projects).filter(([, p]) => p.release).map(([repo, p]) => ({ repo, w: p.w, ...p.release }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  // 提示条：日报里写下的（各窗口的数据情况、版本发布没查全）；之后近 1 天更新失败、新一期的日报还没生成也写明。
  const notes = [...daily.notes];
  const d1 = readLatestSnapshot(dataDir, 'd1');
  const failed = newerFailure(readStatus(dataDir), 'd1', { statDay: daily.statDay });
  if (failed) notes.unshift({ tone: 'bad', icon: 'error', title: '近 1 天更新失败', text: `${md(failed.day)}的更新失败：${failed.error}。下面是 ${md(daily.statDay)}的日报。` });
  else if (d1 && d1.statDay > daily.statDay) notes.unshift({ icon: 'warn', title: '新一期日报还没生成', text: `${md(d1.statDay)}的日报还没生成，下面是 ${md(daily.statDay)}的日报。` });
  const { statDay, generatedAt, overview, windows } = daily;
  return { ...base(ctx), top, notes, daily: { statDay, generatedAt, overview, windows, releases }, projects };
}

// ── 我的收藏：这个人的全部收藏，新的在前。名字优先用资料里现在的（项目可能改过名）；Skill 已从仓库删掉、项目资料已不在都写明 ──
export function favoritesData(dataDir, ctx) {
  const find = readCategories(dataDir).get;
  const listed = boardProjects(dataDir);
  // 只上了分类榜的项目（#10）：不生成项目资料，站内页面照样打得开，总 Star 和描述取分类榜候选里的。
  const onCategory = new Map([...categoryListed(dataDir).values()].map(([b]) => [b.entry.projectId, b.entry]));
  // 总 Star：各榜最新快照里这个项目的数字（更新时的数字），都没有就“暂缺”。
  const totals = listTotals(dataDir);
  const projects = {};
  const items = ctx.favorites.list(ctx.account.id).map((f) => {
    const profile = readProfile(dataDir, f.projectId);
    const repo = profile?.fullName ?? f.fullName;
    const catEntry = !profile && !listed.some((p) => p.id === f.projectId) ? onCategory.get(f.projectId) : null;
    if (!projects[repo]) {
      const card = brief(dataDir, { id: f.projectId, fullName: repo }, ctx, find, profile);
      projects[repo] = catEntry ? categoryOnly(card, catEntry) : card;
    }
    const skill = f.skillPath ? { path: f.skillPath, name: f.skillName || f.skillPath.split('/').pop(), desc: projects[repo].skills.find((s) => s.path === f.skillPath)?.desc ?? '', missing: !profile?.material?.skills.some((s) => s.path === f.skillPath) } : null;
    return { repo, id: f.projectId, savedName: f.fullName, renamed: Boolean(profile && profile.fullName !== f.fullName), skill, at: f.createdAt, hasProfile: Boolean(profile), catOnly: Boolean(catEntry), openable: Boolean(profile || catEntry || listed.some((p) => p.id === f.projectId)), total: totals.of(f.projectId, repo) ?? catEntry?.total ?? null };
  });
  return { ...base(ctx), top: siteTop(dataDir), items, projects };
}

// ── 页面壳：同一套变量、组件与版式；数据嵌进 <script type="application/json"> ──
const shell = ({ title, body, script, data, bare }) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · GitHub 快速中心</title>
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/components.css">
<link rel="stylesheet" href="/assets/pages.css">
</head>
<body>
${bare ? '' : '<header class="top"></header>\n'}${body}
<script type="application/json" id="gc-data">${embed(data)}</script>
<script src="/assets/icons.js"></script>
<script src="/assets/gc.js"></script>
<script src="/assets/pages.js"></script>
<script src="/assets/${script}"></script>
</body>
</html>
`;

export const boardsPage = (data) => shell({ title: '其他榜单', script: 'boards.js', data, body: `<div class="wide">
  <div class="phead"><h1>其他榜单</h1><p class="lede" id="lede"></p></div>
  <div id="notes"></div>
  <div id="cats" role="group" aria-label="分类"></div>
  <div class="three" id="three"></div>
  <p class="foot">所有数字来自 GitHub 官方数据。</p>
</div>` });

export const projectPage = (data) => shell({ title: data.page.missing ? '找不到这个项目' : esc(data.page.repo), script: 'project.js', data, body: `<div class="pj1">
  <main class="main" id="main"></main>
  <aside class="side" id="side" aria-label="数据与安装"></aside>
</div>` });

export const dailyPage = (data) => shell({ title: '日报', script: 'daily.js', data, body: `<div class="mr">
  <main class="main" id="main"></main>
  <aside class="rail" id="rail" aria-label="近 7 天、近 30 天与版本发布"></aside>
</div>` });

export const favoritesPage = (data) => shell({ title: '我的收藏', script: 'favorites.js', data, body: `<main class="single-wide">
  <div class="phead"><h1>我的收藏</h1><p class="lede" id="lede"></p></div>
  <div id="kinds" role="group" aria-label="种类"></div>
  <div class="grid fgrid" id="grid"></div>
</main>` });

// 登录（#5）：表单由服务端判定；失败时输入框描边变失败色、提示条写明，用户名照填回去（密码不回填）。next 已由 safeNext 处理成本站路径。
export const loginPage = (next, error, name = '') => shell({ title: '登录', script: 'login.js', bare: true, data: { ...base({ account: { name: '' } }), projects: {} }, body: `<main class="login-split">
  <section class="intro" aria-label="这个站是做什么的">
    <a class="brand" href="/login"><span class="mark" aria-hidden="true"></span>GitHub 快速中心</a>
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
      <p class="lede">只在这台电脑上运行，账号由所有者开通。</p>
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
