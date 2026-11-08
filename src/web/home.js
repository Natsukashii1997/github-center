// 首页涨星榜（#13 起；2026-11-03 起按白雾定稿 r7 重做，#21）。服务端把近 1/7/30 天三个窗口的快照、上榜项目的资料和这个人的收藏
// 整理成一份数据嵌进页面，页面脚本（assets/bw.js、assets/home.js）画出来，切换窗口不再请求服务端。
// 名次、新增和总 Star 只取快照。卡片上的数字和 30 天走势取这一期榜单那次运行存下的官方原始响应：三个窗口的快照可能出自
// 不同次运行（某个窗口失败后重跑），同一张卡上的数字和柱子来自同一份响应才对得上。缺数据的那天留空位，不补零。
// 首页按定义标签筛选，不按分类（分类榜另成一页，后续批次）；只上了分类榜的项目仍由 categoryListed 认出来，项目页和收藏用。
import { join } from 'node:path';
import { readLatestSnapshot, readStatus, newerFailure, WINDOWS } from '../ranking/index.js';
import { readJson, readCandidates } from '../ranking/store.js';
import { CATEGORIES, readCategories, gainersInCategory } from '../categories/index.js';
import { bucketOf, windowDays, dayRange } from '../ranking/stat-day.js';
import { PER_PAGE } from '../ranking/github.js';
import { rankHistory, markRows } from '../ranking/moves.js';
import { readProfile, shownGenerated, skillPurpose, INSTALL_AIS, PROJECT_TYPES } from '../profiles/index.js';
import { decisionsOf } from './favorites.js';

const SERIES_DAYS = 30;
const label = (w) => `近 ${WINDOWS[w].days} 天`;
const md = (day) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
const hhmm = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(11, 16);

// 漏失概率写成“约万分之 1.1”这样的说法。
export function chance(p) {
  if (p >= 0.01) return `约 ${(p * 100).toFixed(1)}%`;
  const units = [[1e-3, '千分之'], [1e-4, '万分之'], [1e-5, '十万分之'], [1e-6, '百万分之'], [1e-7, '千万分之'], [1e-8, '亿分之']];
  const [u, name] = units.find(([u]) => p >= u) ?? units.at(-1);
  return `约${name} ${(p / u).toFixed(1)}`;
}

// 截至统计日（含）的 30 个统计日，每天取官方星数历史里那一格，规则和出榜相同：那一周的历史在就取；项目那天还不存在
// （历史不满一页且最早一周晚于那天）记 0；否则那天缺数据，记 null（缺失不补零）。
export function dailySeries(weeks, statDay) {
  return windowDays(statDay, SERIES_DAYS).map((d) => {
    const b = bucketOf(d);
    const week = weeks.find((w) => w.week === b.week);
    if (week) return week.days[b.dayIndex];
    return weeks.length < PER_PAGE && weeks.every((w) => w.week > b.week) ? 0 : null;
  });
}

// 一次运行里一个项目的数字：30 天走势、三个窗口的新增（窗口里有一天缺数据就记 null）、总 Star。
// 这一期自己的窗口直接用榜上的数字，它和走势出自同一份响应，两者相等。
function runFigures(dataDir, w, snapshot, entry) {
  const weeks = entry.evidence?.history ? readJson(join(dataDir, entry.evidence.history.path)) : null;
  const series = weeks ? dailySeries(weeks, snapshot.statDay) : null;
  const gains = Object.fromEntries(Object.entries(WINDOWS).map(([id, { days }]) => {
    const span = series?.slice(-days);
    return [id, span && !span.includes(null) ? span.reduce((s, x) => s + x, 0) : null];
  }));
  return { seriesDay: snapshot.statDay, series, gains: { ...gains, [w]: entry.gain }, total: entry.total };
}

// 顶栏的更新状态、提示条：更新失败（比当前快照新的那天失败了）优先，其次是可能不完整；生成于自检上线之前的旧快照如实说明。
export function windowStatus(snapshot, failed) {
  const notes = [];
  if (failed) notes.push({ tone: 'bad', icon: 'error', title: '更新失败', text: `${md(failed.day)}的更新失败：${failed.error}。${snapshot ? `下面是上次成功的 ${md(snapshot.statDay)}数据。` : ''}` });
  if (snapshot?.incomplete) {
    const why = [];
    if (!snapshot.check.passed) why.push(`自检未通过，估计漏掉一个该上榜项目的概率${chance(snapshot.check.missProbability)}（要求小于百分之一）`);
    if (snapshot.candidates.failed.length) why.push(`${snapshot.candidates.failed.length} 个候选的官方核数失败`);
    notes.push({ tone: 'warn', icon: 'warn', title: '可能不完整', text: `${why.join('；')}，名次可能有出入。` });
  }
  if (snapshot && !snapshot.check) notes.push({ icon: 'warn', title: '未做自检', text: '这份榜单生成于每日自检上线之前，没有做完整性自检。' });
  // #83：官方日桶按美国太平洋时间分日、日终才定稿。统计日结束前出的榜（#83 之前每天北京 10:00 出）最后一天没数完；按每期的出榜时刻判断，不写死日期。
  if (snapshot?.generatedAt && Date.parse(snapshot.generatedAt) < dayRange(snapshot.statDay).to) {
    notes.push({ icon: 'warn', title: '最后一天未数完', text: `这一期在 ${md(snapshot.statDay)}的 GitHub 统计日（美国太平洋时间）结束前生成（以前每天北京 10:00 出榜），最后一天还没数完，名次可能有偏差，近 1 天影响最大。` });
  }
  let top;
  if (!snapshot) top = { tone: failed ? 'bad' : 'warn', text: failed ? '更新失败 · 还没有数据' : '还没有数据' };
  else if (failed) top = { tone: 'bad', text: `更新失败 · 显示 ${md(snapshot.statDay)}数据` };
  else if (snapshot.incomplete) top = { tone: 'warn', text: `可能不完整 · ${md(snapshot.statDay)}数据` };
  else top = { tone: 'ok', text: `${md(snapshot.statDay)}数据 · ${hhmm(snapshot.generatedAt)} 更新` };
  return { top, notes };
}

const rowsOf = (entries, snapshot) => {
  const ranks = entries.map((e) => e.rank);
  return entries.map((e) => ({ repo: e.fullName, rank: e.rank, tie: ranks.filter((r) => r === e.rank).length > 1, gain: e.gain, run: snapshot.runId }));
};

// 候选当成榜单条目用（卡片按它这次运行存下的官方星数历史取数字）。
const candidateEntry = (c) => ({ projectId: c.id, fullName: c.fullName, gain: c.gain, total: c.total, description: c.description ?? null, evidence: { history: { path: c.evidence.history } } });

// 最新一期各窗口分类榜上的项目（#10），按小写名字索引，值和首页卡片的 onBoards 同形（每个窗口一条）。
// 只上了分类榜、不在其他榜单上的项目不生成项目资料（所有者 2026-10-24 选 B）：项目页和收藏靠它认出来，用候选里的描述和数字。
export function categoryListed(dataDir) {
  const find = readCategories(dataDir).get;
  const byName = new Map();
  for (const w of Object.keys(WINDOWS)) {
    const snapshot = readLatestSnapshot(dataDir, w);
    const candidates = snapshot && readCandidates(dataDir, w, snapshot.statDay);
    if (!candidates) continue;
    for (const category of CATEGORIES) for (const c of gainersInCategory({ candidates, find, category }).entries) {
      const key = c.fullName.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      if (!byName.get(key).some((b) => b.w === w)) byName.get(key).push({ w, snapshot, entry: candidateEntry(c) });
    }
  }
  return byName;
}

// 只上了分类榜的项目：卡片标出来（不写“简介生成中”），描述取候选里 GitHub 上的那句。
export const categoryOnly = (card, entry) => ({ ...card, catOnly: true, desc: entry.description ?? null });

function board(w, snapshot, status, history) {
  const { top, notes } = windowStatus(snapshot, newerFailure(status, w, snapshot));
  if (!snapshot) return { label: label(w), top, notes, entries: [], empty: { title: `还没有${label(w)}的榜单`, text: '每天统计日结束后自动生成。' } };
  return {
    label: label(w),
    top,
    notes,
    day: snapshot.statDay,
    lede: {
      span: w === 'd1' ? `GitHub 统计日 ${md(snapshot.statDay)}（美国太平洋时间）` : `GitHub 统计日 ${md(snapshot.from)}至 ${md(snapshot.statDay)}（美国太平洋时间）`,
      candidates: snapshot.candidates.total,
      checks: snapshot.requests.history + snapshot.requests.project,
    },
    entries: marked(history, w, snapshot, notes),
    empty: snapshot.entries.length ? null : { title: '这一期没有核出项目', text: '换个时间窗口看看。' },
  };
}

// 总榜的行加上名次变化和连续期数（#17）；没有可比的上一期时提示条写在这个窗口的提示条后面。
function marked(history, w, snapshot, notes) {
  const rows = rowsOf(snapshot.entries, snapshot);
  markRows(history, { w, day: snapshot.statDay, rows, raw: snapshot.entries, notes });
  return rows;
}

// 使用条件：每条带类别、整理后的一句话和原文摘录（#6）。详情栏、项目页不再显示（白雾定稿），项目页数据里照旧带着。
export const conditionsOf = (g) => (g ? g.conditions.map(({ kind, text, quote }) => ({ kind, text, quote })) : []);
// 首页短字段（#23，补资料时由 Codex 生成）：一句话、主要用途、使用场景、说明标签、定义标签。还没按新版重新生成的资料没有这些，页面上那一格留空。
export const shortOf = (g) => ({ line: g?.line ?? null, use: g?.use ?? [], scene: g?.scene ?? [], tag: g?.tag ?? null, type: g?.type ?? null });
// 维护信号（#18）：最近推送取资料里的 pushedAt，最新正式版取补资料时查的 releases/latest；查不到都写“未知”。详情栏里写成“最近更新时间”和最新版本。
export const maintOf = (profile) => ({ pushed: profile?.pushedAt?.slice(0, 10) ?? null, release: profile?.release ?? { state: 'unknown' } });

// 一个上榜项目在卡片上要的全部内容。onBoards：它出现在哪些窗口的快照里，最新生成的在前；语言、创建日期取最新存下的项目信息，
// 数字按运行分开放（runs），卡片按这一期榜单的运行取。
// AI 产出留痕（#69，全局规则 P-13）：简介和分类各是谁做的（执行方、接入方式、模型、时间），详情栏末尾写出来。
// 没生成过的给 null；#69 之前生成的没有记录，给 {}。
export const aiBy = (g, cat) => ({ profile: g ? g.ai ?? {} : null, cats: cat ? cat.ai ?? {} : null });

export function project(dataDir, onBoards, { account, favorites }, find) {
  const { entry } = onBoards[0];
  const projectRaw = onBoards.find((b) => b.entry.evidence?.project)?.entry.evidence.project;
  const info = projectRaw ? readJson(join(dataDir, projectRaw.path)) : null;
  const runs = {};
  for (const b of onBoards) runs[b.snapshot.runId] ??= runFigures(dataDir, b.w, b.snapshot, b.entry);
  const profile = readProfile(dataDir, entry.projectId);
  const g = shownGenerated(profile);
  const saved = favorites.savedIn(account.id, entry.projectId);
  return {
    repo: entry.fullName,
    id: entry.projectId,
    ownerId: info?.owner?.id ?? null,
    runs,
    lang: info?.language ?? null,
    created: info?.created_at?.slice(0, 10) ?? null,
    what: g?.what ?? null,
    problem: g?.problem ?? null,
    // 从没生成过简介（#52：当轮重试也没成）：先给 GitHub 上的描述。
    ghDesc: g ? null : profile?.description ?? info?.description ?? null,
    ...shortOf(g),
    cats: find({ id: entry.projectId, fullName: entry.fullName })?.categories ?? [],
    aiBy: aiBy(g, find({ id: entry.projectId, fullName: entry.fullName })),
    maint: maintOf(profile),
    installable: Boolean(profile?.material),
    skills: (profile?.material?.skills ?? []).map((s) => ({ name: s.name, path: s.path, desc: skillPurpose(s, g) })),
    saved: saved.has(''),
    savedSkills: [...saved].filter(Boolean),
  };
}

export function homeData(dataDir, ctx) {
  const status = readStatus(dataDir);
  const find = readCategories(dataDir).get;
  const snapshots = Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, readLatestSnapshot(dataDir, w)]));
  const history = rankHistory(dataDir, find);
  const windows = Object.fromEntries(Object.entries(snapshots).map(([w, s]) => [w, board(w, s, status, history)]));
  // 卡片要的项目：三个窗口涨星榜上的，按项目归在一起。
  const seen = new Map();
  for (const [w, snapshot] of Object.entries(snapshots)) for (const entry of snapshot?.entries ?? []) {
    if (!seen.has(entry.fullName)) seen.set(entry.fullName, []);
    seen.get(entry.fullName).push({ w, snapshot, entry });
  }
  for (const list of seen.values()) list.sort((a, b) => Date.parse(b.snapshot.generatedAt) - Date.parse(a.snapshot.generatedAt));
  return {
    account: { name: ctx.account.name },
    ais: Object.entries(INSTALL_AIS).map(([id, ai]) => [id, ai.name]),
    decisions: decisionsOf(ctx.favorites, ctx.account.id),
    types: PROJECT_TYPES,
    windows,
    projects: Object.fromEntries([...seen].map(([name, list]) => [name, project(dataDir, list, ctx, find)])),
  };
}

// 嵌进 <script type="application/json">：把 < 和行分隔符转义，项目文字里出现 </script> 也不会提前结束脚本。
export const embed = (data) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// 白雾外壳（2026-11-03 重设计，定稿原型 design/candidates/redesign/r7.html）：白底、反色 ASCII 鲨鱼背景、顶栏是涨星榜／分类榜／收藏页／设置页（设置页见 settings.js）。
// 分类榜见 categories.js（#27）。css、js 是这一页另要的样式和脚本（shell.css 放最后，外壳的底色优先于收藏页还在用的旧样式）。
// 三页都整页滚动、顶栏吸顶。
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 导航（所有者 2026-11-04 定）：发现（原分类榜，常用，放第一个、打开网站就是它）、涨星（原涨星榜，/stars）、收藏、设置。
const NAV = [['/', '发现'], ['/stars', '涨星'], ['/favorites', '收藏'], ['/settings', '设置']];
// 品牌 Github·Tidings（所有者 2026-11-03 定稿，design/candidates/redesign/brand/）：报徽图标（粗圈、实心海面、星）+ 衬线斜体字标。
// 顶栏、登录页和浏览器标签图标共用同一个 SVG。
const MARK_SVG = '<svg viewBox="0 0 24 24"><defs><clipPath id="tdc"><circle cx="12" cy="12" r="10.4"/></clipPath></defs><circle cx="12" cy="12" r="11" fill="#fff"/><g clip-path="url(#tdc)"><path d="M-4 14.6q2.5-2.6 5 0t5 0 5 0 5 0 5 0 5 0 5 0 5 0 5 0 5 0V30H-4z" fill="#0969da"/><path d="M-9 18.8q2.5-2.4 5 0t5 0 5 0 5 0 5 0 5 0 5 0 5 0 5 0 5 0" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".75"/></g><polygon points="12,3.2 13.23,6.5 16.76,6.65 14,8.85 14.94,12.25 12,10.3 9.06,12.25 10,8.85 7.24,6.65 10.77,6.5" fill="#1f2328" stroke="#1f2328" stroke-width=".9" stroke-linejoin="round"/><circle cx="12" cy="12" r="11" fill="none" stroke="#1f2328" stroke-width="2"/></svg>';
export const MARK = MARK_SVG.replace('<svg ', '<svg class="logo" width="24" height="24" aria-hidden="true" ');
export const WORDMARK = '<span class="wm">Github<span class="d">·</span>Tidings</span>';
export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(MARK_SVG.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}">`;
export const frame = ({ title, active, ctx, css = [], js = [], data, body, bar = '' }) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Github·Tidings</title>
${FAVICON}
${[...css, 'shell.css'].map((f) => `<link rel="stylesheet" href="/assets/${f}">`).join('\n')}
</head>
<body>
<canvas class="sea" id="sea" aria-hidden="true"></canvas>
<div class="fog"></div>
<div class="app">
  <header class="bar">
    <a class="brand" href="/">${MARK}${WORDMARK}</a>
    <nav class="nav" aria-label="主导航">${NAV.map(([h, t]) => `<a href="${h}"${t === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div class="r">${bar}<span class="me" title="${esc(ctx.account.name)}${ctx.guest ? ' · 免登录' : ''}">${esc([...ctx.account.name][0] ?? '?')}</span>${ctx.guest ? '' : '<form method="post" action="/logout"><button class="out" type="submit">退出</button></form>'}</div>
  </header>
${body}
</div>
<script type="application/json" id="gc-data">${embed(data)}</script>
<script src="/assets/sharks.js"></script>
<script src="/assets/shell.js"></script>
${js.map((f) => `<script src="/assets/${f}"></script>`).join('\n')}
</body>
</html>
`;

// 首页涨星榜：报头、筛选条、前三卡、其余上榜的行，点项目从右侧滑出详情栏（assets/home.js 画）。
// 和分类榜一样整页滚动、顶栏吸顶、底部留 30vh 空白（所有者 2026-11-03 改，原来是整页不滚、只有榜单盒子内部滚）。
export const homePage = (data, ctx) => frame({ title: '涨星', active: '涨星', ctx, css: ['bw.css'], js: ['bw.js', 'ho.js', 'home.js'], data,
  bar: '<label class="search"><span>⌕</span><input data-q placeholder="搜项目名、标签、用途" aria-label="搜项目名、标签、用途"><span class="kbd">/</span></label>',
  body: `  <div class="wrap">
    <section class="hero-box" id="head"></section>
    <section class="box">
      <div class="fbar" id="fbar"></div>
      <div class="notes" id="notes"></div>
      <div class="scroll" id="scroll">
        <div class="podium" id="hero"></div>
        <div class="sec" id="sec"><b>其余上榜</b><span id="count"></span><span class="tip">点任一项目，详情从右侧滑出</span></div>
        <div id="list"></div>
      </div>
    </section>
  </div>
  <div class="scrim" data-close></div>
  <aside class="drawer" id="drawer" aria-label="详情栏"></aside>` });
